package app.romsafe.android.ui

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.text.format.Formatter
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import app.romsafe.android.R
import app.romsafe.android.sync.Downloads
import app.romsafe.android.ui.theme.Brand
import app.romsafe.android.ui.theme.Stone
import app.romsafe.android.ui.theme.Warning
import app.romsafe.shared.api.LibraryGame
import app.romsafe.shared.api.LibraryRom
import app.romsafe.shared.api.PlatformInfo
import coil3.compose.AsyncImage
import coil3.network.NetworkHeaders
import coil3.network.httpHeaders
import coil3.request.ImageRequest
import coil3.request.crossfade

/** What a game looks like from this device. */
private sealed interface GameStatus {
    data object OnDevice : GameStatus
    data class Downloading(val item: Downloads.Item) : GameStatus
    data object Queued : GameStatus
    data class Failed(val message: String) : GameStatus
    data object Available : GameStatus
}

private fun statusOf(game: LibraryGame, downloads: Map<Long, Downloads.Item>): GameStatus {
    game.roms.firstNotNullOfOrNull { downloads[it.id] }?.let { return if (it.error != null) GameStatus.Failed(it.error) else GameStatus.Downloading(it) }
    return when {
        game.roms.any { it.localPath != null } -> GameStatus.OnDevice
        game.roms.any { it.queued } -> GameStatus.Queued
        else -> GameStatus.Available
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LibraryScreen(
    state: LibraryState,
    platforms: List<PlatformInfo>,
    /** Platforms with a ROM folder on this device: downloads need one. */
    romFolders: Set<String>,
    downloads: Map<Long, Downloads.Item>,
    serverUrl: String,
    authHeader: String?,
    onPlatform: (String) -> Unit,
    onSearch: (String) -> Unit,
    onDownload: (LibraryRom) -> Unit,
    onCancel: (LibraryRom) -> Unit,
    onSetUpFolders: () -> Unit,
) {
    val context = LocalContext.current
    // Platforms you can download to come first.
    val ordered = remember(platforms, romFolders) { platforms.sortedBy { it.slug !in romFolders } }
    LaunchedEffect(ordered) {
        if (state.platform == null) ordered.firstOrNull()?.let { onPlatform(it.slug) }
    }
    var sheetGame by remember { mutableStateOf<LibraryGame?>(null) }

    // Ask once for notifications, so download progress shows outside the app.
    val notifyPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    val download = { rom: LibraryRom ->
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            notifyPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        onDownload(rom)
    }

    Column(Modifier.fillMaxSize()) {
        Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Library", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                OutlinedTextField(
                    value = state.query,
                    onValueChange = onSearch,
                    placeholder = { Text("Search") },
                    leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
                    singleLine = true,
                    modifier = Modifier.width(260.dp),
                )
            }
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ordered.forEach { p ->
                    FilterChip(
                        selected = p.slug == state.platform,
                        onClick = { onPlatform(p.slug) },
                        label = { Text(p.name) },
                        colors = FilterChipDefaults.filterChipColors(selectedContainerColor = Brand.b900, selectedLabelColor = Brand.b100),
                    )
                }
            }
            val selected = platforms.find { it.slug == state.platform }
            if (selected != null && selected.slug !in romFolders) {
                Surface(shape = RoundedCornerShape(10.dp), color = Stone.s900, border = BorderStroke(1.dp, Warning.copy(alpha = 0.5f))) {
                    Row(Modifier.padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "Choose a ROM folder for ${selected.name} to download games here.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = Stone.s300,
                            modifier = Modifier.weight(1f),
                        )
                        TextButton(onClick = onSetUpFolders) { Text("Set up") }
                    }
                }
            }
            state.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
        }

        Box(Modifier.fillMaxSize()) {
            if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth().padding(top = 8.dp))
            if (!state.loading && state.games.isEmpty() && state.error == null && state.platform != null) {
                Text(
                    "No games for this platform on the server yet.",
                    color = Stone.s500,
                    modifier = Modifier.align(Alignment.Center),
                )
            }
            val canDownload = state.platform in romFolders
            LazyVerticalGrid(
                columns = GridCells.Adaptive(150.dp),
                contentPadding = PaddingValues(16.dp),
                horizontalArrangement = Arrangement.spacedBy(14.dp),
                verticalArrangement = Arrangement.spacedBy(18.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                items(state.visible, key = { it.id }) { game ->
                    GameCard(
                        game = game,
                        status = statusOf(game, downloads),
                        coverUrl = game.cover?.let { "$serverUrl/api/covers/$it" },
                        authHeader = authHeader,
                        canDownload = canDownload,
                        onOpen = { sheetGame = game },
                        onDownload = { game.roms.singleOrNull()?.let(download) ?: run { sheetGame = game } },
                    )
                }
            }
        }
    }

    sheetGame?.let { g ->
        // Show the live copy, so queued/downloaded states update while the sheet is open.
        val game = state.games.find { it.id == g.id } ?: g
        ModalBottomSheet(onDismissRequest = { sheetGame = null }, containerColor = Stone.s900) {
            GameSheet(game, downloads, state.platform in romFolders, onDownload = download, onCancel = onCancel)
        }
    }
}

