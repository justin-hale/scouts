package app.romsafe.shared.sync

import app.romsafe.shared.api.RomSafeApi
import app.romsafe.shared.setup.PlatformSetup
import app.romsafe.shared.setup.mappingsFor
import kotlinx.serialization.Serializable

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

/**
 * One full sync of every set-up platform, one at a time. [open] turns a stored
 * folder location into a tree, or null when it can't be used any more (Android
 * lost the grant, the desktop folder is gone); those folders are skipped.
 * Throws when the server can't be reached at all.
 */
class SyncSession(
    private val api: RomSafeApi,
    private val cache: HashCache,
    private val now: () -> Long,
    private val open: (String) -> FileTree?,
) {
    /** Whether the server's download queue had anything in it after the sync. */
    var queuePending: Boolean = false
        private set

    suspend fun run(setups: Map<String, PlatformSetup>, progress: (String) -> Unit = {}): SyncReport {
        val config = api.config()
        // Re-send the mappings each run, so a change that couldn't be saved earlier can't leave the server without one.
        api.putMappings(mappingsFor(config, setups))

        val profiles = config.profiles.associateBy { it.id }
        val engine = SyncEngine(api, cache, now)
        val summaries = config.platforms.mapNotNull { p ->
            val setup = setups[p.slug] ?: return@mapNotNull null
            val emulators = setup.emulators.mapNotNull { e ->
                val location = e.saveUri ?: return@mapNotNull null
                val profile = profiles[e.profile]?.takeIf { e.profile in p.profiles } ?: return@mapNotNull null
                val tree = open(location) ?: return@mapNotNull null
                EmulatorFolder(e.slot, profile, tree, location)
            }
            if (emulators.isEmpty()) return@mapNotNull null
            val romTree = setup.romUri?.let(open)
            val job = PlatformJob(p, romTree, setup.romUri.takeIf { romTree != null }, emulators)
            val r = engine.syncPlatform(job) { step -> progress("${p.name}: $step") }
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
        queuePending = runCatching { api.queue().isNotEmpty() }.getOrDefault(false)
        return SyncReport(now(), summaries)
    }
}
