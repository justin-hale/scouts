package app.romsafe.desktop.data

import app.romsafe.shared.sync.FileEntry
import app.romsafe.shared.sync.FileSink
import app.romsafe.shared.sync.FileTree
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.OutputStream
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.NoSuchFileException
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.nio.file.attribute.BasicFileAttributes
import kotlin.io.path.name

/**
 * A [FileTree] over a plain folder. Paths resolve case-insensitively, as on
 * Android, because the server may name a folder "Nintendo 3DS" that the
 * emulator created with different case (Windows doesn't care; Linux does).
 */
class NioFileTree(private val root: Path) : FileTree {
    override suspend fun list(dir: String): List<FileEntry> = withContext(Dispatchers.IO) {
        val (real, rel) = resolve(dir) ?: return@withContext emptyList()
        if (!Files.isDirectory(real)) return@withContext emptyList()
        Files.newDirectoryStream(real).use { stream ->
            stream.mapNotNull { child -> entry(child, join(rel, child.name)) }
        }
    }

    override suspend fun read(path: String): ByteArray = withContext(Dispatchers.IO) {
        val (real, _) = resolve(path) ?: throw NoSuchFileException(path)
        Files.readAllBytes(real)
    }

    override suspend fun write(path: String, bytes: ByteArray): FileEntry = withContext(Dispatchers.IO) {
        val (parent, relParent) = ensureDir(path.substringBeforeLast('/', ""))
        val name = path.substringAfterLast('/')
        // An existing file keeps its own spelling.
        val target = existingChild(parent, name) ?: parent.resolve(name)
        // Write a hidden temp file next to the target, then swap it in, so the
        // emulator never reads half a save.
        val temp = parent.resolve(".$name.romsafe-tmp")
        Files.write(temp, bytes)
        move(temp, target)
        entry(target, join(relParent, target.name)) ?: FileEntry(join(relParent, target.name), bytes.size.toLong(), System.currentTimeMillis(), false)
    }

    override suspend fun stat(path: String): FileEntry? = withContext(Dispatchers.IO) {
        val (real, rel) = resolve(path) ?: return@withContext null
        entry(real, rel)
    }

    override suspend fun openSink(path: String, append: Boolean): FileSink = withContext(Dispatchers.IO) {
        val (parent, _) = ensureDir(path.substringBeforeLast('/', ""))
        val name = path.substringAfterLast('/')
        val target = existingChild(parent, name) ?: parent.resolve(name)
        val options = if (append) {
            arrayOf(StandardOpenOption.CREATE, StandardOpenOption.APPEND, StandardOpenOption.WRITE)
        } else {
            arrayOf(StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE)
        }
        StreamSink(Files.newOutputStream(target, *options).buffered(256 * 1024))
    }

    override suspend fun replace(from: String, to: String) = withContext(Dispatchers.IO) {
        val (source, _) = resolve(from) ?: throw NoSuchFileException(from)
        val (parent, _) = ensureDir(to.substringBeforeLast('/', ""))
        val name = to.substringAfterLast('/')
        move(source, existingChild(parent, name) ?: parent.resolve(name))
    }

    override suspend fun delete(path: String) = withContext(Dispatchers.IO) {
        resolve(path)?.let { (real, _) -> Files.deleteIfExists(real) }
        Unit
    }

    private class StreamSink(private val out: OutputStream) : FileSink {
        override suspend fun write(bytes: ByteArray, offset: Int, length: Int) = withContext(Dispatchers.IO) { out.write(bytes, offset, length) }

        override suspend fun close() = withContext(Dispatchers.IO) { out.close() }
    }

    private fun move(source: Path, target: Path) {
        try {
            Files.move(source, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
        } catch (e: AtomicMoveNotSupportedException) {
            Files.move(source, target, StandardCopyOption.REPLACE_EXISTING)
        }
    }

    private fun entry(real: Path, rel: String): FileEntry? = try {
        val a = Files.readAttributes(real, BasicFileAttributes::class.java, LinkOption.NOFOLLOW_LINKS)
            .takeUnless { it.isSymbolicLink }
            ?: Files.readAttributes(real, BasicFileAttributes::class.java)
        FileEntry(rel, if (a.isDirectory) 0 else a.size(), a.lastModifiedTime().toMillis(), a.isDirectory)
    } catch (e: java.io.IOException) {
        null
    }

    /** The real path and its real spelling relative to the root, or null when nothing is there. */
    private fun resolve(path: String): Pair<Path, String>? {
        if (path.isEmpty()) return root to ""
        val parts = safeParts(path)
        val direct = root.resolve(parts.joinToString("/"))
        // Callers pass paths they listed, so the spelling asked for is the real one in practice.
        if (Files.exists(direct, LinkOption.NOFOLLOW_LINKS)) return direct to parts.joinToString("/")
        var current = root
        val real = mutableListOf<String>()
        for (part in parts) {
            current = existingChild(current, part) ?: return null
            real += current.name
        }
        return current to real.joinToString("/")
    }

    /** Creates [dir] (and its parents) where missing, reusing folders that exist with other case. */
    private fun ensureDir(dir: String): Pair<Path, String> {
        var current = root
        val real = mutableListOf<String>()
        if (dir.isNotEmpty()) {
            for (part in safeParts(dir)) {
                current = existingChild(current, part) ?: Files.createDirectories(current.resolve(part))
                real += current.name
            }
        } else {
            Files.createDirectories(root)
        }
        return current to real.joinToString("/")
    }

    private fun existingChild(dir: Path, name: String): Path? {
        val exact = dir.resolve(name)
        if (Files.exists(exact, LinkOption.NOFOLLOW_LINKS)) return exact
        if (!Files.isDirectory(dir)) return null
        return Files.newDirectoryStream(dir).use { s -> s.firstOrNull { it.name.equals(name, ignoreCase = true) } }
    }

    private fun safeParts(path: String): List<String> {
        val parts = path.replace('\\', '/').split('/').filter { it.isNotEmpty() && it != "." }
        require(parts.none { it == ".." }) { "Unsafe path: $path" }
        return parts
    }

    private fun join(dir: String, name: String) = if (dir.isEmpty()) name else "$dir/$name"
}
