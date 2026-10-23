package app.romsafe.shared.sync

import app.romsafe.shared.api.QueuedRom
import app.romsafe.shared.api.RomSafeApi
import io.ktor.utils.io.ByteReadChannel
import io.ktor.utils.io.readAvailable

/**
 * Downloads queued ROMs into a platform's ROM folder (docs/sync-protocol.md, "ROMs").
 *
 * Single files go to a hidden `.<name>.romsafe-part` next to their target and
 * are renamed into place when complete; an interrupted download resumes from
 * the part file with a Range request. Multi-file sets arrive as one stored zip,
 * which is unpacked as it streams into the ROM's folder.
 */
class RomDownloader(private val api: RomSafeApi) {
    /** Returns the paths written, relative to the ROM folder. [progress] gets (bytes done, bytes total). */
    suspend fun download(rom: QueuedRom, tree: FileTree, progress: (Long, Long) -> Unit): List<String> {
        val relPath = safePath(rom.relPath)
        return if (rom.multiFile) downloadSet(rom, tree, relPath, progress) else downloadFile(rom, tree, relPath, progress)
    }

    private suspend fun downloadFile(rom: QueuedRom, tree: FileTree, relPath: String, progress: (Long, Long) -> Unit): List<String> {
        val part = partPath(relPath)
        val have = tree.stat(part)?.size ?: 0
        api.downloadRom(rom.id, from = have) { stream ->
            val start = if (stream.resumed) have else 0
            val total = start + (stream.length ?: (rom.size - start))
            val sink = tree.openSink(part, append = stream.resumed)
            try {
                copy(stream.channel, sink, Long.MAX_VALUE, start, total, progress)
            } finally {
                sink.close()
            }
        }
        val size = tree.stat(part)?.size
        if (size != rom.size) error("Download of ${rom.fileName} stopped at $size of ${rom.size} bytes")
        tree.replace(part, relPath)
        return listOf(relPath)
    }

    private suspend fun downloadSet(rom: QueuedRom, tree: FileTree, relPath: String, progress: (Long, Long) -> Unit): List<String> {
        val dir = relPath.substringBeforeLast('/', "")
        val written = mutableListOf<String>()
        api.downloadRom(rom.id, from = 0) { stream ->
            val total = stream.length ?: rom.totalSize ?: rom.size
            var done = 0L
            val ch = stream.channel
            while (true) {
                val header = ByteArray(30)
                ch.readExact(header, 4)
                val signature = header.u32(0)
                if (signature != LOCAL_HEADER) {
                    // The central directory follows the last entry; nothing more to unpack.
                    if (signature == CENTRAL_HEADER || signature == END_RECORD) break
                    error("Unexpected data in the download of ${rom.fileName}")
                }
                ch.readExact(header, 26, offset = 4)
                val flags = header.u16(6)
                val method = header.u16(8)
                val size = header.u32(22)
                val nameLength = header.u16(26)
                val extraLength = header.u16(28)
                if (method != 0 || flags and 0x08 != 0) error("The server sent a compressed set; update the server")
                val nameBytes = ByteArray(nameLength).also { ch.readExact(it, nameLength) }
                if (extraLength > 0) ch.readExact(ByteArray(extraLength), extraLength)
                val name = safePath(nameBytes.decodeToString())
                val target = if (dir.isEmpty()) name else "$dir/$name"
                val part = partPath(target)
                val sink = tree.openSink(part, append = false)
                try {
                    done = copy(ch, sink, size, done, total, progress)
                } finally {
                    sink.close()
                }
                tree.replace(part, target)
                written += target
                done += 30 + nameLength + extraLength
            }
        }
        if (written.isEmpty()) error("The download of ${rom.fileName} was empty")
        return written
    }

    /** Copies up to [limit] bytes (or to the end), reporting progress; returns the new done count. */
    private suspend fun copy(
        ch: ByteReadChannel,
        sink: FileSink,
        limit: Long,
        start: Long,
        total: Long,
        progress: (Long, Long) -> Unit,
    ): Long {
        val buffer = ByteArray(256 * 1024)
        var left = limit
        var done = start
        var reported = 0L
        while (left > 0) {
            val n = ch.readAvailable(buffer, 0, minOf(buffer.size.toLong(), left).toInt())
            if (n < 0) {
                if (limit != Long.MAX_VALUE) error("The download ended early")
                break
            }
            if (n == 0) continue
            sink.write(buffer, 0, n)
            left -= n
            done += n
            if (done - reported >= 1024 * 1024 || done == total) {
                progress(done, total)
                reported = done
            }
        }
        progress(done, total)
        return done
    }

    private suspend fun ByteReadChannel.readExact(dst: ByteArray, length: Int, offset: Int = 0) {
        var read = 0
        while (read < length) {
            val n = readAvailable(dst, offset + read, length - read)
            if (n < 0) error("The download ended early")
            read += n
        }
    }

    private fun ByteArray.u16(at: Int): Int = (this[at].toInt() and 0xff) or ((this[at + 1].toInt() and 0xff) shl 8)

    private fun ByteArray.u32(at: Int): Long = (u16(at).toLong()) or (u16(at + 2).toLong() shl 16)

    companion object {
        private const val LOCAL_HEADER = 0x04034b50L
        private const val CENTRAL_HEADER = 0x02014b50L
        private const val END_RECORD = 0x06054b50L

        fun partPath(path: String): String {
            val dir = path.substringBeforeLast('/', "")
            val name = ".${path.substringAfterLast('/')}.romsafe-part"
            return if (dir.isEmpty()) name else "$dir/$name"
        }

        /** Server paths are trusted, but never let one climb out of the ROM folder. */
        fun safePath(path: String): String {
            val parts = path.replace('\\', '/').split('/').filter { it.isNotEmpty() && it != "." }
            require(parts.isNotEmpty() && parts.none { it == ".." }) { "Unsafe path: $path" }
            return parts.joinToString("/")
        }
    }
}
