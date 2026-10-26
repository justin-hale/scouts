package app.romsafe.desktop.sync

import app.romsafe.desktop.data.AppDirs
import app.romsafe.desktop.data.DesktopStore
import app.romsafe.desktop.data.NioFileTree
import app.romsafe.shared.api.DeviceConfig
import app.romsafe.shared.api.RomSafeApi
import app.romsafe.shared.api.SaveLayout
import app.romsafe.shared.setup.PlatformSetup
import app.romsafe.shared.sync.DownloadQueue
import app.romsafe.shared.sync.DownloadState
import app.romsafe.shared.sync.FileTree
import app.romsafe.shared.sync.HashCache
import app.romsafe.shared.sync.QueueOutcome
import app.romsafe.shared.sync.SaveMatcher
import app.romsafe.shared.sync.SyncReport
import app.romsafe.shared.sync.SyncSession
import app.romsafe.shared.sync.SyncStatus
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import kotlin.io.path.isDirectory

/**
 * The desktop's background sync: a full run on demand ("Sync now", the tray),
 * every [PERIOD_MS], and [SETTLE_MS] after a watched save folder last changed.
 * Only one run happens at once; a second caller waits for it and gets its report.
 */
class SyncService(private val store: DesktopStore, private val scope: CoroutineScope) {
    private val mutex = Mutex()
    private val _status = MutableStateFlow(SyncStatus(last = store.lastSyncReport()))
    val status: StateFlow<SyncStatus> = _status

    val downloads = DownloadState()

    private val _watched = MutableStateFlow(0)

    /** How many folders the file watcher covers; 0 when nothing is set up. */
    val watched: StateFlow<Int> = _watched

    private var watcher: FolderWatcher? = null
    private var watchGeneration = 0
    private var settleJob: Job? = null
    private var periodicJob: Job? = null
    private var downloadJob: Job? = null
    private var downloadAgain = false

    private val cacheFile: Path = AppDirs.data.resolve("hash-cache.json")

    private fun cache() = HashCache(
        { cacheFile.takeIf { Files.exists(it) }?.let(Files::readString) },
        { Files.createDirectories(cacheFile.parent); Files.writeString(cacheFile, it) },
    )

    private fun open(location: String): FileTree? =
        runCatching { Paths.get(location) }.getOrNull()?.takeIf { it.isDirectory() }?.let(::NioFileTree)

    fun startPeriodic() {
        periodicJob?.cancel()
        periodicJob = scope.launch {
            while (true) {
                delay(PERIOD_MS)
                run()
            }
        }
    }

    fun syncNow() {
        scope.launch { run() }
    }

    suspend fun run(): SyncReport? {
        if (!mutex.tryLock()) return mutex.withLock { _status.value.last }
        try {
            _status.update { it.copy(running = true, step = "Connecting") }
            val report = withContext(Dispatchers.IO) { runLocked() } ?: return null
            store.saveSyncReport(report)
            _status.update { SyncStatus(last = report) }
            return report
        } finally {
            _status.update { it.copy(running = false, step = null) }
            mutex.unlock()
        }
    }

    private suspend fun runLocked(): SyncReport? {
        val pairing = store.pairing() ?: return null
        return try {
            RomSafeApi(pairing.serverUrl, pairing.token).use { api ->
                val session = SyncSession(api, cache(), System::currentTimeMillis, ::open)
                val report = session.run(store.setups()) { step -> _status.update { it.copy(step = step) } }
                if (session.queuePending) startDownloads()
                report
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            SyncReport(System.currentTimeMillis(), error = e.message ?: e.javaClass.simpleName)
        }
    }

    // --- file watching --------------------------------------------------------------

    /** Watches the save folders of every set-up emulator; call again whenever the setup changes. */
    fun watch(config: DeviceConfig?, setups: Map<String, PlatformSetup>) {
        val generation = ++watchGeneration
        watcher?.close()
        watcher = null
        _watched.value = 0
        if (config == null || store.pairing() == null) return
        val profiles = config.profiles.associateBy { it.id }
        // Several platforms can share a folder (Dolphin's GC and Wii, RetroArch's everything).
        val matchers = mutableMapOf<String, MutableList<SaveMatcher>>()
        for (p in config.platforms) {
            for (e in setups[p.slug]?.emulators.orEmpty()) {
                val location = e.saveUri ?: continue
                val profile = profiles[e.profile]?.takeIf { e.profile in p.profiles } ?: continue
                matchers.getOrPut(location) { mutableListOf() } += SaveMatcher(SaveLayout.rules(profile, p))
            }
        }
        val roots = matchers.mapNotNull { (location, list) ->
            val path = runCatching { Paths.get(location) }.getOrNull()?.takeIf { it.isDirectory() } ?: return@mapNotNull null
            WatchRoot(path) { rel -> list.any { it.mayContain(rel) } }
        }
        if (roots.isEmpty()) return
        // Registering walks the folders, so it happens off the UI thread; a newer call wins.
        scope.launch {
            val w = withContext(Dispatchers.IO) { FolderWatcher(roots) { scope.launch { settle() } } }
            if (generation != watchGeneration) {
                w.close()
                return@launch
            }
            watcher = w
            _watched.value = w.watchedFolders
        }
    }

    /** Syncs once the folders have been quiet for a while: emulators often write a save in several steps. */
    private fun settle() {
        settleJob?.cancel()
        settleJob = scope.launch {
            delay(SETTLE_MS)
            // A run in progress may have missed this change; wait for it, then sync again.
            mutex.withLock { }
            run()
        }
    }

    // --- ROM downloads ----------------------------------------------------------------

    /** Works through the server's download queue; asking while it runs makes it look again at the end. */
    fun startDownloads() {
        synchronized(this) {
            if (downloadJob?.isActive == true) {
                downloadAgain = true
                return
            }
            downloadJob = scope.launch(Dispatchers.IO) {
                var retries = 0
                do {
                    synchronized(this@SyncService) { downloadAgain = false }
                    val outcome = drain()
                    if (outcome == QueueOutcome.Retry && retries++ < 3) {
                        delay(30_000)
                        downloadAgain = true
                    }
                } while (synchronized(this@SyncService) { downloadAgain })
            }
        }
    }

    private suspend fun drain(): QueueOutcome {
        val pairing = store.pairing() ?: return QueueOutcome.Done
        return try {
            RomSafeApi(pairing.serverUrl, pairing.token).use { api ->
                DownloadQueue(api, downloads, cache(), System::currentTimeMillis, ::open).drain(store.setups())
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            downloads.failAll(e.message ?: e.javaClass.simpleName)
            QueueOutcome.Failed
        }
    }

    fun stop() {
        periodicJob?.cancel()
        settleJob?.cancel()
        watcher?.close()
        watcher = null
        _watched.value = 0
    }

    companion object {
        const val PERIOD_MS = 15 * 60_000L

        /** Longer than SyncEngine.RECENT_MS, so the files that changed aren't skipped as busy. */
        const val SETTLE_MS = 8_000L
    }
}
