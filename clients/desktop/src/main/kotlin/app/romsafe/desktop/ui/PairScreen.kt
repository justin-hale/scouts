package app.romsafe.desktop.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.romsafe.desktop.AppState
import java.net.InetAddress

@Composable
fun PairScreen(state: AppState, onPair: (url: String, code: String, name: String) -> Unit) {
    var url by rememberSaveable { mutableStateOf(state.lastServerUrl.orEmpty()) }
    var code by rememberSaveable { mutableStateOf("") }
    var name by rememberSaveable { mutableStateOf(defaultDeviceName()) }
    val canPair = url.isNotBlank() && code.isNotBlank() && name.isNotBlank() && !state.pairBusy
    val submit = { if (canPair) onPair(url, code, name) }

    Box(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), contentAlignment = Alignment.Center) {
        Column(
            Modifier.widthIn(max = 440.dp).fillMaxWidth().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Image(logoPainter(), contentDescription = null, Modifier.size(88.dp))
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("RomSafe", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold)
                Text(
                    "Connect this computer to your RomSafe server to sync saves and download games.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
            }
            Spacer(Modifier.height(4.dp))
            OutlinedTextField(
                value = url,
                onValueChange = { url = it },
                label = { Text("Server address") },
                placeholder = { Text("192.168.1.20:8080") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = code,
                onValueChange = { code = it.uppercase().filter { c -> c.isLetterOrDigit() }.take(12) },
                label = { Text("Pairing code") },
                supportingText = { Text("In the web app: Devices → Pair a device. Codes last 10 minutes.") },
                singleLine = true,
                textStyle = MaterialTheme.typography.bodyLarge.copy(fontFamily = FontFamily.Monospace, letterSpacing = 2.sp),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text("Device name") },
                supportingText = { Text("How this computer shows up on the server.") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { submit() }),
                modifier = Modifier.fillMaxWidth(),
            )
            state.pairError?.let {
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
            }
            Button(onClick = submit, enabled = canPair, modifier = Modifier.fillMaxWidth().height(48.dp)) {
                if (state.pairBusy) {
                    CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                } else {
                    Text("Pair")
                }
            }
        }
    }
}

/** The computer's name, as Windows shows it ("GAMING-PC"), in a friendlier case. */
private fun defaultDeviceName(): String {
    val raw = System.getenv("COMPUTERNAME") ?: runCatching { InetAddress.getLocalHost().hostName }.getOrNull() ?: "Desktop"
    return if (raw == raw.uppercase()) raw.lowercase().split('-', '_', ' ').joinToString(" ") { it.replaceFirstChar(Char::uppercase) } else raw
}
