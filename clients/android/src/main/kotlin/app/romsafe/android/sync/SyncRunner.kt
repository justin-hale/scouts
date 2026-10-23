package app.romsafe.android.sync

import android.content.Context
import android.net.Uri
import app.romsafe.android.RomSafeApp
import app.romsafe.android.data.Folders
import app.romsafe.android.data.PlatformSetup
import app.romsafe.android.data.SafFileTree
import app.romsafe.shared.api.DeviceConfig
import app.romsafe.shared.api.Mapping
import app.romsafe.shared.api.RomSafeApi
import app.romsafe.shared.sync.EmulatorFolder
import app.romsafe.shared.sync.HashCache
import app.romsafe.shared.sync.PlatformJob
import app.romsafe.shared.sync.SyncEngine
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import java.io.File

@Serializable
data class PlatformSummary(
    val name: String,
    val uploaded: Int = 0,
    val downloaded: Int = 0,
    val inSync: Int = 0,
    val conflicts: List<String> = emptyList(),
    val busy: Int = 0,
    val issues: List<String> = emptyList(),
)

@Serializable
data class SyncReport(
    val finishedAt: Long,
    val platforms: List<PlatformSummary> = emptyList(),
    /** Set when the whole run failed (server unreachable, not paired …). */
    val error: String? = null,
) {
    val uploaded get() = platforms.sumOf { it.uploaded }
    val downloaded get() = platforms.sumOf { it.downloaded }
    val conflicts get() = platforms.sumOf { it.conflicts.size }
    val issues get() = platforms.flatMap { p -> p.issues.map { "${p.name}: $it" } }
}

data class SyncStatus(val running: Boolean = false, val step: String? = null, val last: SyncReport? = null)

/** The mappings PUT body: one entry per emulator that has a save folder. */
fun mappingsFor(config: DeviceConfig, setups: Map<String, PlatformSetup>): List<Mapping> =
    config.platforms.flatMap { p ->
        val setup = setups[p.slug] ?: return@flatMap emptyList()
        setup.emulators.mapNotNull { e ->
            val save = e.saveUri ?: return@mapNotNull null
            if (e.profile !in p.profiles) return@mapNotNull null
            Mapping(platform = p.slug, profile = e.profile, slot = e.slot, saveRoot = save, romRoot = setup.romUri)
        }
    }

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
                val config = api.config()
                val setups = store.setups()
                // Re-send the mappings each run, so a change that couldn't be saved earlier can't leave the server without one.
                api.putMappings(mappingsFor(config, setups))

                val granted = Folders.grantedUris(ctx)
                val profiles = config.profiles.associateBy { it.id }
                val cacheFile = File(ctx.filesDir, "hash-cache.json")
                val cache = HashCache({ cacheFile.takeIf { it.exists() }?.readText() }, { cacheFile.writeText(it) })
                val engine = SyncEngine(api, cache, now = System::currentTimeMillis)

                val summaries = config.platforms.mapNotNull { p ->
                    val setup = setups[p.slug] ?: return@mapNotNull null
                    val emulators = setup.emulators.mapNotNull { e ->
                        val uri = e.saveUri?.takeIf { it in granted } ?: return@mapNotNull null
                        val profile = profiles[e.profile]?.takeIf { e.profile in p.profiles } ?: return@mapNotNull null
                        EmulatorFolder(e.slot, profile, SafFileTree(ctx, Uri.parse(uri)), uri)
                    }
                    if (emulators.isEmpty()) return@mapNotNull null
                    val romUri = setup.romUri?.takeIf { it in granted }
                    val job = PlatformJob(p, romUri?.let { SafFileTree(ctx, Uri.parse(it)) }, romUri, emulators)
                    val r = engine.syncPlatform(job) { step -> _status.update { it.copy(step = "${p.name}: $step") } }
                    PlatformSummary(
                        name = p.name,
                        uploaded = r.uploaded,
                        downloaded = r.downloaded,
                        inSync = r.inSync,
                        conflicts = r.conflicts,
                        busy = r.busy,
                        issues = r.issues.map { i -> listOfNotNull(i.path?.substringAfterLast('/'), i.message).joinToString(": ") },
                    )
                }
                // ROMs queued from the web app download after the sync.
                if (runCatching { api.queue().isNotEmpty() }.getOrDefault(false)) Downloads.start(ctx)
                SyncReport(System.currentTimeMillis(), summaries)
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            SyncReport(System.currentTimeMillis(), error = e.message ?: e.javaClass.simpleName)
        }
    }
}
