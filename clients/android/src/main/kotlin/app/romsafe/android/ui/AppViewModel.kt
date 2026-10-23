package app.romsafe.android.ui

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider.AndroidViewModelFactory.Companion.APPLICATION_KEY
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import app.romsafe.android.RomSafeApp
import app.romsafe.android.data.EmulatorSetup
import app.romsafe.android.data.Folders
import app.romsafe.android.data.Lan
import app.romsafe.android.data.Pairing
import app.romsafe.android.data.PlatformSetup
import app.romsafe.shared.api.DeviceConfig
import app.romsafe.shared.api.Mapping
import app.romsafe.shared.api.PlatformInfo
import app.romsafe.shared.api.RomSafeApi
import app.romsafe.shared.api.RomSafeApiException
import app.romsafe.shared.api.SaveLayout
import app.romsafe.shared.api.ServerUrl
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

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
    /** Folder URI → readable label. */
    val folderLabels: Map<String, String> = emptyMap(),
    /** Folder URIs we still hold a read/write grant for. */
    val granted: Set<String> = emptySet(),
    /** "platform/slot" → what's wrong with that emulator's save folder layout. */
    val layoutProblems: Map<String, String> = emptyMap(),
    val saveStatus: SaveStatus = SaveStatus.Idle,
) {
    /** The platform's emulators, or one unconfigured placeholder so the card has something to edit. */
    fun emulators(p: PlatformInfo): List<EmulatorSetup> =
        setups[p.slug]?.emulators?.takeIf { it.isNotEmpty() }
            ?: listOfNotNull(p.profiles.firstOrNull()?.let { EmulatorSetup("", it) })

    fun isSetUp(p: PlatformInfo): Boolean = setups[p.slug]?.emulators.orEmpty().any { it.saveUri in granted }
}

class AppViewModel(private val app: RomSafeApp) : ViewModel() {
    private val store = app.store
    private val _state = MutableStateFlow(AppState(pairing = store.pairing(), lastServerUrl = store.lastServerUrl))
    val state: StateFlow<AppState> = _state

    private var api: RomSafeApi? = null
    private var pushJob: Job? = null

    init {
        if (_state.value.pairing != null) refresh()
    }

    private fun api(): RomSafeApi {
        val p = _state.value.pairing ?: error("Not paired")
        return api?.takeIf { it.baseUrl == p.serverUrl } ?: RomSafeApi(p.serverUrl, p.token).also {
            api?.close()
            api = it
        }
    }

    // --- pairing ----------------------------------------------------------------

