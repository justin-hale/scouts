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
