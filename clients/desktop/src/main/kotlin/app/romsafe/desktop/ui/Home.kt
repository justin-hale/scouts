package app.romsafe.desktop.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.Text
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.isBackPressed
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import app.romsafe.desktop.AppModel
import app.romsafe.desktop.AppState

private enum class Tab { Library, Platforms }

/** The paired app: a rail with Library and Sync, like the Android app on a wide screen. */
@Composable
fun Home(app: AppModel, state: AppState) {
    val sync by app.sync.status.collectAsState()
    val watched by app.sync.watched.collectAsState()
    // Start on the library once something is set up; a fresh pairing starts on the folder setup.
    var tab by rememberSaveable { mutableStateOf(if (state.setups.isEmpty()) Tab.Platforms else Tab.Library) }

    // Each tab keeps its saveable state (scroll positions above all) while the other is shown.
    val tabStates = rememberSaveableStateHolder()
    Row(Modifier.fillMaxSize()) {
        NavigationRail(
            containerColor = Stone.s950,
            header = { Image(logoPainter(), contentDescription = null, Modifier.padding(top = 12.dp, bottom = 8.dp).size(40.dp)) },
        ) {
            NavigationRailItem(
                selected = tab == Tab.Library,
                onClick = { tab = Tab.Library },
                icon = { Icon(AppIcons.library, contentDescription = null) },
                label = { Text("Library") },
            )
            NavigationRailItem(
                selected = tab == Tab.Platforms,
                onClick = { tab = Tab.Platforms },
                icon = { Icon(Icons.Filled.Settings, contentDescription = null) },
                label = { Text("Sync") },
            )
        }
        VerticalDivider(color = Stone.s800)
        Box(Modifier.weight(1f)) {
            tabStates.SaveableStateProvider(tab.name) {
                when (tab) {
                    Tab.Library -> LibraryTab(app, state) { tab = Tab.Platforms }
                    Tab.Platforms -> PlatformsScreen(
                        state = state,
                        sync = sync,
                        watchedFolders = watched,
                        onSyncNow = app::syncNow,
                        onRefresh = app::refresh,
                        onUnpair = app::unpair,
                        onProfile = app::selectProfile,
                        onFolder = app::setFolder,
                        onClearFolder = app::clearFolder,
                        onAddEmulator = app::addEmulator,
                        onRemoveEmulator = app::removeEmulator,
                        onRetrySave = app::retrySave,
                    )
                }
            }
        }
    }
}

@Composable
private fun LibraryTab(app: AppModel, state: AppState, onSetUpFolders: () -> Unit) {
    val library = app.library
    val libState by library.state.collectAsState()
    val downloads by app.sync.downloads.items.collectAsState()
    // Kept here so coming back from a game page lands where you were.
    val grid = rememberLazyGridState()
    // The order and filter the grid last showed; saved with the tab, so coming back isn't a change.
    var shown by rememberSaveable { mutableStateOf<String?>(null) }
    val pairing = state.pairing ?: return
    // Coming back to the tab picks up what changed on the server meanwhile.
    LaunchedEffect(Unit) { library.load(quiet = true) }
    // A new order or platform filter starts from the top; otherwise the grid would stay
    // anchored to whichever game was first on screen.
    val order = "${libState.loadedOrder}|${libState.filter}"
    LaunchedEffect(order) {
        if (shown != null && shown != order) grid.scrollToItem(0)
        shown = order
    }
    val romFolders = state.romFolders
    val art = remember(pairing) { ArtSource(pairing.serverUrl, "Bearer ${pairing.token}") }

    // The mouse's back button leaves a game page, as in a browser.
    Box(
        Modifier.fillMaxSize().pointerInput(Unit) {
            awaitPointerEventScope {
                while (true) {
                    val event = awaitPointerEvent()
                    if (event.type == PointerEventType.Press && event.buttons.isBackPressed) library.closeGame()
                }
            }
        },
    ) {
        val page = libState.page
        if (page != null) {
            val platform = page.detail?.platform ?: libState.games.find { it.id == page.id }?.platform
            // A fresh page (and scroll position) per game.
            key(page.id) {
                GameScreen(
                    page = page,
                    libraryRoms = libState.games.find { it.id == page.id }?.roms.orEmpty(),
                    platformName = libState.platforms.find { it.slug == platform }?.name ?: platform.orEmpty(),
                    canDownload = platform in romFolders,
                    downloads = downloads,
                    art = art,
                    onBack = library::closeGame,
                    onRetry = { library.loadGame(page.id) },
                    onToggleHistory = library::toggleHistory,
                    onDownload = library::download,
                    onCancel = library::cancel,
                    onSetUpFolders = onSetUpFolders,
                )
            }
        } else {
            LibraryScreen(
                state = libState,
                romFolders = romFolders,
                downloads = downloads,
                art = art,
                gridState = grid,
                onFilter = library::filter,
                onSearch = library::search,
                onSort = library::sort,
                onPlatformSort = library::platformSort,
                onReload = { library.load() },
                onOpen = { library.openGame(it.id) },
                onDownload = library::download,
                onSetUpFolders = onSetUpFolders,
            )
        }
    }
}
