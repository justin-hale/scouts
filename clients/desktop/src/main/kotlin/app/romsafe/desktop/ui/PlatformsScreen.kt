package app.romsafe.desktop.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.VerticalScrollbar
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollbarAdapter
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.romsafe.desktop.AppState
import app.romsafe.desktop.FolderKind
import app.romsafe.desktop.SaveStatus
import app.romsafe.shared.api.PlatformInfo
import app.romsafe.shared.api.ServerUrl
import app.romsafe.shared.sync.SyncStatus

@Composable
fun PlatformsScreen(
    state: AppState,
    sync: SyncStatus,
    watchedFolders: Int,
    onSyncNow: () -> Unit,
    onRefresh: () -> Unit,
    onUnpair: () -> Unit,
    onProfile: (PlatformInfo, slot: String, profile: String) -> Unit,
    onFolder: (PlatformInfo, FolderKind, slot: String, String) -> Unit,
    onClearFolder: (PlatformInfo, FolderKind, slot: String) -> Unit,
    onAddEmulator: (PlatformInfo) -> Unit,
    onRemoveEmulator: (PlatformInfo, slot: String) -> Unit,
    onRetrySave: () -> Unit,
) {
    val config = state.config
    var menuOpen by remember { mutableStateOf(false) }
    var confirmUnpair by remember { mutableStateOf(false) }
    var expanded by rememberSaveable { mutableStateOf(setOf<String>()) }
    val list = rememberLazyListState()

    val pick = { p: PlatformInfo, kind: FolderKind, slot: String, start: String? ->
        val title = if (kind == FolderKind.Rom) "${p.name} ROM folder" else "${p.name} save folder"
        FolderChooser.choose(title, start)?.let { onFolder(p, kind, slot, it) }
    }

    Column(Modifier.fillMaxSize()) {
        // Header bar: who we are and where we're paired.
        Row(Modifier.fillMaxWidth().padding(start = 24.dp, end = 12.dp, top = 14.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Image(logoPainter(), contentDescription = null, Modifier.size(32.dp))
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text("RomSafe", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                val p = state.pairing
                if (p != null) {
                    Text(
                        "${p.deviceName} · ${ServerUrl.host(p.serverUrl)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            IconButton(onClick = onRefresh, enabled = !state.loading) {
                Icon(Icons.Filled.Refresh, contentDescription = "Reload from server")
            }
            Box {
                IconButton(onClick = { menuOpen = true }) {
                    Icon(Icons.Filled.MoreVert, contentDescription = "More")
                }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }, containerColor = Stone.s900) {
                    DropdownMenuItem(text = { Text("Unpair this computer") }, onClick = {
                        menuOpen = false
                        confirmUnpair = true
                    })
                }
            }
        }

        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
            if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth(), color = Brand.b400)
            when {
                config == null && state.loadError != null -> LoadError(state.loadError, onRefresh)
                config == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Brand.b400) }
                else -> {
                    val profiles = config.profiles.associateBy { it.id }
                    LazyColumn(
                        Modifier.widthIn(max = 860.dp).fillMaxSize(),
                        state = list,
                        contentPadding = PaddingValues(start = 24.dp, end = 24.dp, top = 8.dp, bottom = 24.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        item { Header(state, config.platforms, onRetrySave) }
                        item {
                            SyncCard(sync, watchedFolders, anythingSetUp = config.platforms.any(state::isSetUp), onSyncNow = onSyncNow)
                        }
                        if (config.platforms.isEmpty()) {
                            item {
                                Text(
                                    "No platforms are enabled on the server yet. Turn some on in the web app's Platforms page.",
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                        items(config.platforms, key = { it.slug }) { p ->
                            PlatformCard(
                                platform = p,
                                state = state,
                                profiles = profiles,
                                expanded = p.slug in expanded,
                                onToggle = { expanded = if (p.slug in expanded) expanded - p.slug else expanded + p.slug },
                                onProfile = { slot, profile -> onProfile(p, slot, profile) },
                                onPick = { kind, slot, start -> pick(p, kind, slot, start) },
                                onUse = { kind, slot, path -> onFolder(p, kind, slot, path) },
                                onClear = { kind, slot -> onClearFolder(p, kind, slot) },
                                onAddEmulator = { onAddEmulator(p) },
                                onRemoveEmulator = { onRemoveEmulator(p, it) },
                            )
                        }
                    }
                    VerticalScrollbar(
                        rememberScrollbarAdapter(list),
                        Modifier.align(Alignment.CenterEnd).fillMaxHeight().padding(vertical = 4.dp, horizontal = 2.dp),
                    )
                }
            }
        }
    }

    if (confirmUnpair) {
        AlertDialog(
            onDismissRequest = { confirmUnpair = false },
            title = { Text("Unpair this computer?") },
            text = {
                Text(
                    "RomSafe stops syncing here and forgets the folder setup. Your save files stay where they are, " +
                        "and the server keeps every version.",
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    confirmUnpair = false
                    onUnpair()
                }) { Text("Unpair") }
            },
            dismissButton = { TextButton(onClick = { confirmUnpair = false }) { Text("Cancel") } },
            containerColor = Stone.s900,
        )
    }
}

@Composable
private fun Header(state: AppState, platforms: List<PlatformInfo>, onRetrySave: () -> Unit) {
    Column(Modifier.padding(bottom = 6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("Platforms", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
        Text(
            "For each system, pick the emulator you use and the folder it keeps saves in. " +
                "Only the platforms you set up are synced.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        val setUp = platforms.count(state::isSetUp)
        val saved = when (state.saveStatus) {
            SaveStatus.Saving -> " · Saving…"
            SaveStatus.Saved -> " · Saved to server"
            is SaveStatus.Failed -> " · Not saved"
            SaveStatus.Idle -> ""
        }
        Text("$setUp of ${platforms.size} set up$saved", style = MaterialTheme.typography.labelLarge, color = Brand.b400)
        val status = state.saveStatus
        if (status is SaveStatus.Failed) {
            Surface(color = Stone.s900, shape = MaterialTheme.shapes.small) {
                Row(Modifier.padding(start = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(status.message, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error, modifier = Modifier.weight(1f))
                    TextButton(onClick = onRetrySave) { Text("Retry") }
                }
            }
        }
    }
}

@Composable
private fun LoadError(message: String, onRetry: () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
    ) {
        Text("Couldn't load the server's settings", style = MaterialTheme.typography.titleMedium)
        Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Button(onClick = onRetry) { Text("Try again") }
    }
}
