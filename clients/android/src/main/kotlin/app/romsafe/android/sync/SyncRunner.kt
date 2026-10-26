package app.romsafe.android.sync

import android.content.Context
import android.net.Uri
import app.romsafe.android.RomSafeApp
import app.romsafe.android.data.Folders
import app.romsafe.android.data.SafFileTree
import app.romsafe.shared.api.RomSafeApi
import app.romsafe.shared.sync.HashCache
import app.romsafe.shared.sync.SyncReport
import app.romsafe.shared.sync.SyncSession
import app.romsafe.shared.sync.SyncStatus
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Runs a full sync of every set-up platform, one at a time, for both "Sync
 * now" and the background worker. Only one run happens at once; a second
 * caller waits for it and gets its report.
 */
object SyncRunner {
    private val mutex = Mutex()
    private val _status = MutableStateFlow(SyncStatus())
    val status: StateFlow<SyncStatus> = _status

    fun init(app: RomSafeApp) {
        _status.update { it.copy(last = app.store.lastSyncReport()) }
    }

    suspend fun run(app: RomSafeApp): SyncReport? {
        if (!mutex.tryLock()) return mutex.withLock { _status.value.last }
        try {
            _status.update { it.copy(running = true, step = "Connecting") }
            val report = withContext(Dispatchers.IO) { runLocked(app) } ?: return null
            app.store.saveSyncReport(report)
            _status.update { SyncStatus(last = report) }
            return report
        } finally {
            _status.update { it.copy(running = false, step = null) }
            mutex.unlock()
        }
    }

    private suspend fun runLocked(app: RomSafeApp): SyncReport? {
        val store = app.store
        val pairing = store.pairing() ?: return null
        val ctx: Context = app.applicationContext
        return try {
            RomSafeApi(pairing.serverUrl, pairing.token).use { api ->
                val granted = Folders.grantedUris(ctx)
                val cacheFile = File(ctx.filesDir, "hash-cache.json")
                val cache = HashCache({ cacheFile.takeIf { it.exists() }?.readText() }, { cacheFile.writeText(it) })
                val session = SyncSession(api, cache, System::currentTimeMillis) { uri ->
                    uri.takeIf { it in granted }?.let { SafFileTree(ctx, Uri.parse(it)) }
                }
                val report = session.run(store.setups()) { step -> _status.update { it.copy(step = step) } }
                if (session.queuePending) Downloads.start(ctx)
                report
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            SyncReport(System.currentTimeMillis(), error = e.message ?: e.javaClass.simpleName)
        }
    }
}
