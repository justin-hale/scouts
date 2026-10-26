package app.romsafe.desktop

import app.romsafe.desktop.data.DesktopStore
import app.romsafe.desktop.data.Folders
import app.romsafe.desktop.data.Lan
import app.romsafe.desktop.data.Pairing
import app.romsafe.desktop.sync.SyncService
import app.romsafe.shared.api.DeviceConfig
import app.romsafe.shared.api.PlatformInfo
import app.romsafe.shared.api.RomSafeApi
import app.romsafe.shared.api.RomSafeApiException
import app.romsafe.shared.api.SaveLayout
import app.romsafe.shared.api.ServerUrl
import app.romsafe.shared.library.LibraryModel
import app.romsafe.shared.setup.EmulatorSetup
import app.romsafe.shared.setup.PlatformSetup
import app.romsafe.shared.setup.Setups
import app.romsafe.shared.setup.emulatorsFor
import app.romsafe.shared.setup.mappingsFor
import app.romsafe.shared.setup.mergeServerMappings
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.net.ConnectException
import java.net.UnknownHostException
import java.net.http.HttpConnectTimeoutException

enum class FolderKind { Save, Rom }

sealed interface SaveStatus {
    data object Idle : SaveStatus
    data object Saving : SaveStatus
    data object Saved : SaveStatus
    data class Failed(val message: String) : SaveStatus
}

data class AppState(
    val pairing: Pairing? = null,
    val lastServerUrl: String? = null,
    val pairBusy: Boolean = false,
    val pairError: String? = null,
    val config: DeviceConfig? = null,
    val loading: Boolean = false,
    val loadError: String? = null,
    val setups: Map<String, PlatformSetup> = emptyMap(),
    /** Folder paths that exist right now. */
    val existing: Set<String> = emptySet(),
    /** "platform/slot" → what's wrong with that emulator's save folder layout. */
    val layoutProblems: Map<String, String> = emptyMap(),
    val saveStatus: SaveStatus = SaveStatus.Idle,
) {
    fun emulators(p: PlatformInfo): List<EmulatorSetup> = setups.emulatorsFor(p)

    fun isSetUp(p: PlatformInfo): Boolean = setups[p.slug]?.emulators.orEmpty().any { it.saveUri in existing }

    /** Platforms with a usable ROM folder: downloads need one. */
    val romFolders: Set<String> get() = setups.filterValues { it.romUri != null && it.romUri in existing }.keys
}

/**
 * Pairing, the server config and the folder setup; the desktop's AppViewModel.
 * Lives as long as the process (the window can close to the tray).
 */
class AppModel(private val store: DesktopStore = DesktopStore()) {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    val sync = SyncService(store, scope)

    private val _state = MutableStateFlow(AppState(pairing = store.pairing(), lastServerUrl = store.lastServerUrl))
    val state: StateFlow<AppState> = _state

    private var client: RomSafeApi? = null
    private var pushJob: Job? = null

    val library = LibraryModel(scope, ::apiOrNull, store, sync.downloads, sync::startDownloads)

    init {
        if (_state.value.pairing != null) {
            refresh()
            sync.startPeriodic()
        }
    }

    private fun apiOrNull(): RomSafeApi? {
        val p = _state.value.pairing ?: return null
        return client?.takeIf { it.baseUrl == p.serverUrl } ?: RomSafeApi(p.serverUrl, p.token).also {
            client?.close()
            client = it
        }
    }

    private fun api(): RomSafeApi = apiOrNull() ?: error("Not paired")

    // --- pairing ----------------------------------------------------------------

