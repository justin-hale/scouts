package app.romsafe.shared.sync

/** A file or folder inside a [FileTree]; [path] is relative to the tree's root, with `/` separators. */
data class FileEntry(val path: String, val size: Long, val modified: Long, val isDirectory: Boolean) {
    val name: String get() = path.substringAfterLast('/')
}

/**
 * A folder the user picked: an Android SAF tree, or a plain directory on
 * desktop. Paths are relative to the root and never contain `..`.
 */
interface FileTree {
    /** Direct children of [dir] ("" for the root). Empty if it doesn't exist. */
    suspend fun list(dir: String): List<FileEntry>

    suspend fun read(path: String): ByteArray

    /**
     * Creates or replaces [path], making parent folders as needed, so that a
     * reader never sees half a file (write elsewhere, then swap). Returns the
     * written file's entry.
     */
    suspend fun write(path: String, bytes: ByteArray): FileEntry
}

/** Every file under [dir] whose folders [descend] accepts, depth first. */
suspend fun FileTree.walk(dir: String = "", descend: (String) -> Boolean = { true }): List<FileEntry> {
    val out = mutableListOf<FileEntry>()
    for (entry in list(dir)) {
        if (entry.isDirectory) {
            if (descend(entry.path)) out += walk(entry.path, descend)
        } else {
            out += entry
        }
    }
    return out
}
