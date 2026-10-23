package app.romsafe.android

import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.romsafe.android.ui.AppViewModel
import app.romsafe.android.ui.PairScreen
import app.romsafe.android.ui.PlatformsScreen
import app.romsafe.android.ui.theme.RomSafeTheme

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
                        PlatformsScreen(
                            state = state,
                            onRefresh = vm::refresh,
                            onUnpair = vm::unpair,
                            onProfile = vm::selectProfile,
                            onFolder = vm::setFolder,
                            onClearFolder = vm::clearFolder,
                            onRetrySave = vm::retrySave,
                        )
                    }
                }
            }
        }
    }
}
