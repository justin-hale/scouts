package app.romsafe.android.ui

import android.text.format.Formatter
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
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.romsafe.android.R
import app.romsafe.shared.library.GameStatus
import app.romsafe.shared.library.LibraryState
import app.romsafe.shared.library.PlatformGroup
import app.romsafe.shared.library.statusOf
import app.romsafe.shared.sync.DownloadItem
import app.romsafe.android.ui.theme.Brand
import app.romsafe.android.ui.theme.Stone
import app.romsafe.android.ui.theme.Warning
import app.romsafe.shared.api.GameSort
import app.romsafe.shared.api.LibraryGame
import app.romsafe.shared.api.LibraryRom
import app.romsafe.shared.api.PlatformSort

@Composable
fun LibraryScreen(
    state: LibraryState,
    /** Platforms with a ROM folder on this device: downloads need one. */
    romFolders: Set<String>,
    downloads: Map<Long, DownloadItem>,
    art: ArtSource,
    gridState: LazyGridState,
    onFilter: (String?) -> Unit,
    onSearch: (String) -> Unit,
    onSort: (GameSort) -> Unit,
    onPlatformSort: (PlatformSort) -> Unit,
    onOpen: (LibraryGame) -> Unit,
    onDownload: (LibraryRom) -> Unit,
    onSetUpFolders: () -> Unit,
) {
    val groups = state.groups
    Column(Modifier.fillMaxSize()) {
        Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Library", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
                    if (state.loaded) Text("${state.total} games", style = MaterialTheme.typography.bodySmall, color = Stone.s500)
                }
                OutlinedTextField(
                    value = state.query,
                    onValueChange = onSearch,
                    placeholder = { Text("Search titles") },
                    leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
                    trailingIcon = {
                        if (state.query.isNotEmpty()) {
                            IconButton(onClick = { onSearch("") }) { Icon(Icons.Filled.Close, contentDescription = "Clear search") }
                        }
                    },
                    singleLine = true,
                    modifier = Modifier.width(280.dp),
                )
                Spacer(Modifier.width(4.dp))
                SortMenu(state.sort, state.platformSort, onSort, onPlatformSort)
            }
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PlatformChip("All", state.total, state.filter == null) { onFilter(null) }
                state.platforms.forEach { p -> PlatformChip(p.name, p.games, p.slug == state.filter) { onFilter(p.slug) } }
            }
            val selected = state.platforms.find { it.slug == state.filter }
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
            if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth().padding(top = 8.dp), color = Brand.b400)
            if (state.loaded && groups.isEmpty()) {
                Text(
                    if (state.total == 0) "No games on the server yet." else "No games match.",
                    color = Stone.s500,
                    modifier = Modifier.align(Alignment.Center),
                )
            }
            LazyVerticalGrid(
                columns = GridCells.Adaptive(128.dp),
                state = gridState,
                contentPadding = PaddingValues(16.dp),
                horizontalArrangement = Arrangement.spacedBy(14.dp),
                verticalArrangement = Arrangement.spacedBy(18.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                for ((index, group) in groups.withIndex()) {
                    // In the All view each platform gets a heading, as on the web.
                    if (state.filter == null) {
                        item(key = "h:${group.platform.slug}", span = { GridItemSpan(maxLineSpan) }, contentType = "heading") {
                            PlatformHeading(art, group, first = index == 0)
                        }
                    }
                    items(group.games, key = { it.id }, contentType = { "game" }) { game ->
                        GameCard(
                            game = game,
                            status = statusOf(game.roms, downloads),
                            art = art,
                            platformName = group.platform.name,
                            canDownload = game.platform in romFolders,
                            onOpen = { onOpen(game) },
                            onDownload = { game.roms.singleOrNull()?.let(onDownload) ?: onOpen(game) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun PlatformChip(label: String, count: Int, selected: Boolean, onClick: () -> Unit) {
    FilterChip(
        selected = selected,
        onClick = onClick,
        label = {
            Text(label)
            Spacer(Modifier.width(6.dp))
            Text("$count", color = if (selected) Brand.b300 else Stone.s500)
        },
        colors = FilterChipDefaults.filterChipColors(selectedContainerColor = Brand.b900, selectedLabelColor = Brand.b100),
    )
}

@Composable
private fun PlatformHeading(art: ArtSource, group: PlatformGroup, first: Boolean) {
    Column(Modifier.padding(top = if (first) 0.dp else 14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            PlatformLogo(art, group.platform.slug, group.platform.name, Modifier.widthIn(max = 200.dp), scale = 1.15f)
            Text(group.platform.name, style = MaterialTheme.typography.bodyMedium, color = Stone.s400)
            Text("${group.games.size}", style = MaterialTheme.typography.bodySmall, color = Stone.s600)
        }
        HorizontalDivider(color = Stone.s800, modifier = Modifier.padding(top = 8.dp))
    }
}

@Composable
private fun SortMenu(sort: GameSort, platformSort: PlatformSort, onSort: (GameSort) -> Unit, onPlatformSort: (PlatformSort) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { open = true }) { Icon(painterResource(R.drawable.ic_sort), contentDescription = "Sort", tint = Stone.s300) }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, containerColor = Stone.s900) {
            MenuHeading("Games")
            GameSort.entries.forEach { s ->
                SortItem(s.label, s == sort) {
                    open = false
                    if (s != sort) onSort(s)
                }
            }
            HorizontalDivider(color = Stone.s800)
            MenuHeading("Platforms")
            PlatformSort.entries.forEach { s ->
                SortItem(s.label, s == platformSort) {
                    open = false
                    if (s != platformSort) onPlatformSort(s)
                }
            }
        }
    }
}

@Composable
private fun MenuHeading(text: String) {
    Text(text.uppercase(), style = MaterialTheme.typography.labelSmall, color = Stone.s500, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
}

@Composable
private fun SortItem(label: String, selected: Boolean, onClick: () -> Unit) {
    DropdownMenuItem(
        text = { Text(label, color = if (selected) Brand.b300 else Stone.s200) },
        leadingIcon = {
            if (selected) Icon(Icons.Filled.Check, contentDescription = null, tint = Brand.b400) else Spacer(Modifier.size(24.dp))
        },
        onClick = onClick,
    )
}

@Composable
private fun GameCard(
    game: LibraryGame,
    status: GameStatus,
    art: ArtSource,
    platformName: String,
    canDownload: Boolean,
    onOpen: () -> Unit,
    onDownload: () -> Unit,
) {
    Column(Modifier.clip(RoundedCornerShape(10.dp)).clickable(onClick = onOpen)) {
        Box(Modifier.fillMaxWidth().aspectRatio(3f / 4f).clip(RoundedCornerShape(10.dp)).background(Stone.s900)) {
            Cover(art, game.cover, game.title)
            // Darken the bottom of the art so the platform logo and save marker read on any cover.
            Box(
                Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .fillMaxHeight(0.4f)
                    .background(Brush.verticalGradient(0f to Color.Transparent, 0.5f to Color.Black.copy(alpha = 0.4f), 1f to Color.Black.copy(alpha = 0.9f))),
            ) {
                Row(
                    Modifier.align(Alignment.BottomStart).fillMaxWidth().padding(start = 10.dp, end = 10.dp, bottom = 8.dp),
                    verticalAlignment = Alignment.Bottom,
                ) {
                    Box(Modifier.weight(1f)) { PlatformLogo(art, game.platform, platformName, Modifier.fillMaxWidth(0.72f)) }
                    if (game.saveCount > 0) SaveMarker(game.saveCount)
                }
            }
            Box(Modifier.align(Alignment.TopEnd).padding(8.dp)) { StatusBadge(status, canDownload, onDownload) }
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
        Text(game.title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = Stone.s100, maxLines = 2, overflow = TextOverflow.Ellipsis)
        val context = LocalContext.current
        val line = when (status) {
            GameStatus.OnDevice -> "On this device"
            GameStatus.Queued -> "Waiting to download"
            is GameStatus.Failed -> status.message
            is GameStatus.Downloading ->
                if (status.item.total > 0) {
                    "${Formatter.formatShortFileSize(context, status.item.done)} of ${Formatter.formatShortFileSize(context, status.item.total)}"
                } else {
                    "Starting…"
                }
            GameStatus.Available -> game.roms.singleOrNull()?.let { Formatter.formatShortFileSize(context, it.size) } ?: "${game.roms.size} versions"
        }
        Text(
            line,
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
private fun SaveMarker(count: Int) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        Icon(
            painterResource(R.drawable.ic_save),
            contentDescription = if (count == 1) "1 save" else "$count saves",
            tint = Brand.b400,
            modifier = Modifier.size(18.dp),
        )
        if (count > 1) Text("$count", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, color = Stone.s100)
    }
}

@Composable
private fun StatusBadge(status: GameStatus, canDownload: Boolean, onDownload: () -> Unit) {
    val modifier = Modifier.size(32.dp).clip(CircleShape)
    when (status) {
        GameStatus.OnDevice -> Box(modifier.background(Stone.s950.copy(alpha = 0.8f)), contentAlignment = Alignment.Center) {
            Icon(painterResource(R.drawable.ic_check_circle), contentDescription = "On this device", tint = Brand.b400, modifier = Modifier.size(20.dp))
        }
        is GameStatus.Downloading, GameStatus.Queued -> Box(modifier.background(Stone.s950.copy(alpha = 0.8f)), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Brand.b400)
        }
        is GameStatus.Failed, GameStatus.Available -> if (canDownload) {
            Box(modifier.background(Brand.b600).clickable(onClick = onDownload), contentAlignment = Alignment.Center) {
                Icon(painterResource(R.drawable.ic_download), contentDescription = "Download", tint = Color.White, modifier = Modifier.size(18.dp))
            }
        }
    }
}
