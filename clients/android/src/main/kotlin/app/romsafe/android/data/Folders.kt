package app.romsafe.android.data

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import androidx.documentfile.provider.DocumentFile

/** Helpers for SAF folder grants (tree URIs). */
object Folders {
    private const val EXTERNAL_STORAGE = "com.android.externalstorage.documents"
    private const val FLAGS = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION

    /**
     * A readable name for a picked folder: "Internal storage/RetroArch/saves" for
     * shared storage, or "<app>/<folder>" for app-provided roots such as Dolphin's.
     */
    fun label(context: Context, uri: Uri): String = runCatching {
        val docId = DocumentsContract.getTreeDocumentId(uri)
        if (uri.authority == EXTERNAL_STORAGE) {
            val volume = docId.substringBefore(':')
            val path = docId.substringAfter(':', "")
            val root = if (volume.equals("primary", ignoreCase = true)) "Internal storage" else "SD card"
            if (path.isEmpty()) root else "$root/$path"
        } else {
            val pm = context.packageManager
            val app = uri.authority?.let { pm.resolveContentProvider(it, 0)?.loadLabel(pm)?.toString() }
            val name = DocumentFile.fromTreeUri(context, uri)?.name
            listOfNotNull(app, name?.takeIf { it != app }).joinToString("/").ifEmpty { docId }
        }
    }.getOrDefault(uri.toString())

    /** Where the system picker should open, from a profile hint like "RetroArch/saves". */
    fun initialUri(relativePath: String?): Uri? =
        relativePath?.let { DocumentsContract.buildDocumentUri(EXTERNAL_STORAGE, "primary:$it") }

    /**
     * Checks that [uri] directly contains one of [topFolders] (e.g. "Nintendo 3DS"),
     * which catches a folder picked one level off. Returns what's wrong, or null.
     * Blocking: lists the folder.
     */
    fun layoutProblem(context: Context, uri: Uri, topFolders: Set<String>): String? {
        if (topFolders.isEmpty()) return null
        val dir = DocumentFile.fromTreeUri(context, uri) ?: return null
        val expected = topFolders.map { it.lowercase() }
        val names = runCatching { dir.listFiles().mapNotNull { it.name?.lowercase() } }.getOrNull() ?: return null
        if (names.any { it in expected }) return null
        val wanted = topFolders.joinToString(" or ") { "\"$it\"" }
        return if (dir.name?.lowercase() in expected) {
            "This is the $wanted folder itself. Pick the folder that contains it."
        } else {
            "There's no $wanted folder in here. Pick the folder that contains it."
        }
    }

    fun grantedUris(context: Context): Set<String> =
        context.contentResolver.persistedUriPermissions
            .filter { it.isReadPermission && it.isWritePermission }
            .mapTo(mutableSetOf()) { it.uri.toString() }

    fun keep(context: Context, uri: Uri) = context.contentResolver.takePersistableUriPermission(uri, FLAGS)

    fun release(context: Context, uri: Uri) {
        runCatching { context.contentResolver.releasePersistableUriPermission(uri, FLAGS) }
    }
}
