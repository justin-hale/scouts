package app.romsafe.desktop

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isAltPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.type
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Notification
import androidx.compose.ui.window.Tray
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.WindowPosition
import androidx.compose.ui.window.application
import androidx.compose.ui.window.rememberTrayState
import androidx.compose.ui.window.rememberWindowState
import app.romsafe.desktop.data.DesktopStore
import app.romsafe.desktop.ui.Home
import app.romsafe.desktop.ui.ImageLoaderSetup
import app.romsafe.desktop.ui.PairScreen
import app.romsafe.desktop.ui.RomSafeTheme
import app.romsafe.desktop.ui.TitleBar
import app.romsafe.desktop.ui.logoPainter
import app.romsafe.desktop.ui.syncLine
import kotlinx.coroutines.flow.MutableStateFlow
import kotlin.system.exitProcess

fun main(args: Array<String>) {
    // A second launch (the Start menu while it sits in the tray) brings the first one forward.
    val show = MutableStateFlow(0)
    val instance = SingleInstance.acquire { show.value++ } ?: exitProcess(0)
    // `--hidden` starts in the tray, for launching at sign-in.
    val startHidden = "--hidden" in args

    val store = DesktopStore()
    val app = AppModel(store)

    application {
        var visible by remember { mutableStateOf(!startHidden) }
        val state by app.state.collectAsState()
        val sync by app.sync.status.collectAsState()
        val showRequests by show.collectAsState()
        LaunchedEffect(showRequests) { if (showRequests > 0) visible = true }
        val tray = rememberTrayState()
        val paired = state.pairing != null
        val anythingSetUp = state.setups.isNotEmpty()

        Tray(
            icon = logoPainter(),
            state = tray,
            tooltip = "RomSafe · " + if (paired) syncLine(sync, anythingSetUp) else "Not paired",
            onAction = { visible = true },
            menu = {
                Item(if (paired) syncLine(sync, anythingSetUp) else "Not paired", enabled = false, onClick = {})
                Item("Sync now", enabled = paired && anythingSetUp && !sync.running, onClick = app::syncNow)
                Separator()
                Item("Open RomSafe", onClick = { visible = true })
                Item("Quit RomSafe", onClick = {
                    app.close()
                    instance.close()
                    exitApplication()
                })
            },
        )

        // Tell people once where the app went when they close the window.
        LaunchedEffect(visible) {
            if (!visible && paired && !store.trayHintShown) {
                store.trayHintShown = true
                tray.sendNotification(
                    Notification("RomSafe is still running", "Saves keep syncing in the background. Quit from the tray icon.", Notification.Type.Info),
                )
            }
        }

        Window(
            onCloseRequest = { visible = false },
            visible = visible,
            title = "RomSafe",
            icon = logoPainter(),
            state = rememberWindowState(size = DpSize(1280.dp, 840.dp), position = WindowPosition.PlatformDefault),
            onPreviewKeyEvent = { e ->
                // Escape or Alt+Left leaves a game page.
                val back = e.type == KeyEventType.KeyDown && (e.key == Key.Escape || (e.isAltPressed && e.key == Key.DirectionLeft))
                if (back && app.library.state.value.page != null) {
                    app.library.closeGame()
                    true
                } else {
                    false
                }
            },
        ) {
            window.minimumSize = java.awt.Dimension(900, 600)
            LaunchedEffect(Unit) { TitleBar.darken(window) }
            LaunchedEffect(showRequests) {
                if (showRequests > 0) {
                    window.isMinimized = false
                    window.toFront()
                    window.requestFocus()
                }
            }
            ImageLoaderSetup()
            RomSafeTheme {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    if (state.pairing == null) PairScreen(state, onPair = app::pair) else Home(app, state)
                }
            }
        }
    }
}
