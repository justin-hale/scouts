package app.romsafe.shared.sync

import app.romsafe.shared.api.QueuedRom
import app.romsafe.shared.api.RomSafeApi
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class RomDownloaderTest {
    private fun rom(multiFile: Boolean, relPath: String, size: Long) =
        QueuedRom(id = 12, platform = "psx", relPath = relPath, fileName = relPath.substringAfterLast('/'), size = size, multiFile = multiFile, url = "")

    @Test
    fun resumesAPartialDownload() = runTest {
        val full = "0123456789".encodeToByteArray()
        val engine = MockEngine { req ->
            assertEquals("bytes=4-", req.headers[HttpHeaders.Range])
            respond(full.copyOfRange(4, 10), HttpStatusCode.PartialContent, headersOf(HttpHeaders.ContentLength, "6"))
        }
        val tree = MemoryTree(mutableMapOf(".Game.gba.romsafe-part" to (full.copyOfRange(0, 4) to 1L)))
        val written = RomDownloader(RomSafeApi("http://nas", "t", engine)).download(rom(false, "Game.gba", 10), tree) { _, _ -> }
        assertEquals(listOf("Game.gba"), written)
        assertTrue(tree.files.getValue("Game.gba").first.contentEquals(full))
        assertFalse(".Game.gba.romsafe-part" in tree.files)
    }

    @Test
    fun unpacksAMultiFileSetNextToTheRom() = runTest {
        val zip = storedZip(listOf("Game.cue" to "FILE \"Game (Track 1).bin\"", "Game (Track 1).bin" to "track data"))
        val engine = MockEngine { respond(zip, headers = headersOf(HttpHeaders.ContentType, "application/zip")) }
        val tree = MemoryTree(mutableMapOf())
        val written = RomDownloader(RomSafeApi("http://nas", "t", engine))
            .download(rom(true, "Final Fantasy VII/Game.cue", 25), tree) { _, _ -> }
        assertEquals(listOf("Final Fantasy VII/Game.cue", "Final Fantasy VII/Game (Track 1).bin"), written)
        assertEquals("track data", tree.files.getValue("Final Fantasy VII/Game (Track 1).bin").first.decodeToString())
    }

    @Test
    fun refusesPathsOutsideTheRomFolder() {
        assertFailsWith<IllegalArgumentException> { RomDownloader.safePath("../evil.gba") }
        assertEquals("a/b.gba", RomDownloader.safePath("./a//b.gba"))
    }

    /** A zip with stored entries and sizes in the local headers, like the server's zipFilesStream. */
    private fun storedZip(entries: List<Pair<String, String>>): ByteArray {
        val out = mutableListOf<Byte>()
        fun u16(v: Int) = listOf(v and 0xff, (v shr 8) and 0xff).map { it.toByte() }
        fun u32(v: Long) = (0 until 4).map { ((v shr (8 * it)) and 0xff).toByte() }
        for ((name, text) in entries) {
            val data = text.encodeToByteArray()
            val n = name.encodeToByteArray()
            out += u32(0x04034b50) + u16(20) + u16(0x0800) + u16(0) + u16(0) + u16(0) + u32(0) +
                u32(data.size.toLong()) + u32(data.size.toLong()) + u16(n.size) + u16(0)
            out += n.toList() + data.toList()
        }
        out += u32(0x02014b50)
        return out.toByteArray()
    }
}
