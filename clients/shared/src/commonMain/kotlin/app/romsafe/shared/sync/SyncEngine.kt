package app.romsafe.shared.sync

import app.romsafe.shared.api.InventoryFile
import app.romsafe.shared.api.LocalSave
import app.romsafe.shared.api.PlatformInfo
import app.romsafe.shared.api.Profile
import app.romsafe.shared.api.RomSafeApi
import app.romsafe.shared.api.SaveLayout
import app.romsafe.shared.api.SyncAction
import kotlinx.coroutines.CancellationException

/** One emulator's save folder for a platform. [scope] identifies the folder for the hash cache (its URI or path). */
class EmulatorFolder(val slot: String, val profile: Profile, val tree: FileTree, val scope: String)

/** Everything to sync for one platform: its ROM folder (optional) and each emulator's save folder. */
class PlatformJob(
    val platform: PlatformInfo,
    val roms: FileTree?,
    val romScope: String?,
    val emulators: List<EmulatorFolder>,
)

data class SyncIssue(val platform: String, val path: String?, val message: String)

data class PlatformResult(
    val platform: String,
    val uploaded: Int = 0,
    val downloaded: Int = 0,
    val inSync: Int = 0,
    /** Paths with a conflict: both copies are on the server, waiting for the user to pick one. */
    val conflicts: List<String> = emptyList(),
    /** Skipped because they changed in the last few seconds (the emulator may still be writing). */
    val busy: Int = 0,
    val romsReported: Int? = null,
    val issues: List<SyncIssue> = emptyList(),
)

/**
 * Carries out docs/sync-protocol.md for one platform at a time: report the
 * ROMs, then for each emulator plan its save folder and act on the plan.
 * Per-file errors are collected and the rest of the files still sync.
 */
class SyncEngine(
    private val api: RomSafeApi,
    private val cache: HashCache,
    private val now: () -> Long,
    /** ROMs up to this size get a SHA-1 for exact matching; bigger ones match by name. */
    private val romHashLimit: Long = 16L * 1024 * 1024,
) {
    suspend fun syncPlatform(job: PlatformJob, progress: (String) -> Unit = {}): PlatformResult {
        val slug = job.platform.slug
        var result = PlatformResult(slug)
        // ROMs first: the server translates save names through them.
        if (job.roms != null && job.romScope != null) {
            progress("Checking ROMs")
            try {
                result = result.copy(romsReported = reportRoms(job.platform, job.roms, job.romScope))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                result = result.copy(issues = result.issues + SyncIssue(slug, null, "ROM folder: ${e.message ?: e}"))
            }
        }
        for (emulator in job.emulators) {
            progress("Syncing saves")
            result = try {
                syncSaves(job.platform, emulator, result)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                result.copy(issues = result.issues + SyncIssue(slug, null, e.message ?: e.toString()))
            } finally {
                cache.flush()
            }
        }
        return result
    }

    private suspend fun reportRoms(platform: PlatformInfo, tree: FileTree, scope: String): Int {
        val extensions = platform.romExtensions.map { it.lowercase() }
        // ROMs sit in the folder or one level down (per-game folders for multi-disc sets).
        val files = tree.walk { dir -> dir.count { it == '/' } < 1 }
            .filter { f -> extensions.any { f.name.lowercase().endsWith(it) } }
        val hashScope = "sha1:$scope"
        val inventory = files.map { f ->
            val sha1 = if (f.size <= romHashLimit) {
                cache.get(hashScope, f) ?: sha1Hex(tree.read(f.path)).also { cache.put(hashScope, f, it) }
            } else {
                null
            }
            InventoryFile(f.path, f.size, sha1)
        }
        cache.retain(hashScope, files.mapTo(mutableSetOf()) { it.path })
        cache.flush()
        api.inventory(platform.slug, inventory, complete = true)
        return inventory.size
    }

    private suspend fun syncSaves(platform: PlatformInfo, folder: EmulatorFolder, before: PlatformResult): PlatformResult {
        var r = before
        val slug = platform.slug
        val matcher = SaveMatcher(SaveLayout.rules(folder.profile, platform))
        val files = folder.tree.walk(descend = matcher::mayContain).filter { matcher.matches(it.path) }
        val hashScope = "sha256:${folder.scope}"
        cache.retain(hashScope, files.mapTo(mutableSetOf()) { it.path })

        // Leave files alone while the emulator may still be writing them, and
        // don't download over them either. A recent file the cache already
        // knows at this size and time is one a sync just wrote (platforms can
        // share a folder), not one the emulator is busy with.
        val cutoff = now() - RECENT_MS
        val (busy, settled) = files.partition { it.modified > cutoff && cache.get(hashScope, it) == null }
        val busyPaths = busy.mapTo(mutableSetOf()) { it.path.lowercase() }
        r = r.copy(busy = r.busy + busy.size)

        val modified = settled.associate { it.path to it.modified }
        val local = settled.map { f ->
            val sha = cache.get(hashScope, f) ?: sha256Hex(folder.tree.read(f.path)).also { cache.put(hashScope, f, it) }
            LocalSave(f.path, sha, f.size)
        }
        val actions = api.plan(slug, local, folder.slot)

        for (a in actions) {
            try {
                r = when (a.action) {
                    SyncAction.OK -> r.copy(inSync = r.inSync + 1)
                    SyncAction.UPLOAD -> {
                        upload(slug, folder, a, conflict = false, modified[a.path])
                        r.copy(uploaded = r.uploaded + 1)
                    }
                    SyncAction.CONFLICT -> {
                        upload(slug, folder, a, conflict = true, modified[a.path])
                        r.copy(conflicts = r.conflicts + a.path)
                    }
                    SyncAction.PENDING_CONFLICT -> r.copy(conflicts = r.conflicts + a.path)
                    SyncAction.DOWNLOAD -> {
                        if (a.path.lowercase() in busyPaths) {
                            r
                        } else {
                            download(folder, a, hashScope)
                            r.copy(downloaded = r.downloaded + 1)
                        }
                    }
                    // unrecognized, empty, deleted, and anything newer than this client: nothing to do.
                    else -> r
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                r = r.copy(issues = r.issues + SyncIssue(slug, a.path, e.message ?: e.toString()))
            }
        }
        return r
    }

    private suspend fun upload(platform: String, folder: EmulatorFolder, a: SyncAction, conflict: Boolean, modified: Long?) {
        val bytes = folder.tree.read(a.path)
        api.upload(platform, a.path, bytes, a.baseVersionId, conflict, folder.slot, modified?.takeIf { it > 0 })
    }

    private suspend fun download(folder: EmulatorFolder, a: SyncAction, hashScope: String) {
        val versionId = a.versionId ?: error("Download without a version")
        val saveId = a.saveId ?: error("Download without a save")
        val save = api.downloadSave(versionId)
        val sha = sha256Hex(save.bytes)
        val expected = a.sha256 ?: save.sha256
        if (expected != null && !sha.equals(expected, ignoreCase = true)) error("Downloaded save didn't match its hash")
        val written = folder.tree.write(a.path, save.bytes)
        cache.put(hashScope, written, sha)
        // Only once the file is safely on disk.
        api.ack(saveId, versionId, folder.slot)
    }

    companion object {
        const val RECENT_MS = 5_000L
    }
}