    fun pair(serverUrl: String, code: String, deviceName: String) {
        _state.update { it.copy(pairBusy = true, pairError = null) }
        scope.launch {
            try {
                val base = ServerUrl.normalize(serverUrl)
                if (!ServerUrl.isHttps(base)) {
                    val host = ServerUrl.host(base)
                    val private = withContext(Dispatchers.IO) { Lan.isPrivateHost(host) }
                    if (!private) {
                        throw IllegalStateException(
                            "$host isn't on your local network. Use an https:// address for servers outside it.",
                        )
                    }
                }
                val name = deviceName.trim()
                val result = withContext(Dispatchers.IO) {
                    RomSafeApi(base, null).use { it.pair(code.trim().uppercase(), name, DEVICE_KIND) }
                }
                val pairing = Pairing(base, result.deviceId, name, result.token)
                store.savePairing(pairing)
                _state.update { AppState(pairing = pairing, lastServerUrl = base, setups = store.setups()) }
                sync.startPeriodic()
                refresh()
                library.load()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(pairBusy = false, pairError = friendly(e)) }
            }
        }
    }

    fun unpair() {
        store.clearPairing()
        sync.stop()
        client?.close()
        client = null
        _state.value = AppState(lastServerUrl = store.lastServerUrl)
    }

    // --- config and folder setup -------------------------------------------------

    fun refresh() {
        _state.update { it.copy(loading = true, loadError = null) }
        scope.launch {
            try {
                val config = withContext(Dispatchers.IO) { api().config() }
                val setups = withContext(Dispatchers.IO) { mergeServerMappings(store.setups(), config, Folders::usable) }
                store.saveSetups(setups)
                _state.update { it.copy(config = config, loading = false, setups = setups) }
                checkFolders()
                // Sync when the app opens, unless it just did.
                val last = sync.status.value.last?.finishedAt ?: 0
                if (System.currentTimeMillis() - last > 60_000) sync.syncNow()
            } catch (e: CancellationException) {
                throw e
            } catch (e: RomSafeApiException) {
                if (e.status == 401) {
                    unpair()
                    _state.update { it.copy(pairError = "This device was removed on the server. Pair it again.") }
                } else {
                    _state.update { it.copy(loading = false, loadError = e.message) }
                }
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, loadError = friendly(e)) }
            }
        }
    }

    fun selectProfile(platform: PlatformInfo, slot: String, profile: String) {
        applySetups(Setups.updateEmulator(_state.value.setups, platform, slot) { it.copy(profile = profile) })
    }

    fun setFolder(platform: PlatformInfo, kind: FolderKind, slot: String, path: String) {
        val s = _state.value.setups
        applySetups(
            when (kind) {
                FolderKind.Save -> Setups.updateEmulator(s, platform, slot) { it.copy(saveUri = path) }
                FolderKind.Rom -> Setups.update(s, platform) { it.copy(romUri = path) }
            },
        )
    }

    fun clearFolder(platform: PlatformInfo, kind: FolderKind, slot: String) {
        val s = _state.value.setups
        applySetups(
            when (kind) {
                FolderKind.Save -> Setups.updateEmulator(s, platform, slot) { it.copy(saveUri = null) }
                FolderKind.Rom -> Setups.update(s, platform) { it.copy(romUri = null) }
            },
        )
    }

    fun addEmulator(platform: PlatformInfo) = applySetups(Setups.addEmulator(_state.value.setups, platform))

    fun removeEmulator(platform: PlatformInfo, slot: String) = applySetups(Setups.removeEmulator(_state.value.setups, platform, slot))

    private fun applySetups(setups: Map<String, PlatformSetup>) {
        store.saveSetups(setups)
        _state.update { it.copy(setups = setups) }
        checkFolders()
        pushMappings()
    }

    /** Which folders exist, whether each save folder holds what its profile expects, and what to watch. */
    private fun checkFolders() {
        val s = _state.value
        val config = s.config ?: return
        val profiles = config.profiles.associateBy { it.id }
        scope.launch {
            val (existing, problems) = withContext(Dispatchers.IO) {
                val existing = s.setups.values.flatMap { it.uris() }.filterTo(mutableSetOf(), Folders::usable)
                val problems = buildMap {
                    for (p in config.platforms) {
                        for (e in s.setups[p.slug]?.emulators.orEmpty()) {
                            val path = e.saveUri ?: continue
                            val profile = profiles[e.profile] ?: continue
                            Folders.layoutProblem(path, SaveLayout.topFolders(profile, p))?.let { put("${p.slug}/${e.slot}", it) }
                        }
                    }
                }
                existing to problems
            }
            _state.update { it.copy(existing = existing, layoutProblems = problems) }
            sync.watch(config, s.setups)
        }
    }

    /** PUT replaces the whole list, so send every emulator that has a save folder. Debounced. */
    private fun pushMappings() {
        pushJob?.cancel()
        pushJob = scope.launch {
            delay(400)
            val s = _state.value
            val config = s.config ?: return@launch
            val body = mappingsFor(config, s.setups)
            _state.update { it.copy(saveStatus = SaveStatus.Saving) }
            try {
                withContext(Dispatchers.IO) { api().putMappings(body) }
                _state.update { it.copy(saveStatus = SaveStatus.Saved) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(saveStatus = SaveStatus.Failed("Couldn't save to the server: ${friendly(e)}")) }
            }
        }
    }

    fun retrySave() = pushMappings()

    fun syncNow() = sync.syncNow()

    fun close() {
        sync.stop()
        client?.close()
        scope.cancel()
    }

    private fun friendly(e: Exception): String = when (e) {
        is RomSafeApiException -> e.message ?: "Server error ${e.status}"
        is UnknownHostException -> "Can't find that server. Check the address."
        is ConnectException, is HttpConnectTimeoutException ->
            "Couldn't reach the server. Is it running, and is this computer on the same network?"
        is java.io.IOException -> "Couldn't reach the server (${e.message ?: e.javaClass.simpleName})."
        else -> e.message ?: e.javaClass.simpleName
    }

    companion object {
        /** What the server's Devices page shows; Windows is the main target. */
        val DEVICE_KIND: String = System.getProperty("os.name").lowercase().let {
            when {
                it.startsWith("windows") -> "windows"
                it.contains("mac") -> "macos"
                else -> "linux"
            }
        }
    }
}
