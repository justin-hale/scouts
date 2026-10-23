package app.romsafe.android.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider.AndroidViewModelFactory.Companion.APPLICATION_KEY
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import app.romsafe.android.RomSafeApp
import app.romsafe.android.sync.Downloads
import app.romsafe.shared.api.LibraryGame
import app.romsafe.shared.api.LibraryRom
import app.romsafe.shared.api.RomSafeApi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class LibraryState(
    val platform: String? = null,
    val games: List<LibraryGame> = emptyList(),
    val loading: Boolean = false,
    val error: String? = null,
    val query: String = "",
) {
    val visible: List<LibraryGame>
        get() = if (query.isBlank()) games else games.filter { it.title.contains(query.trim(), ignoreCase = true) }
}

class LibraryViewModel(private val app: RomSafeApp) : ViewModel() {
    private val _state = MutableStateFlow(LibraryState())
    val state: StateFlow<LibraryState> = _state
    private var api: RomSafeApi? = null
    private var loadJob: Job? = null

    init {
        // A finished download changes what's on the device.
        viewModelScope.launch { Downloads.finished.drop(1).collect { load(quiet = true) } }
    }

    private fun api(): RomSafeApi? {
        val p = app.store.pairing() ?: return null
        return api?.takeIf { it.baseUrl == p.serverUrl } ?: RomSafeApi(p.serverUrl, p.token).also {
            api?.close()
            api = it
        }
    }

    fun select(platform: String) {
        if (platform == _state.value.platform && _state.value.games.isNotEmpty()) return
        _state.update { it.copy(platform = platform, games = emptyList(), query = "") }
        load()
    }

    fun search(query: String) = _state.update { it.copy(query = query) }

    fun load(quiet: Boolean = false) {
        val platform = _state.value.platform ?: return
        loadJob?.cancel()
        if (!quiet) _state.update { it.copy(loading = true, error = null) }
        loadJob = viewModelScope.launch {
            try {
                val games = api()?.games(platform) ?: return@launch
                if (_state.value.platform == platform) _state.update { it.copy(games = games, loading = false, error = null) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, error = e.message ?: "Couldn't load the library") }
            }
        }
    }

    fun download(rom: LibraryRom) {
        markQueued(rom.id, true)
        viewModelScope.launch {
            try {
                api()?.enqueue(listOf(rom.id))
                Downloads.clearError(rom.id)
                Downloads.start(app)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                markQueued(rom.id, false)
                _state.update { it.copy(error = "Couldn't queue ${rom.fileName}: ${e.message}") }
            }
        }
    }

    fun cancel(rom: LibraryRom) {
        markQueued(rom.id, false)
        Downloads.clearError(rom.id)
        viewModelScope.launch { runCatching { api()?.dequeue(rom.id) } }
    }

    private fun markQueued(romId: Long, queued: Boolean) = _state.update { s ->
        s.copy(games = s.games.map { g -> g.copy(roms = g.roms.map { if (it.id == romId) it.copy(queued = queued) else it }) })
    }

    override fun onCleared() {
        api?.close()
    }

    companion object {
        val Factory = viewModelFactory {
            initializer { LibraryViewModel(this[APPLICATION_KEY] as RomSafeApp) }
        }
    }
}