@Composable
private fun GameCard(
    game: LibraryGame,
    status: GameStatus,
    coverUrl: String?,
    authHeader: String?,
    canDownload: Boolean,
    onOpen: () -> Unit,
    onDownload: () -> Unit,
) {
    Column(Modifier.clickable(onClick = onOpen)) {
        Box(Modifier.fillMaxWidth().aspectRatio(3f / 4f).clip(RoundedCornerShape(10.dp)).background(Stone.s800)) {
            Cover(coverUrl, authHeader, game.title)
            Box(Modifier.align(Alignment.BottomEnd).padding(8.dp)) {
                StatusBadge(status, canDownload, onDownload)
            }
            if (status is GameStatus.Downloading && status.item.total > 0) {
                LinearProgressIndicator(
                    progress = { (status.item.done.toFloat() / status.item.total).coerceIn(0f, 1f) },
                    modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth(),
                    color = Brand.b400,
                    trackColor = Stone.s950.copy(alpha = 0.6f),
                )
            }
        }
        Spacer(Modifier.size(6.dp))
        Text(game.title, style = MaterialTheme.typography.bodyMedium, color = Stone.s100, maxLines = 2, overflow = TextOverflow.Ellipsis)
        val context = LocalContext.current
        Text(
            when (status) {
                GameStatus.OnDevice -> "On this device"
                GameStatus.Queued -> "Waiting to download"
                is GameStatus.Failed -> status.message
                is GameStatus.Downloading ->
                    if (status.item.total > 0) {
                        "${Formatter.formatShortFileSize(context, status.item.done)} of ${Formatter.formatShortFileSize(context, status.item.total)}"
                    } else {
                        "Starting…"
                    }
                GameStatus.Available ->
                    game.roms.singleOrNull()?.let { Formatter.formatShortFileSize(context, it.size) } ?: "${game.roms.size} versions"
            },
            style = MaterialTheme.typography.bodySmall,
            color = when (status) {
                GameStatus.OnDevice -> Brand.b400
                is GameStatus.Failed -> Warning
                else -> Stone.s500
            },
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun Cover(url: String?, authHeader: String?, title: String) {
    val context = LocalContext.current
    if (url == null) {
        Box(Modifier.fillMaxSize().padding(12.dp), contentAlignment = Alignment.Center) {
            Text(title, style = MaterialTheme.typography.titleSmall, color = Stone.s400, textAlign = TextAlign.Center)
        }
        return
    }
    val request = remember(url, authHeader) {
        ImageRequest.Builder(context)
            .data(url)
            .httpHeaders(NetworkHeaders.Builder().apply { authHeader?.let { set("Authorization", it) } }.build())
            .crossfade(true)
            .build()
    }
    AsyncImage(model = request, contentDescription = title, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
}

@Composable
private fun StatusBadge(status: GameStatus, canDownload: Boolean, onDownload: () -> Unit) {
    val modifier = Modifier.size(36.dp).clip(CircleShape)
    when (status) {
        GameStatus.OnDevice -> Box(modifier.background(Stone.s950.copy(alpha = 0.8f)), contentAlignment = Alignment.Center) {
            Icon(painterResource(R.drawable.ic_check_circle), contentDescription = "On this device", tint = Brand.b400, modifier = Modifier.size(22.dp))
        }
        is GameStatus.Downloading, GameStatus.Queued -> Box(modifier.background(Stone.s950.copy(alpha = 0.8f)), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = Brand.b400)
        }
        is GameStatus.Failed, GameStatus.Available -> if (canDownload) {
            Box(modifier.background(Brand.b600).clickable(onClick = onDownload), contentAlignment = Alignment.Center) {
                Icon(painterResource(R.drawable.ic_download), contentDescription = "Download", tint = androidx.compose.ui.graphics.Color.White, modifier = Modifier.size(20.dp))
            }
        }
    }
}

@Composable
private fun GameSheet(
    game: LibraryGame,
    downloads: Map<Long, Downloads.Item>,
    canDownload: Boolean,
    onDownload: (LibraryRom) -> Unit,
    onCancel: (LibraryRom) -> Unit,
) {
    val context = LocalContext.current
    Column(Modifier.padding(start = 20.dp, end = 20.dp, bottom = 28.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(game.title, style = MaterialTheme.typography.titleLarge, color = Stone.s100)
        game.releaseDate?.take(4)?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = Stone.s500) }
        HorizontalDivider(color = Stone.s800)
        for (rom in game.roms) {
            val item = downloads[rom.id]
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(rom.fileName, style = MaterialTheme.typography.bodyMedium, color = Stone.s200)
                    Text(
                        listOfNotNull(
                            Formatter.formatShortFileSize(context, rom.size),
                            if (rom.multiFile) "with its track/disc files" else null,
                            rom.localPath?.let { "on device as $it" },
                            item?.error,
                        ).joinToString(" · "),
                        style = MaterialTheme.typography.bodySmall,
                        color = if (item?.error != null) Warning else Stone.s500,
                    )
                    if (item != null && item.error == null && item.total > 0) {
                        LinearProgressIndicator(
                            progress = { (item.done.toFloat() / item.total).coerceIn(0f, 1f) },
                            modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                            color = Brand.b400,
                        )
                    }
                }
                Spacer(Modifier.width(12.dp))
                when {
                    rom.localPath != null -> Icon(painterResource(R.drawable.ic_check_circle), contentDescription = "On this device", tint = Brand.b400)
                    rom.queued || (item != null && item.error == null) -> IconButton(onClick = { onCancel(rom) }) {
                        Icon(Icons.Filled.Close, contentDescription = "Cancel", tint = Stone.s400)
                    }
                    canDownload -> TextButton(onClick = { onDownload(rom) }) { Text("Download") }
                }
            }
        }
    }
}
