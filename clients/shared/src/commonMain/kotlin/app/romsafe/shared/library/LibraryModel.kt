package app.romsafe.shared.library

import app.romsafe.shared.api.GameDetail
import app.romsafe.shared.api.GameSort
import app.romsafe.shared.api.LibraryGame
import app.romsafe.shared.api.LibraryPlatform
import app.romsafe.shared.api.LibraryRom
import app.romsafe.shared.api.PlatformSort
import app.romsafe.shared.api.RomSafeApi
import app.romsafe.shared.api.SaveVersion
import app.romsafe.shared.sync.DownloadItem
import app.romsafe.shared.sync.DownloadState
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** One platform's heading and its games, in the server's order. */
data class PlatformGroup(val platform: LibraryPlatform, val games: List<LibraryGame>)

data class LibraryState(
    val platforms: List<LibraryPlatform> = emptyList(),
    /** The whole library, grouped by platform and sorted by the server. */
    val games: List<LibraryGame> = emptyList(),
    /** The platform chip that's selected; null shows them all. */
    val filter: String? = null,
    val query: String = "",
    val sort: GameSort = GameSort.TITLE,
    val platformSort: PlatformSort = PlatformSort.NAME,
    val loading: Boolean = false,
    val loaded: Boolean = false,
    /** The order the shown games were loaded in; a change means the list should start from the top. */
    val loadedOrder: Pair<GameSort, PlatformSort>? = null,
    val error: String? = null,
    /** The game page that's open, if any. */
    val page: GamePage? = null,
) {
    /** Filtering happens here, so typing in the search box doesn't wait on the network. */
    val groups: List<PlatformGroup>
        get() {
            val q = query.trim()
            val shown = games.filter { (filter == null || it.platform == filter) && (q.isEmpty() || it.title.contains(q, ignoreCase = true)) }
            val bySlug = shown.groupBy { it.platform }
            return platforms.mapNotNull { p -> bySlug[p.slug]?.let { PlatformGroup(p, it) } }
        }

    val total: Int get() = platforms.sumOf { it.games }
}

data class GamePage(
    val id: Long,
    val detail: GameDetail? = null,
    val error: String? = null,
    /** Save histories loaded so far, by save id. */
    val versions: Map<Long, List<SaveVersion>> = emptyMap(),
    val expanded: Set<Long> = emptySet(),
)

/** What a game looks like from this device. */
sealed interface GameStatus {
    data object OnDevice : GameStatus
    data class Downloading(val item: DownloadItem) : GameStatus
    data object Queued : GameStatus
    data class Failed(val message: String) : GameStatus
    data object Available : GameStatus
}

fun statusOf(roms: List<LibraryRom>, downloads: Map<Long, DownloadItem>): GameStatus {
    roms.firstNotNullOfOrNull { downloads[it.id] }?.let { return if (it.error != null) GameStatus.Failed(it.error) else GameStatus.Downloading(it) }
    return when {
        roms.any { it.localPath != null } -> GameStatus.OnDevice
        roms.any { it.queued } -> GameStatus.Queued
        else -> GameStatus.Available
    }
}

/** Where the library's sort choices are remembered; they outlive re-pairing like other view settings. */
interface LibraryPrefs {
    var librarySort: GameSort
    var libraryPlatformSort: PlatformSort
}

/**
 * The library and game pages, shared by both apps: the server sorts and
 * groups, search and the platform filter work locally. [api] is null while
 * the device isn't paired; [startDownloads] works through the server queue.
 */
class LibraryModel(
    private val scope: CoroutineScope,
    private val api: () -> RomSafeApi?,
    private val prefs: LibraryPrefs,
    private val downloads: DownloadState,
    private val startDownloads: () -> Unit,
) {
    private val _state = MutableStateFlow(LibraryState(sort = prefs.librarySort, platformSort = prefs.libraryPlatformSort))
    val state: StateFlow<LibraryState> = _state
    private var loadJob: Job? = null

    init {
        load()
        // A finished download changes what's on the device.
        scope.launch { downloads.finished.drop(1).collect { load(quiet = true) } }
    }

    fun filter(platform: String?) = _state.update { it.copy(filter = platform) }

    fun search(query: String) = _state.update { it.copy(query = query) }

    fun sort(sort: GameSort) {
        prefs.librarySort = sort
        _state.update { it.copy(sort = sort) }
        load()
    }

    fun platformSort(sort: PlatformSort) {
        prefs.libraryPlatformSort = sort
        _state.update { it.copy(platformSort = sort) }
        load()
    }

    fun load(quiet: Boolean = false) {
        loadJob?.cancel()
        if (!quiet) _state.update { it.copy(loading = true, error = null) }
        val s = _state.value
        loadJob = scope.launch {
            try {
                val library = api()?.library(s.sort, s.platformSort) ?: return@launch
                _state.update {
                    // A platform that no longer has games can't stay selected.
                    val filter = it.filter?.takeIf { f -> library.platforms.any { p -> p.slug == f } }
                    it.copy(
                        platforms = library.platforms,
                        games = library.games,
                        filter = filter,
                        loading = false,
                        loaded = true,
                        loadedOrder = s.sort to s.platformSort,
                        error = null,
                    )
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, error = e.message ?: "Couldn't load the library") }
            }
        }
    }

    // --- game pages ---------------------------------------------------------------

    fun openGame(id: Long) {
        _state.update { it.copy(page = GamePage(id)) }
        loadGame(id)
    }

    fun closeGame() = _state.update { it.copy(page = null) }

    fun loadGame(id: Long) {
        scope.launch {
            try {
                val detail = api()?.game(id) ?: return@launch
                updatePage(id) { it.copy(detail = detail, error = null, versions = emptyMap()) }
                // Reopen histories that were open, so a refresh doesn't fold them away.
                _state.value.page?.expanded?.forEach { loadVersions(id, it) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                updatePage(id) { it.copy(error = e.message ?: "Couldn't load this game") }
            }
        }
    }

    fun toggleHistory(saveId: Long) {
        val page = _state.value.page ?: return
        if (saveId in page.expanded) {
            updatePage(page.id) { it.copy(expanded = it.expanded - saveId) }
            return
        }
        updatePage(page.id) { it.copy(expanded = it.expanded + saveId) }
        if (saveId !in page.versions) loadVersions(page.id, saveId)
    }

    private fun loadVersions(gameId: Long, saveId: Long) {
        scope.launch {
            try {
                val versions = api()?.saveVersions(saveId) ?: return@launch
                updatePage(gameId) { it.copy(versions = it.versions + (saveId to versions)) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                updatePage(gameId) { it.copy(error = "Couldn't load the save history: ${e.message}") }
            }
        }
    }

    private fun updatePage(id: Long, change: (GamePage) -> GamePage) = _state.update { s ->
        if (s.page?.id == id) s.copy(page = change(s.page)) else s
    }

    // --- downloads ----------------------------------------------------------------

    fun download(rom: LibraryRom) {
        markQueued(rom.id, true)
        scope.launch {
            try {
                api()?.enqueue(listOf(rom.id))
                downloads.pendingIds += rom.id
                downloads.clearError(rom.id)
                startDownloads()
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
        downloads.clearError(rom.id)
        scope.launch { runCatching { api()?.dequeue(rom.id) } }
    }

    private fun markQueued(romId: Long, queued: Boolean) = _state.update { s ->
        s.copy(games = s.games.map { g -> g.copy(roms = g.roms.map { if (it.id == romId) it.copy(queued = queued) else it }) })
    }
}
