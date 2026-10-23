package app.romsafe.android.data

import android.content.ContentResolver
import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document
import app.romsafe.shared.sync.FileEntry
import app.romsafe.shared.sync.FileTree
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * A [FileTree] over a SAF folder grant. Talks to DocumentsContract directly
 * rather than DocumentFile, which re-queries the provider for every property
 * and is far too slow for folders with hundreds of files.
 *
 * Paths resolve case-insensitively, because the server may name a folder
 * "Nintendo 3DS" that the emulator created with different case.
 */
class SafFileTree(context: Context, private val treeUri: Uri) : FileTree {
    private val resolver: ContentResolver = context.contentResolver
    private val rootId = DocumentsContract.getTreeDocumentId(treeUri)

    /** Lower-cased path → (document id, real path). Filled as folders are listed. */
    private val ids = HashMap<String, Pair<String, String>>().apply { put("", rootId to "") }

    override suspend fun list(dir: String): List<FileEntry> = withContext(Dispatchers.IO) {
        val (id, realDir) = resolve(dir) ?: return@withContext emptyList()
        children(id, realDir)
    }

    override suspend fun read(path: String): ByteArray = withContext(Dispatchers.IO) {
        val (id, _) = resolve(path) ?: error("$path is gone")
        resolver.openInputStream(docUri(id))?.use { it.readBytes() } ?: error("Can't open $path")
    }

    override suspend fun write(path: String, bytes: ByteArray): FileEntry = withContext(Dispatchers.IO) {
        val parent = path.substringBeforeLast('/', "")
        val name = path.substringAfterLast('/')
        val (parentId, realParent) = ensureDir(parent)
        val target = join(realParent, name)
        val existing = resolve(target)?.first

        // Write a hidden temp file next to the target, then swap it in, so the
        // emulator never reads half a save.
        val tempName = ".$name.romsafe-tmp"
        resolve(join(realParent, tempName))?.let { (id, _) -> DocumentsContract.deleteDocument(resolver, docUri(id)) }
        val temp = DocumentsContract.createDocument(resolver, docUri(parentId), "application/octet-stream", tempName)
            ?: error("Can't create files in ${realParent.ifEmpty { "the folder" }}")
        resolver.openOutputStream(temp, "w")?.use { it.write(bytes) } ?: error("Can't write $path")

        val finalUri = if (supportsRename(temp)) {
            existing?.let { DocumentsContract.deleteDocument(resolver, docUri(it)) }
            DocumentsContract.renameDocument(resolver, temp, name) ?: temp
        } else {
            // The provider can't rename (some app-provided roots): write in place instead.
            DocumentsContract.deleteDocument(resolver, temp)
            val uri = existing?.let(::docUri)
                ?: DocumentsContract.createDocument(resolver, docUri(parentId), "application/octet-stream", name)
                ?: error("Can't create $path")
            resolver.openOutputStream(uri, "wt")?.use { it.write(bytes) } ?: error("Can't write $path")
            uri
        }
        forgetChildren(realParent)
        val id = DocumentsContract.getDocumentId(finalUri)
        ids[target.lowercase()] = id to target
        entry(id, target) ?: FileEntry(target, bytes.size.toLong(), System.currentTimeMillis(), false)
    }

    private fun resolve(path: String): Pair<String, String>? {
        val key = path.lowercase()
        ids[key]?.let { return it }
        if (path.isEmpty()) return null
        val parent = path.substringBeforeLast('/', "")
        val (parentId, realParent) = resolve(parent) ?: return null
        children(parentId, realParent)
        return ids[key]
    }

    private fun ensureDir(path: String): Pair<String, String> {
        if (path.isEmpty()) return rootId to ""
        resolve(path)?.let { return it }
        val (parentId, realParent) = ensureDir(path.substringBeforeLast('/', ""))
        val name = path.substringAfterLast('/')
        val uri = DocumentsContract.createDocument(resolver, docUri(parentId), Document.MIME_TYPE_DIR, name)
            ?: error("Can't create folder $name")
        val real = join(realParent, name)
        return (DocumentsContract.getDocumentId(uri) to real).also { ids[real.lowercase()] = it }
    }

    private fun children(id: String, dir: String): List<FileEntry> {
        val uri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, id)
        val out = mutableListOf<FileEntry>()
        resolver.query(uri, COLUMNS, null, null, null)?.use { c ->
            while (c.moveToNext()) {
                val path = join(dir, c.getString(1) ?: continue)
                ids[path.lowercase()] = c.getString(0) to path
                out += c.toEntry(path)
            }
        }
        return out
    }

    private fun entry(id: String, path: String): FileEntry? =
        resolver.query(docUri(id), COLUMNS, null, null, null)?.use { c -> if (c.moveToFirst()) c.toEntry(path) else null }

    private fun supportsRename(uri: Uri): Boolean =
        resolver.query(uri, arrayOf(Document.COLUMN_FLAGS), null, null, null)?.use { c ->
            c.moveToFirst() && (c.getInt(0) and Document.FLAG_SUPPORTS_RENAME) != 0
        } == true

    /** Renames and deletes change document ids under [dir]; look them up again next time. */
    private fun forgetChildren(dir: String) {
        val prefix = if (dir.isEmpty()) "" else "${dir.lowercase()}/"
        ids.keys.removeAll { it.isNotEmpty() && it.startsWith(prefix) && '/' !in it.removePrefix(prefix) }
    }

    private fun docUri(id: String): Uri = DocumentsContract.buildDocumentUriUsingTree(treeUri, id)

    private fun Cursor.toEntry(path: String): FileEntry = FileEntry(
        path = path,
        size = if (isNull(3)) 0 else getLong(3),
        modified = if (isNull(4)) 0 else getLong(4),
        isDirectory = getString(2) == Document.MIME_TYPE_DIR,
    )

    private companion object {
        val COLUMNS = arrayOf(
            Document.COLUMN_DOCUMENT_ID,
            Document.COLUMN_DISPLAY_NAME,
            Document.COLUMN_MIME_TYPE,
            Document.COLUMN_SIZE,
            Document.COLUMN_LAST_MODIFIED,
        )

        fun join(dir: String, name: String) = if (dir.isEmpty()) name else "$dir/$name"
    }
}
