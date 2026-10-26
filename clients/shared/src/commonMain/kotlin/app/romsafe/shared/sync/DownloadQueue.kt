package app.romsafe.shared.sync

import app.romsafe.shared.api.RomSafeApi
import app.romsafe.shared.setup.PlatformSetup
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.io.IOException

/** A ROM download as the library shows it. */
data class DownloadItem(val romId: Long, val name: String, val done: Long = 0, val total: Long = 0, val error: String? = null)

/** Live download state for the library screens. */
open class DownloadState {
    private val _items = MutableStateFlow<Map<Long, DownloadItem>>(emptyMap())
    val items: StateFlow<Map<Long, DownloadItem>> = _items

    /** Bumped after each finished download, so the library reloads. */
    private val _finished = MutableStateFlow(0)
    val finished: StateFlow<Int> = _finished

    /** ROMs queued from this app since it started; [failAll] reports on these. */
    val pendingIds: MutableSet<Long> = mutableSetOf()

    fun update(item: DownloadItem) = _items.update { it + (item.romId to item) }

    fun done(romId: Long) {
        _items.update { it - romId }
        _finished.update { it + 1 }
    }

    fun clearError(romId: Long) = _items.update { m -> if (m[romId]?.error != null) m - romId else m }

    /** Marks the queued ROMs the library knows about as failed, so they don't sit at "Waiting" forever. */
    fun failAll(message: String) {
        pendingIds.forEach { id -> update(DownloadItem(id, _items.value[id]?.name ?: "", error = message)) }
    }
}

enum class QueueOutcome { Done, Retry, Failed }

/**
 * Downloads every ROM in this device's server queue into its platform's ROM
 * folder, one at a time. Network trouble stops the run with [QueueOutcome.Retry]
 * (part files let it resume); other per-ROM errors skip that ROM.
 */
class DownloadQueue(
    private val api: RomSafeApi,
    private val state: DownloadState,
    private val cache: HashCache,
    private val now: () -> Long,
    private val open: (String) -> FileTree?,
) {
    suspend fun drain(
        setups: Map<String, PlatformSetup>,
        isStopped: () -> Boolean = { false },
        onProgress: (DownloadItem) -> Unit = {},
    ): QueueOutcome {
        val config = try {
            api.config()
        } catch (e: CancellationException) {
            throw e
        } catch (e: IOException) {
            return QueueOutcome.Retry
        } catch (e: Exception) {
            state.failAll(e.message ?: e.toString())
            return QueueOutcome.Failed
        }
        val platforms = config.platforms.associateBy { it.slug }
        val skipped = mutableSetOf<Long>()

        while (!isStopped()) {
            val rom = try {
                api.queue().firstOrNull { it.id !in skipped }
            } catch (e: CancellationException) {
                throw e
            } catch (e: IOException) {
                return QueueOutcome.Retry
            } catch (e: Exception) {
                state.failAll("Couldn't read the download queue: ${e.message ?: e}")
                return QueueOutcome.Failed
            } ?: break
            val platform = platforms[rom.platform]
            val romLocation = setups[rom.platform]?.romUri
            val tree = romLocation?.let(open)
            if (platform == null || romLocation == null || tree == null) {
                val name = platform?.name ?: rom.platform
                state.update(DownloadItem(rom.id, rom.fileName, error = "Choose a ROM folder for $name first"))
                skipped += rom.id
                continue
            }
            state.update(DownloadItem(rom.id, rom.fileName))
            try {
                RomDownloader(api).download(rom, tree) { done, total ->
                    val item = DownloadItem(rom.id, rom.fileName, done, total)
                    state.update(item)
                    onProgress(item)
                }
                // Report the new ROM so the server matches it (and saves follow), then make sure it's off the queue.
                runCatching { SyncEngine(api, cache, now).reportRoms(platform, tree, romLocation) }
                runCatching { api.dequeue(rom.id) }
                state.done(rom.id)
            } catch (e: CancellationException) {
                throw e
            } catch (e: IOException) {
                state.update(DownloadItem(rom.id, rom.fileName, error = "Interrupted; will resume"))
                return QueueOutcome.Retry
            } catch (e: Exception) {
                state.update(DownloadItem(rom.id, rom.fileName, error = e.message ?: e.toString()))
                skipped += rom.id
            }
        }
        return QueueOutcome.Done
    }
}
