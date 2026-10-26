package app.romsafe.desktop.data

import app.romsafe.shared.sync.walk
import kotlinx.coroutines.test.runTest
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

class NioFileTreeTest {
    private val root = Files.createTempDirectory("romsafe-tree")
    private val tree = NioFileTree(root)

    @Test
    fun writesThroughATempFileAndCreatesFolders() = runTest {
        val entry = tree.write("GC/USA/Card A/01-GZLE-gczelda.gci", byteArrayOf(1, 2, 3))
        assertEquals("GC/USA/Card A/01-GZLE-gczelda.gci", entry.path)
        assertEquals(3, entry.size)
        assertContentEquals(byteArrayOf(1, 2, 3), tree.read(entry.path))
        // No temp file is left behind.
        assertEquals(listOf("01-GZLE-gczelda.gci"), tree.list("GC/USA/Card A").map { it.name })
    }

    @Test
    fun resolvesFoldersWhateverTheirCase() = runTest {
        Files.createDirectories(root.resolve("Nintendo 3DS/abc"))
        Files.write(root.resolve("Nintendo 3DS/abc/save.bin"), byteArrayOf(9))
        assertEquals(1, tree.stat("nintendo 3ds/ABC/save.bin")?.size)
        tree.write("NINTENDO 3DS/abc/other.bin", byteArrayOf(7))
        // Reuses the existing folder rather than making a second one.
        assertEquals(listOf("Nintendo 3DS"), tree.list("").map { it.name })
        assertEquals(setOf("Nintendo 3DS/abc/save.bin", "Nintendo 3DS/abc/other.bin"), tree.walk().map { it.path }.toSet())
    }

    @Test
    fun appendsAndReplacesPartFiles() = runTest {
        tree.openSink(".a.bin.romsafe-part", append = false).apply { write(byteArrayOf(1, 2), 0, 2); close() }
        tree.openSink(".a.bin.romsafe-part", append = true).apply { write(byteArrayOf(3), 0, 1); close() }
        tree.replace(".a.bin.romsafe-part", "roms/a.bin")
        assertContentEquals(byteArrayOf(1, 2, 3), tree.read("roms/a.bin"))
        assertNull(tree.stat(".a.bin.romsafe-part"))
        tree.delete("roms/a.bin")
        assertTrue(tree.list("roms").isEmpty())
    }

    @Test
    fun refusesPathsThatClimbOut() = runTest {
        assertFailsWith<IllegalArgumentException> { tree.write("../escape.bin", byteArrayOf(1)) }
    }
}
