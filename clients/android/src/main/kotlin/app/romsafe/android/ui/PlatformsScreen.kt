package app.romsafe.android.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.romsafe.android.R
import app.romsafe.android.ui.theme.Brand
import app.romsafe.android.ui.theme.Stone
import app.romsafe.android.ui.theme.Warning
import app.romsafe.shared.api.PlatformInfo
import app.romsafe.shared.api.Profile
import app.romsafe.shared.api.ServerUrl

private data class PickTarget(val slug: String, val kind: FolderKind, val slot: String)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlatformsScreen(
    state: AppState,
    sync: app.romsafe.shared.sync.SyncStatus,
    onSyncNow: () -> Unit,
    onRefresh: () -> Unit,
    onUnpair: () -> Unit,
    onProfile: (PlatformInfo, slot: String, profile: String) -> Unit,
    onFolder: (PlatformInfo, FolderKind, slot: String, Uri) -> Unit,
    onClearFolder: (PlatformInfo, FolderKind, slot: String) -> Unit,
    onAddEmulator: (PlatformInfo) -> Unit,
    onRemoveEmulator: (PlatformInfo, slot: String) -> Unit,
    onRetrySave: () -> Unit,
) {
    val config = state.config
    val snackbar = remember { SnackbarHostState() }
    var menuOpen by remember { mutableStateOf(false) }
    var expanded by rememberSaveable { mutableStateOf(setOf<String>()) }

    // Only one picker is ever open, so remember which platform and folder it is for.
    var pickTarget by rememberSaveable(stateSaver = PickTargetSaver) { mutableStateOf<PickTarget?>(null) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        val target = pickTarget
        pickTarget = null
        val platform = config?.platforms?.find { it.slug == target?.slug }
        if (uri != null && target != null && platform != null) onFolder(platform, target.kind, target.slot, uri)
    }
    val pick = { p: PlatformInfo, kind: FolderKind, slot: String, hint: String? ->
        pickTarget = PickTarget(p.slug, kind, slot)
        picker.launch(hint?.let(app.romsafe.android.data.Folders::initialUri))
    }

    val status = state.saveStatus
    LaunchedEffect(status) {
        if (status is SaveStatus.Failed) {
            val result = snackbar.showSnackbar(status.message, actionLabel = "Retry", withDismissAction = true)
            if (result == androidx.compose.material3.SnackbarResult.ActionPerformed) onRetrySave()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Image(painterResource(R.drawable.logo), contentDescription = null, Modifier.size(32.dp))
                        Spacer(Modifier.width(12.dp))
                        Column {
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
                    }
                },
                actions = {
                    IconButton(onClick = onRefresh, enabled = !state.loading) {
                        Icon(Icons.Filled.Refresh, contentDescription = "Reload from server")
                    }
                    Box {
                        IconButton(onClick = { menuOpen = true }) {
                            Icon(Icons.Filled.MoreVert, contentDescription = "More")
                        }
                        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                            DropdownMenuItem(text = { Text("Unpair this device") }, onClick = {
                                menuOpen = false
                                onUnpair()
                            })
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Stone.s950),
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.TopCenter) {
            if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            when {
                config == null && state.loadError != null -> LoadError(state.loadError, onRefresh)
                config == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                else -> {
                    val profiles = config.profiles.associateBy { it.id }
                    LazyColumn(
                        Modifier.widthIn(max = 760.dp).fillMaxSize(),
                        contentPadding = PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        item {
                            Header(state, config.platforms)
                        }
                        item {
                            SyncCard(sync, anythingSetUp = config.platforms.any(state::isSetUp), onSyncNow = onSyncNow)
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
                                onPick = { kind, slot, hint -> pick(p, kind, slot, hint) },
                                onClear = { kind, slot -> onClearFolder(p, kind, slot) },
                                onAddEmulator = { onAddEmulator(p) },
                                onRemoveEmulator = { onRemoveEmulator(p, it) },
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Header(state: AppState, platforms: List<PlatformInfo>) {
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
        Text(
            "$setUp of ${platforms.size} set up$saved",
            style = MaterialTheme.typography.labelLarge,
            color = Brand.b400,
        )
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

@OptIn(ExperimentalLayoutApi::class)

private val PickTargetSaver = androidx.compose.runtime.saveable.Saver<PickTarget?, String>(
    save = { it?.let { t -> listOf(t.kind.name, t.slot, t.slug).joinToString("|") } ?: "" },
    restore = { s ->
        s.split('|').takeIf { it.size == 3 }?.let { (kind, slot, slug) -> PickTarget(slug, FolderKind.valueOf(kind), slot) }
    },
)
