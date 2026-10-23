package app.romsafe.android.ui

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider.AndroidViewModelFactory.Companion.APPLICATION_KEY
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import app.romsafe.android.RomSafeApp
import app.romsafe.android.data.Folders
import app.romsafe.android.data.Lan
import app.romsafe.android.data.LocalMapping
import app.romsafe.android.data.Pairing
import app.romsafe.shared.api.DeviceConfig
import app.romsafe.shared.api.Mapping
import app.romsafe.shared.api.PlatformInfo
import app.romsafe.shared.api.RomSafeApi
import app.romsafe.shared.api.RomSafeApiException
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
    val mappings: Map<String, LocalMapping> = emptyMap(),
    /** Folder URI → readable label. */
    val folderLabels: Map<String, String> = emptyMap(),
    /** Folder URIs we still hold a read/write grant for. */
    val granted: Set<String> = emptySet(),
    val saveStatus: SaveStatus = SaveStatus.Idle,
) {
    /** The profile in use for [p]: the chosen one, or the first that supports it. */
    fun profileFor(p: PlatformInfo): String? =
        mappings[p.slug]?.profile?.takeIf { it in p.profiles } ?: p.profiles.firstOrNull()

    fun isSetUp(p: PlatformInfo): Boolean = mappings[p.slug]?.saveUri?.let { it in granted } == true
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
                _state.update { AppState(pairing = pairing, lastServerUrl = base, mappings = store.mappings()) }
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
        _state.value.mappings.values.flatMap { listOfNotNull(it.saveUri, it.romUri) }.forEach { Folders.release(ctx, Uri.parse(it)) }
        store.clearPairing()
        api?.close()
        api = null
        _state.value = AppState(lastServerUrl = store.lastServerUrl)
    }

    // --- config and mappings ----------------------------------------------------

    fun refresh() {
        _state.update { it.copy(loading = true, loadError = null) }
        viewModelScope.launch {
            try {
                val config = api().config()
                val ctx = app.applicationContext
                val (mappings, granted, labels) = withContext(Dispatchers.IO) {
                    val granted = Folders.grantedUris(ctx)
                    val mappings = mergeServerMappings(store.mappings(), config, granted)
                    val labels = mappings.values.flatMap { listOfNotNull(it.saveUri, it.romUri) }
                        .associateWith { Folders.label(ctx, Uri.parse(it)) }
                    Triple(mappings, granted, labels)
                }
                store.saveMappings(mappings)
                _state.update {
                    it.copy(config = config, loading = false, mappings = mappings, granted = granted, folderLabels = labels)
                }
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
     * Local mappings win: they hold the folder grants. A server mapping is only
     * adopted when we have nothing for that platform but still hold a grant for
     * its folder (e.g. the app's prefs were cleared but Android kept the grant).
     */
    private fun mergeServerMappings(
        local: Map<String, LocalMapping>,
        config: DeviceConfig,
        granted: Set<String>,
    ): Map<String, LocalMapping> {
        val merged = local.toMutableMap()
        for (m in config.mappings) {
            if (m.platform in merged || m.saveRoot !in granted) continue
            merged[m.platform] = LocalMapping(m.profile, m.saveRoot, m.romRoot?.takeIf { it in granted })
        }
        return merged
    }

    fun selectProfile(platform: PlatformInfo, profile: String) {
        updateMapping(platform) { it.copy(profile = profile) }
    }

    fun setFolder(platform: PlatformInfo, kind: FolderKind, uri: Uri) {
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
        updateMapping(platform) { if (kind == FolderKind.Save) it.copy(saveUri = key) else it.copy(romUri = key) }
    }

    fun clearFolder(platform: PlatformInfo, kind: FolderKind) {
        updateMapping(platform) { if (kind == FolderKind.Save) it.copy(saveUri = null) else it.copy(romUri = null) }
    }

    private fun updateMapping(platform: PlatformInfo, change: (LocalMapping) -> LocalMapping) {
        val s = _state.value
        val profile = s.profileFor(platform) ?: return
        val before = s.mappings
        val current = before[platform.slug] ?: LocalMapping(profile)
        val next = change(current)
        val mappings = if (next.saveUri == null && next.romUri == null && next.profile == platform.profiles.firstOrNull()) {
            before - platform.slug
        } else {
            before + (platform.slug to next)
        }
        releaseUnused(before, mappings)
        store.saveMappings(mappings)
        _state.update { it.copy(mappings = mappings) }
        pushMappings()
    }

    /** Give back folder grants nothing uses any more; Android caps how many an app may hold. */
    private fun releaseUnused(before: Map<String, LocalMapping>, after: Map<String, LocalMapping>) {
        fun uris(m: Map<String, LocalMapping>) = m.values.flatMap { listOfNotNull(it.saveUri, it.romUri) }.toSet()
        val dropped = uris(before) - uris(after)
        if (dropped.isEmpty()) return
        dropped.forEach { Folders.release(app.applicationContext, Uri.parse(it)) }
        _state.update { it.copy(granted = it.granted - dropped) }
    }

    /** PUT replaces the whole list, so send every platform that has a save folder. Debounced. */
    private fun pushMappings() {
        pushJob?.cancel()
        pushJob = viewModelScope.launch {
            delay(400)
            val s = _state.value
            val config = s.config ?: return@launch
            val body = config.platforms.mapNotNull { p ->
                val m = s.mappings[p.slug] ?: return@mapNotNull null
                val save = m.saveUri ?: return@mapNotNull null
                Mapping(p.slug, s.profileFor(p) ?: return@mapNotNull null, save, m.romUri)
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
