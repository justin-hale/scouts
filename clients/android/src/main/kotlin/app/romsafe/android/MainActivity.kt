package app.romsafe.android

import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.romsafe.android.sync.Downloads
import app.romsafe.android.sync.SyncRunner
import app.romsafe.android.ui.AppState
import app.romsafe.android.ui.AppViewModel
import app.romsafe.android.ui.LibraryScreen
import app.romsafe.android.ui.LibraryViewModel
import app.romsafe.android.ui.PairScreen
import app.romsafe.android.ui.PlatformsScreen
import app.romsafe.android.ui.theme.Brand
import app.romsafe.android.ui.theme.RomSafeTheme
import app.romsafe.android.ui.theme.Stone

private enum class Tab { Library, Platforms }

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        setContent {
            RomSafeTheme {
                val vm: AppViewModel = viewModel(factory = AppViewModel.Factory)
                val state by vm.state.collectAsStateWithLifecycle()
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    if (state.pairing == null) {
                        PairScreen(state, onPair = vm::pair)
                    } else {
                        Home(state, vm)
                    }
                }
            }
        }
    }
}

@Composable
private fun Home(state: AppState, vm: AppViewModel) {
    val sync by SyncRunner.status.collectAsStateWithLifecycle()
    // Start on the library once something is set up; a fresh pairing starts on the folder setup.
    var tab by rememberSaveable { mutableStateOf(if (state.setups.isEmpty()) Tab.Platforms else Tab.Library) }
    val wide = LocalConfiguration.current.screenWidthDp >= 600
    val librarySides = if (wide) WindowInsetsSides.Top + WindowInsetsSides.End + WindowInsetsSides.Bottom else WindowInsetsSides.Top

    val content: @Composable () -> Unit = {
        when (tab) {
            Tab.Library -> LibraryTab(state, Modifier.windowInsetsPadding(WindowInsets.safeDrawing.only(librarySides))) {
                tab = Tab.Platforms
            }
            Tab.Platforms -> PlatformsScreen(
                state = state,
                sync = sync,
                onSyncNow = vm::syncNow,
                onRefresh = vm::refresh,
                onUnpair = vm::unpair,
                onProfile = vm::selectProfile,
                onFolder = vm::setFolder,
                onClearFolder = vm::clearFolder,
                onAddEmulator = vm::addEmulator,
                onRemoveEmulator = vm::removeEmulator,
                onRetrySave = vm::retrySave,
            )
        }
    }
    val libraryIcon = painterResource(R.drawable.ic_library)
    val syncIcon = rememberVectorPainter(Icons.Filled.Settings)

    if (wide) {
        Row(Modifier.fillMaxSize()) {
            NavigationRail(
                containerColor = Stone.s950,
                header = { Image(painterResource(R.drawable.logo), contentDescription = null, Modifier.padding(top = 8.dp).size(40.dp)) },
            ) {
                NavigationRailItem(
                    selected = tab == Tab.Library,
                    onClick = { tab = Tab.Library },
                    icon = { Icon(libraryIcon, contentDescription = null) },
                    label = { Text("Library") },
                )
                NavigationRailItem(
                    selected = tab == Tab.Platforms,
                    onClick = { tab = Tab.Platforms },
                    icon = { Icon(syncIcon, contentDescription = null) },
                    label = { Text("Sync") },
                )
            }
            VerticalDivider(color = Stone.s800)
            Box(Modifier.weight(1f)) { content() }
        }
    } else {
        Scaffold(
            bottomBar = {
                NavigationBar(containerColor = Stone.s900) {
                    NavigationBarItem(tab == Tab.Library, { tab = Tab.Library }, { Icon(libraryIcon, null) }, label = { Text("Library") })
                    NavigationBarItem(tab == Tab.Platforms, { tab = Tab.Platforms }, { Icon(syncIcon, null) }, label = { Text("Sync") })
                }
            },
            contentWindowInsets = WindowInsets(0),
        ) { padding -> Box(Modifier.padding(padding)) { content() } }
    }
}

@Composable
private fun LibraryTab(state: AppState, modifier: Modifier, onSetUpFolders: () -> Unit) {
    val library: LibraryViewModel = viewModel(factory = LibraryViewModel.Factory)
    val libState by library.state.collectAsStateWithLifecycle()
    val downloads by Downloads.items.collectAsStateWithLifecycle()
    val pairing = state.pairing ?: return
    val config = state.config
    Box(modifier.fillMaxSize()) {
        if (config == null) {
            Text(state.loadError ?: "Loading…", color = Brand.b400, modifier = Modifier.padding(24.dp))
        } else {
            LibraryScreen(
                state = libState,
                platforms = config.platforms,
                romFolders = state.setups.filterValues { it.romUri != null && it.romUri in state.granted }.keys,
                downloads = downloads,
                serverUrl = pairing.serverUrl,
                authHeader = "Bearer ${pairing.token}",
                onPlatform = library::select,
                onSearch = library::search,
                onDownload = library::download,
                onCancel = library::cancel,
                onSetUpFolders = onSetUpFolders,
            )
        }
    }
}
