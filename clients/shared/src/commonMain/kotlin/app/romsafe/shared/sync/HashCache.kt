package app.romsafe.shared.sync

import app.romsafe.shared.api.RomSafeApi
import kotlinx.serialization.Serializable

expect fun sha256Hex(bytes: ByteArray): String

expect fun sha1Hex(bytes: ByteArray): String

/**
 * Remembers file hashes by path, size and modified time, so a sync only reads
 * files that changed. [load] and [store] persist it (a small JSON file).
 */
class HashCache(private val load: () -> String?, private val store: (String) -> Unit) {
    @Serializable
    private data class Entry(val size: Long, val modified: Long, val hash: String)

    private val entries: MutableMap<String, Entry> by lazy {
        load()?.let { runCatching { RomSafeApi.json.decodeFromString<Map<String, Entry>>(it) }.getOrNull() }
            ?.toMutableMap() ?: mutableMapOf()
    }
    private var dirty = false

    /** [scope] separates trees and hash kinds, e.g. "sha256:<folder uri>". */
    fun get(scope: String, file: FileEntry): String? =
        entries[key(scope, file.path)]?.takeIf { it.size == file.size && it.modified == file.modified }?.hash

    fun put(scope: String, file: FileEntry, hash: String) {
        entries[key(scope, file.path)] = Entry(file.size, file.modified, hash)
        dirty = true
    }

    /** Drop entries for files no longer in [scope], so the cache doesn't grow forever. */
    fun retain(scope: String, paths: Set<String>) {
        val prefix = "$scope\n"
        if (entries.keys.removeAll { it.startsWith(prefix) && it.removePrefix(prefix) !in paths }) dirty = true
    }

    fun flush() {
        if (!dirty) return
        store(RomSafeApi.json.encodeToString(entries.toMap()))
        dirty = false
    }

    private fun key(scope: String, path: String) = "$scope\n$path"
}
