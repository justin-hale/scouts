package app.romsafe.android.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider.AndroidViewModelFactory.Companion.APPLICATION_KEY
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import app.romsafe.android.RomSafeApp
import app.romsafe.android.sync.Downloads
import app.romsafe.shared.api.GameSort
import app.romsafe.shared.api.LibraryRom
import app.romsafe.shared.api.PlatformSort
import app.romsafe.shared.api.RomSafeApi
import app.romsafe.shared.library.LibraryModel
import app.romsafe.shared.library.LibraryState
import kotlinx.coroutines.flow.StateFlow

/** Holds the shared [LibraryModel] for the activity's lifetime. */
class LibraryViewModel(private val app: RomSafeApp) : ViewModel() {
    private var client: RomSafeApi? = null
    private val model = LibraryModel(viewModelScope, ::api, app.store, Downloads) { Downloads.start(app) }
    val state: StateFlow<LibraryState> = model.state

    private fun api(): RomSafeApi? {
        val p = app.store.pairing() ?: return null
        return client?.takeIf { it.baseUrl == p.serverUrl } ?: RomSafeApi(p.serverUrl, p.token).also {
            client?.close()
            client = it
        }
    }

    fun filter(platform: String?) = model.filter(platform)

    fun search(query: String) = model.search(query)

    fun sort(sort: GameSort) = model.sort(sort)

    fun platformSort(sort: PlatformSort) = model.platformSort(sort)

    fun load(quiet: Boolean = false) = model.load(quiet)

    fun openGame(id: Long) = model.openGame(id)

    fun closeGame() = model.closeGame()

    fun loadGame(id: Long) = model.loadGame(id)

    fun toggleHistory(saveId: Long) = model.toggleHistory(saveId)

    fun download(rom: LibraryRom) = model.download(rom)

    fun cancel(rom: LibraryRom) = model.cancel(rom)

    override fun onCleared() {
        client?.close()
    }

    companion object {
        val Factory = viewModelFactory {
            initializer { LibraryViewModel(this[APPLICATION_KEY] as RomSafeApp) }
        }
    }
}
