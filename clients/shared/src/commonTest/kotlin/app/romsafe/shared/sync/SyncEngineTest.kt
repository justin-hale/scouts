package app.romsafe.shared.sync

import app.romsafe.shared.api.PlatformInfo
import app.romsafe.shared.api.Profile
import app.romsafe.shared.api.RomSafeApi
import app.romsafe.shared.api.SaveRule
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** An in-memory tree; folders are implied by file paths. */
private class MemoryTree(val files: MutableMap<String, Pair<ByteArray, Long>>) : FileTree {
    val reads = mutableListOf<String>()

    override suspend fun list(dir: String): List<FileEntry> {
        val prefix = if (dir.isEmpty()) "" else "$dir/"
        return files.keys.filter { it.startsWith(prefix) }.map { it.removePrefix(prefix).substringBefore('/') }.distinct().map { name ->
            val path = prefix + name
            files[path]?.let { (bytes, mtime) -> FileEntry(path, bytes.size.toLong(), mtime, false) } ?: FileEntry(path, 0, 0, true)
        }
    }

    override suspend fun read(path: String): ByteArray {
        reads += path
        return files.getValue(path).first
    }

    override suspend fun write(path: String, bytes: ByteArray): FileEntry {
        files[path] = bytes to 1_000
        return FileEntry(path, bytes.size.toLong(), 1_000, false)
    }
}

class SyncEngineTest {
    private val azahar = Profile(
        "azahar",
        "Azahar",
        saves = listOf(SaveRule(listOf("3ds"), "Nintendo 3DS/{id0}/{id1}/title/{category:8}/{titleLow:8}/data/{file**}")),
    )
    private val n3ds = PlatformInfo("3ds", "Nintendo 3DS", "titleId")
    private val saveDir = "Nintendo 3DS/0/0/title/00040000/0011c400/data"

    @Test
    fun matcherPrunesFoldersThatCantHoldSaves() {
        val m = SaveMatcher(azahar.saves)
        assertTrue(m.mayContain("Nintendo 3DS/0/0/title/00040000/0011c400/data/00000001"))
        assertFalse(m.mayContain("Nintendo 3DS/0/0/title/00040000/0011c400/content"))
        assertFalse(m.mayContain("Nintendo 3DS/0/0/extdata"))
        assertFalse(m.mayContain("luma"))
        assertTrue(m.matches("$saveDir/00000001/main"))
        val retroarch = SaveMatcher(listOf(SaveRule(listOf("*"), "{game}.srm")))
        assertTrue(retroarch.matches("Golden Sun (USA, Europe).srm"))
        assertFalse(retroarch.matches("Golden Sun.gba"))
        assertFalse(retroarch.mayContain("logs"))
    }

    @Test
    fun uploadsDownloadsAndAcksPerSlot() = runTest {
        val tree = MemoryTree(
            mutableMapOf(
                "$saveDir/00000001/main" to (byteArrayOf(1, 2, 3) to 100L),
                "$saveDir/00000001/busy" to (byteArrayOf(9) to 9_999L),
                "Nintendo 3DS/0/0/title/00040000/0011c400/content/00000000.app" to (ByteArray(10) to 100L),
            ),
        )
        val calls = mutableListOf<String>()
        val newSave = byteArrayOf(7, 7)
        val engine = MockEngine { req ->
            val body = runCatching { req.body.toByteArray().decodeToString() }.getOrDefault("")
            calls += "${req.method.value} ${req.url.encodedPath}?${req.url.encodedQuery}"
            val json = headersOf(HttpHeaders.ContentType, "application/json")
            when {
                req.url.encodedPath.endsWith("/saves/plan") -> {
                    val files = Json.parseToJsonElement(body).jsonObject
                    assertEquals("2", files["slot"]!!.jsonPrimitive.content)
                    // Only the settled save was hashed and reported, not the game install or the busy file.
                    assertEquals(
                        listOf("$saveDir/00000001/main"),
                        files["files"]!!.jsonArray.map { it.jsonObject["path"]!!.jsonPrimitive.content },
                    )
                    respond(
                        """{"actions":[
                          {"action":"upload","path":"$saveDir/00000001/main","baseVersionId":4},
                          {"action":"download","path":"$saveDir/00000002/main","saveId":8,"versionId":9,"sha256":"${sha256Hex(newSave)}","size":2},
                          {"action":"download","path":"$saveDir/00000001/busy","saveId":8,"versionId":10,"sha256":"x","size":1}]}""",
                        headers = json,
                    )
                }
                req.url.encodedPath.endsWith("/saves/upload") -> respond("""{"status":"ok","saveId":7,"versionId":11}""", headers = json)
                req.url.encodedPath.endsWith("/save-versions/9/download") -> respond(newSave)
                req.url.encodedPath.endsWith("/saves/ack") -> {
                    assertEquals("""{"saveId":8,"versionId":9,"slot":"2"}""", body)
                    respond("""{"ok":true}""", headers = json)
                }
                else -> error("unexpected ${req.url}")
            }
        }
        var stored: String? = null
        val cache = HashCache({ stored }, { stored = it })
        val api = RomSafeApi("http://nas", "t", engine)
        val result = SyncEngine(api, cache, now = { 10_000L })
            .syncPlatform(PlatformJob(n3ds, null, null, listOf(EmulatorFolder("2", azahar, tree, "citra"))))

        assertEquals(1, result.uploaded)
        assertEquals(1, result.downloaded)
        assertEquals(1, result.busy)
        assertEquals(emptyList(), result.issues)
        assertTrue(tree.files.getValue("$saveDir/00000002/main").first.contentEquals(newSave))
        assertTrue(calls.any { it.startsWith("PUT /api/device/saves/upload") && "slot=2" in it && "base=4" in it && "modified=100" in it })
        assertEquals(HttpMethod.Post.value, calls.last().substringBefore(' '))

        // A second run reads nothing it already hashed.
        tree.reads.clear()
        runCatching { SyncEngine(api, cache, now = { 10_000L }).syncPlatform(PlatformJob(n3ds, null, null, listOf(EmulatorFolder("2", azahar, tree, "citra")))) }
        assertFalse("$saveDir/00000001/main" in tree.reads)
    }

    @Test
    fun filesASyncJustWroteAreNotBusy() = runTest {
        val tree = MemoryTree(mutableMapOf("Game.srm" to (byteArrayOf(5) to 9_000L)))
        val reported = mutableListOf<String>()
        val engine = MockEngine { req ->
            reported += Json.parseToJsonElement(req.body.toByteArray().decodeToString()).jsonObject["files"]!!.jsonArray
                .map { it.jsonObject["path"]!!.jsonPrimitive.content }
            respond("""{"actions":[]}""", headers = headersOf(HttpHeaders.ContentType, "application/json"))
        }
        var stored: String? = null
        val cache = HashCache({ stored }, { stored = it })
        // Another platform sharing the folder just downloaded Game.srm (same scope, so it's in the cache).
        cache.put("sha256:shared", FileEntry("Game.srm", 1, 9_000L, false), sha256Hex(byteArrayOf(5)))
        val retroarch = Profile("retroarch", "RetroArch", saves = listOf(SaveRule(listOf("*"), "{game}.srm")))
        val result = SyncEngine(RomSafeApi("http://nas", "t", engine), cache, now = { 10_000L })
            .syncPlatform(PlatformJob(PlatformInfo("gba", "GBA", "rom"), null, null, listOf(EmulatorFolder("", retroarch, tree, "shared"))))
        assertEquals(0, result.busy)
        assertEquals(listOf("Game.srm"), reported)
    }
}