    fun pair(serverUrl: String, code: String, deviceName: String) {
        _state.update { it.copy(pairBusy = true, pairError = null) }
        viewModelScope.launch {
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
                val result = RomSafeApi(base, null).use { it.pair(code.trim().uppercase(), name, "android") }
                val pairing = Pairing(base, result.deviceId, name, result.token)
                store.savePairing(pairing)
                _state.update { AppState(pairing = pairing, lastServerUrl = base, setups = store.setups()) }
                refresh()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(pairBusy = false, pairError = friendly(e)) }
            }
        }
    }

    fun unpair() {
        val ctx = app.applicationContext
        _state.value.setups.values.flatMap { it.uris() }.forEach { Folders.release(ctx, Uri.parse(it)) }
        store.clearPairing()
        api?.close()
        api = null
        _state.value = AppState(lastServerUrl = store.lastServerUrl)
    }

    // --- config and folder setup -------------------------------------------------

    fun refresh() {
        _state.update { it.copy(loading = true, loadError = null) }
        viewModelScope.launch {
            try {
                val config = api().config()
                val ctx = app.applicationContext
                val (setups, granted, labels) = withContext(Dispatchers.IO) {
                    val granted = Folders.grantedUris(ctx)
                    val setups = mergeServerMappings(store.setups(), config, granted)
                    val labels = setups.values.flatMap { it.uris() }.associateWith { Folders.label(ctx, Uri.parse(it)) }
                    Triple(setups, granted, labels)
                }
                store.saveSetups(setups)
                _state.update {
                    it.copy(config = config, loading = false, setups = setups, granted = granted, folderLabels = labels)
                }
                checkLayouts()
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

    /**
     * Local setup wins: it holds the folder grants. Server mappings are only
     * adopted for a platform we have nothing for, and only for folders we still
     * hold a grant to (e.g. the app's prefs were cleared but Android kept them).
     */
    private fun mergeServerMappings(
        local: Map<String, PlatformSetup>,
        config: DeviceConfig,
        granted: Set<String>,
    ): Map<String, PlatformSetup> {
        val merged = local.toMutableMap()
        for ((platform, mappings) in config.mappings.groupBy { it.platform }) {
            if (platform in merged) continue
            val emulators = mappings.filter { it.saveRoot in granted }.map { EmulatorSetup(it.slot, it.profile, it.saveRoot) }
            if (emulators.isEmpty()) continue
            merged[platform] = PlatformSetup(mappings.firstNotNullOfOrNull { it.romRoot?.takeIf { r -> r in granted } }, emulators)
        }
        return merged
    }

    fun selectProfile(platform: PlatformInfo, slot: String, profile: String) {
        updateEmulator(platform, slot) { it.copy(profile = profile) }
    }

    fun setFolder(platform: PlatformInfo, kind: FolderKind, slot: String, uri: Uri) {
        val ctx = app.applicationContext
        runCatching { Folders.keep(ctx, uri) }.onFailure {
            _state.update { s -> s.copy(saveStatus = SaveStatus.Failed("Android didn't grant access to that folder. Try another one.")) }
            return
        }
        val key = uri.toString()
        _state.update { it.copy(granted = it.granted + key) }
        viewModelScope.launch {
            val label = withContext(Dispatchers.IO) { Folders.label(ctx, uri) }
            _state.update { it.copy(folderLabels = it.folderLabels + (key to label)) }
        }
        when (kind) {
            FolderKind.Save -> updateEmulator(platform, slot) { it.copy(saveUri = key) }
            FolderKind.Rom -> updateSetup(platform) { it.copy(romUri = key) }
        }
    }

    fun clearFolder(platform: PlatformInfo, kind: FolderKind, slot: String) {
        when (kind) {
            FolderKind.Save -> updateEmulator(platform, slot) { it.copy(saveUri = null) }
            FolderKind.Rom -> updateSetup(platform) { it.copy(romUri = null) }
        }
    }

    /** Another emulator for the same platform, e.g. Citra MMJ next to Azahar. */
    fun addEmulator(platform: PlatformInfo) {
        val profile = platform.profiles.firstOrNull() ?: return
        updateSetup(platform) { setup ->
            val used = setup.emulators.map { it.slot }.toSet()
            val slot = generateSequence(2) { it + 1 }.map { it.toString() }.first { it !in used }
            setup.copy(emulators = setup.emulators + EmulatorSetup(slot, profile))
        }
    }

    fun removeEmulator(platform: PlatformInfo, slot: String) {
        updateSetup(platform) { setup -> setup.copy(emulators = setup.emulators.filter { it.slot != slot }) }
    }

    private fun updateEmulator(platform: PlatformInfo, slot: String, change: (EmulatorSetup) -> EmulatorSetup) {
        val placeholder = _state.value.emulators(platform)
        updateSetup(platform) { setup ->
            val emulators = setup.emulators.ifEmpty { placeholder }
            setup.copy(emulators = emulators.map { if (it.slot == slot) change(it) else it })
        }
    }

    private fun updateSetup(platform: PlatformInfo, change: (PlatformSetup) -> PlatformSetup) {
        val before = _state.value.setups
        val next = change(before[platform.slug] ?: PlatformSetup())
        val setups = if (next.uris().isEmpty() && next.emulators.size <= 1 && next.emulators.all { it.profile == platform.profiles.firstOrNull() }) {
            before - platform.slug
        } else {
            before + (platform.slug to next)
        }
        releaseUnused(before, setups)
        store.saveSetups(setups)
        _state.update { it.copy(setups = setups) }
        checkLayouts()
        pushMappings()
    }

    /** Give back folder grants nothing uses any more; Android caps how many an app may hold. */
    private fun releaseUnused(before: Map<String, PlatformSetup>, after: Map<String, PlatformSetup>) {
        fun uris(m: Map<String, PlatformSetup>) = m.values.flatMap { it.uris() }.toSet()
        val dropped = uris(before) - uris(after)
        if (dropped.isEmpty()) return
        dropped.forEach { Folders.release(app.applicationContext, Uri.parse(it)) }
        _state.update { it.copy(granted = it.granted - dropped) }
    }

    /** Look inside each save folder for the folders its profile expects. */
    private fun checkLayouts() {
        val s = _state.value
        val config = s.config ?: return
        val profiles = config.profiles.associateBy { it.id }
        val ctx = app.applicationContext
        viewModelScope.launch {
            val problems = withContext(Dispatchers.IO) {
                buildMap {
                    for (p in config.platforms) {
                        for (e in s.setups[p.slug]?.emulators.orEmpty()) {
                            val uri = e.saveUri?.takeIf { it in s.granted } ?: continue
                            val profile = profiles[e.profile] ?: continue
                            Folders.layoutProblem(ctx, Uri.parse(uri), SaveLayout.topFolders(profile, p))
                                ?.let { put("${p.slug}/${e.slot}", it) }
                        }
                    }
                }
            }
            _state.update { it.copy(layoutProblems = problems) }
        }
    }

    /** PUT replaces the whole list, so send every emulator that has a save folder. Debounced. */
    private fun pushMappings() {
        pushJob?.cancel()
        pushJob = viewModelScope.launch {
            delay(400)
            val s = _state.value
            val config = s.config ?: return@launch
            val body = config.platforms.flatMap { p ->
                val setup = s.setups[p.slug] ?: return@flatMap emptyList()
                setup.emulators.mapNotNull { e ->
                    val save = e.saveUri ?: return@mapNotNull null
                    if (e.profile !in p.profiles) return@mapNotNull null
                    Mapping(platform = p.slug, profile = e.profile, slot = e.slot, saveRoot = save, romRoot = setup.romUri)
                }
            }
            _state.update { it.copy(saveStatus = SaveStatus.Saving) }
            try {
                api().putMappings(body)
                _state.update { it.copy(saveStatus = SaveStatus.Saved) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(saveStatus = SaveStatus.Failed("Couldn't save to the server: ${friendly(e)}")) }
            }
        }
    }

    fun retrySave() = pushMappings()

    override fun onCleared() {
        api?.close()
    }

    private fun friendly(e: Exception): String = when (e) {
        is RomSafeApiException -> e.message ?: "Server error ${e.status}"
        is UnknownHostException -> "Can't find that server. Check the address."
        is ConnectException, is SocketTimeoutException ->
            "Couldn't reach the server. Is it running, and is this device on the same network?"
        is java.io.IOException -> "Couldn't reach the server (${e.message ?: e.javaClass.simpleName})."
        else -> e.message ?: e.javaClass.simpleName
    }

    companion object {
        val Factory = viewModelFactory {
            initializer { AppViewModel(this[APPLICATION_KEY] as RomSafeApp) }
        }
    }
}
