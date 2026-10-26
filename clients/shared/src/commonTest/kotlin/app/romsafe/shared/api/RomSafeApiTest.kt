package app.romsafe.shared.api

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class RomSafeApiTest {
    private val jsonHeaders = headersOf(HttpHeaders.ContentType, "application/json")

    @Test
    fun normalizesWhatPeopleType() {
        assertEquals("http://192.168.1.20:8080", ServerUrl.normalize(" 192.168.1.20:8080/ "))
        assertEquals("https://romsafe.example", ServerUrl.normalize("https://romsafe.example/"))
        assertEquals("192.168.1.20", ServerUrl.host("192.168.1.20:8080"))
        assertEquals("fd00::1", ServerUrl.host("http://[fd00::1]:8080/x"))
    }

    @Test
    fun sendsTokenAndDecodesConfig() = runTest {
        val engine = MockEngine { req ->
            assertEquals("http://nas:8080/api/device/config", req.url.toString())
            assertEquals("Bearer t0k", req.headers[HttpHeaders.Authorization])
            respond(
                """{"device":{"id":3,"name":"Thor","kind":"android"},
                   "platforms":[{"slug":"3ds","name":"Nintendo 3DS","keyKind":"titleId","romExtensions":[".3ds"],"profiles":["azahar"]}],
                   "profiles":[{"id":"azahar","name":"Azahar","defaultPaths":{"android":["azahar-emu/sdmc"]},
                     "saves":[{"platforms":["3ds"],"pattern":"Nintendo 3DS/{id0}","defaults":{"id0":"0"}}]}],
                   "mappings":[{"platform":"3ds","profile":"azahar","saveRoot":null,"romRoot":null}]}""",
                headers = jsonHeaders,
            )
        }
        val config = RomSafeApi("nas:8080/", "t0k", engine).config()
        assertEquals("Thor", config.device.name)
        assertEquals(listOf("azahar"), config.platforms.single().profiles)
        assertEquals("azahar-emu/sdmc", config.profiles.single().defaultPaths?.android?.single())
        assertNull(config.mappings.single().saveRoot)
    }

    @Test
    fun asksForTheLibrarySortedAndDecodesGamePages() = runTest {
        val engine = MockEngine { req ->
            when (req.url.encodedPath) {
                "/api/device/library" -> {
                    assertEquals("released", req.url.parameters["sort"])
                    assertEquals("games", req.url.parameters["platformSort"])
                    assertEquals("zelda", req.url.parameters["q"])
                    respond(
                        """{"platforms":[{"slug":"gba","name":"Game Boy Advance","games":2}],
                           "games":[{"id":7,"platform":"gba","title":"Minish Cap","cover":null,"saveCount":2,"addedAt":5,
                             "roms":[{"id":1,"fileName":"m.gba","relPath":"m.gba","size":9,"multiFile":false,"localPath":null,"queued":false}]}]}""",
                        headers = jsonHeaders,
                    )
                }
                "/api/games/7" -> respond(
                    """{"id":7,"platform":"gba","title":"Minish Cap","igdbId":1,"summary":"Link shrinks.","metadataSource":"igdb",
                       "roms":[{"id":1,"relPath":"m.cue","fileName":"m.cue","size":1,"totalSize":9,"crc32":null,"md5":null,"missing":false,
                         "parts":[{"path":"m.bin","size":8,"serverPath":"/roms/m.bin"}],"serverPath":"/roms/m.cue","localPath":null,"queued":true}],
                       "saves":[{"id":3,"platform":"gba","gameKey":"m","file":"m.sav","currentVersionId":4,"sha256":"ab","size":2,
                         "updatedAt":9,"updatedBy":null,"versionCount":2,"downloadName":"m.sav","empty":true,"serverPath":null}],
                       "extras":[{"id":5,"kind":"dlc","relPath":"dlc/x.zip","fileName":"x.zip","size":3,"missing":false,"serverPath":null}]}""",
                    headers = jsonHeaders,
                )
                "/api/saves/3/versions" -> respond(
                    """[{"id":4,"sha256":"ab","size":2,"createdAt":9,"note":null,"parentVersionId":2,"device":"Thor","isCurrent":true}]""",
                    headers = jsonHeaders,
                )
                else -> error("unexpected ${req.url}")
            }
        }
        val api = RomSafeApi("http://nas", "t", engine)
        val library = api.library(GameSort.RELEASED, PlatformSort.GAMES, query = " zelda ")
        assertEquals(2, library.games.single().saveCount)
        assertEquals("Game Boy Advance", library.platforms.single().name)
        val game = api.game(7)
        assertEquals(listOf("m.bin"), game.roms.single().parts.map { it.path })
        assertEquals(true, game.roms.single().queued)
        assertEquals(true, game.saves.single().empty)
        assertEquals("dlc", game.extras.single().kind)
        assertEquals(true, api.saveVersions(3).single().isCurrent)
        assertEquals(GameSort.SAVED, GameSort.fromWire("saved"))
        assertEquals(PlatformSort.NAME, PlatformSort.fromWire("bogus"))
    }

    @Test
    fun keepsUnknownPlanActions() = runTest {
        val engine = MockEngine { req ->
            assertEquals("""{"platform":"gba","files":[{"path":"A.srm","sha256":"ab","size":2}]}""", req.body.toByteArray().decodeToString())
            respond(
                """{"actions":[{"action":"download","path":"A.srm","saveId":7,"versionId":42,"sha256":"ab","size":2},
                   {"action":"something-new","path":"B.srm"}]}""",
                headers = jsonHeaders,
            )
        }
        val actions = RomSafeApi("http://nas", "t", engine).plan("gba", listOf(LocalSave("A.srm", "ab", 2)))
        assertEquals(SyncAction.DOWNLOAD, actions[0].action)
        assertEquals(42L, actions[0].versionId)
        assertEquals("something-new", actions[1].action)
    }

    @Test
    fun surfacesServerErrors() = runTest {
        val engine = MockEngine {
            respond("""{"error":"Pairing code is invalid or expired"}""", HttpStatusCode.Unauthorized, jsonHeaders)
        }
        val e = assertFailsWith<RomSafeApiException> { RomSafeApi("http://nas", null, engine).pair("X", "Thor", "android") }
        assertEquals(401, e.status)
        assertEquals("Pairing code is invalid or expired", e.message)
    }
}
