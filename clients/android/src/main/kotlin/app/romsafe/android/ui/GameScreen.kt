package app.romsafe.android.ui

import android.text.format.Formatter
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.romsafe.android.R
import app.romsafe.android.sync.Downloads
import app.romsafe.android.ui.theme.Brand
import app.romsafe.android.ui.theme.Stone
import app.romsafe.android.ui.theme.Warning
import app.romsafe.shared.api.GameDetail
import app.romsafe.shared.api.GameExtra
import app.romsafe.shared.api.GameRom
import app.romsafe.shared.api.GameSave
import app.romsafe.shared.api.LibraryRom
import app.romsafe.shared.api.SaveVersion
import java.text.DateFormat
import java.util.Date

private val Danger = Color(0xFFFCA5A5)

/** A game's page, like the web GUI's: metadata, saves with their history, ROM files and extras. Read-only for now. */
@Composable
fun GameScreen(
    page: GamePage,
    /** The game's ROMs as the library lists them, with this device's live download state. */
    libraryRoms: List<LibraryRom>,
    platformName: String,
    canDownload: Boolean,
    downloads: Map<Long, Downloads.Item>,
    art: ArtSource,
    onBack: () -> Unit,
    onRetry: () -> Unit,
    onToggleHistory: (Long) -> Unit,
    onDownload: (LibraryRom) -> Unit,
    onCancel: (LibraryRom) -> Unit,
    onSetUpFolders: () -> Unit,
) {
    BackHandler(onBack = onBack)
    val g = page.detail
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.padding(start = 4.dp, top = 8.dp, end = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) {
                Icon(painterResource(R.drawable.ic_arrow_back), contentDescription = null, tint = Stone.s400, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("Library", color = Stone.s400)
            }
        }
        if (g == null) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                if (page.error != null) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(page.error, color = MaterialTheme.colorScheme.error)
                        TextButton(onClick = onRetry) { Text("Try again") }
                    }
                } else {
                    CircularProgressIndicator(color = Brand.b400)
                }
            }
            return
        }
        LazyColumn(
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 4.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            item { Header(g, platformName, art) }
            page.error?.let { item { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) } }

            item { SectionTitle("Saves", g.saves.size) }
            if (g.saves.isEmpty()) {
                item {
                    Text(
                        "No saves yet. They appear here once a device syncs or a file is found in the server save folder.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Stone.s500,
                    )
                }
            }
            items(g.saves, key = { "s${it.id}" }) { save ->
                SaveCard(save, expanded = save.id in page.expanded, versions = page.versions[save.id], onToggle = { onToggleHistory(save.id) })
            }

            item { SectionTitle("ROM files", g.roms.size) }
            if (!canDownload && g.roms.any { !it.missing }) {
                item {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "Choose a ROM folder for $platformName to download it here.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = Stone.s400,
                            modifier = Modifier.weight(1f, fill = false),
                        )
                        TextButton(onClick = onSetUpFolders) { Text("Set up") }
                    }
                }
            }
            item {
                Panel {
                    g.roms.forEachIndexed { i, rom ->
                        if (i > 0) HorizontalDivider(color = Stone.s800)
                        RomRow(rom, libraryRoms.find { it.id == rom.id }, downloads, canDownload, onDownload, onCancel)
                    }
                }
            }

            if (g.extras.isNotEmpty()) {
                item {
                    Column {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(painterResource(R.drawable.ic_extension), contentDescription = null, tint = Stone.s500, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            SectionTitle("Extras", g.extras.size, top = 0.dp)
                        }
                        Text(
                            "DLC, mods, hacks, patches and other files kept in this game's side folders.",
                            style = MaterialTheme.typography.bodySmall,
                            color = Stone.s500,
                        )
                    }
                }
                item {
                    Panel {
                        g.extras.forEachIndexed { i, x ->
                            if (i > 0) HorizontalDivider(color = Stone.s800)
                            ExtraRow(x)
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Header(g: GameDetail, platformName: String, art: ArtSource) {
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val wide = maxWidth >= 560.dp
        val cover = @Composable {
            Box(
                Modifier.width(if (wide) 200.dp else 150.dp).aspectRatio(3f / 4f).clip(RoundedCornerShape(10.dp)).background(Stone.s900),
            ) {
                if (g.cover != null) Cover(art, g.cover, g.title) else Text("No cover", color = Stone.s500, modifier = Modifier.align(Alignment.Center))
            }
        }
        val info = @Composable {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(g.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold, color = Stone.s50)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Badge(platformName)
                    g.releaseDate?.let { Badge(it) }
                    g.titleId?.let { Badge("Title ID $it", Tone.Sky) }
                    g.metadataSource?.let { Badge(it, Tone.Green) }
                }
                g.summary?.let {
                    Text(it, style = MaterialTheme.typography.bodyMedium, color = Stone.s300, modifier = Modifier.widthIn(max = 760.dp))
                }
            }
        }
        if (wide) {
            Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                cover()
                Box(Modifier.weight(1f)) { info() }
            }
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                cover()
                info()
            }
        }
    }
}

@Composable
private fun SectionTitle(text: String, count: Int, top: androidx.compose.ui.unit.Dp = 20.dp) {
    Row(Modifier.padding(top = top), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(text, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = Stone.s100)
        if (count > 0) Text("$count", style = MaterialTheme.typography.bodySmall, color = Stone.s600)
    }
}

@Composable
private fun Panel(content: @Composable () -> Unit) {
    Surface(shape = RoundedCornerShape(12.dp), color = Stone.s900, border = BorderStroke(1.dp, Stone.s800), modifier = Modifier.fillMaxWidth()) {
        Column { content() }
    }
}

private enum class Tone(val bg: Color, val fg: Color) {
    Stone_(Stone.s800, Stone.s300),
    Sky(Color(0xFF0C4A6E).copy(alpha = 0.6f), Color(0xFF7DD3FC)),
    Green(Color(0xFF14532D).copy(alpha = 0.6f), Color(0xFF86EFAC)),
    Red(Color(0xFF7F1D1D).copy(alpha = 0.6f), Danger),
    Brand_(Brand.b900, Brand.b300),
}

@Composable
private fun Badge(text: String, tone: Tone = Tone.Stone_) {
    Text(
        text,
        style = MaterialTheme.typography.labelSmall,
        color = tone.fg,
        modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(tone.bg).padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

private fun formatTime(ms: Long?): String =
    ms?.let { DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(it)) } ?: "never"

@Composable
private fun size(bytes: Long?): String = bytes?.let { Formatter.formatShortFileSize(LocalContext.current, it) } ?: "—"

@Composable
private fun SaveCard(save: GameSave, expanded: Boolean, versions: List<SaveVersion>?, onToggle: () -> Unit) {
    Surface(shape = RoundedCornerShape(12.dp), color = Stone.s900, border = BorderStroke(1.dp, Stone.s800), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(save.downloadName, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodyMedium, color = Stone.s200)
                        if (save.empty) Badge("empty", Tone.Red)
                    }
                    val by = save.updatedBy?.let { " by $it" }.orEmpty()
                    val versionsText = if (save.versionCount == 1) "1 version" else "${save.versionCount} versions"
                    Text(
                        "${size(save.size)} · updated ${formatTime(save.updatedAt)}$by · $versionsText",
                        style = MaterialTheme.typography.bodySmall,
                        color = Stone.s500,
                    )
                    if (save.file != save.downloadName) {
                        Text("Stored on the server as ${save.file}", style = MaterialTheme.typography.bodySmall, color = Stone.s600)
                    }
                    save.serverPath?.let { ServerPath(it) }
                }
                TextButton(onClick = onToggle) {
                    Icon(painterResource(R.drawable.ic_history), contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(if (expanded) "Hide history" else "History")
                }
            }
            if (expanded) {
                Spacer(Modifier.size(8.dp))
                if (versions == null) {
                    LinearProgressIndicator(Modifier.fillMaxWidth(), color = Brand.b400)
                } else {
                    versions.forEach { v ->
                        HorizontalDivider(color = Stone.s800)
                        VersionRow(v)
                    }
                }
            }
        }
    }
}

@Composable
private fun VersionRow(v: SaveVersion) {
    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Text(formatTime(v.createdAt), style = MaterialTheme.typography.bodyMedium, color = Stone.s200, modifier = Modifier.width(170.dp))
        Text(v.device ?: "server", style = MaterialTheme.typography.bodyMedium, color = Stone.s300, modifier = Modifier.width(120.dp))
        Text(size(v.size), style = MaterialTheme.typography.bodyMedium, color = Stone.s300, modifier = Modifier.width(80.dp))
        Text(v.sha256.take(12), fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall, color = Stone.s500)
        Text(v.note.orEmpty(), style = MaterialTheme.typography.bodySmall, color = Stone.s400, modifier = Modifier.weight(1f))
        if (v.isCurrent) Badge("current", Tone.Green)
    }
}

@Composable
private fun ServerPath(path: String) {
    Text(path, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.labelSmall, color = Stone.s600)
}

@Composable
private fun RomRow(
    rom: GameRom,
    live: LibraryRom?,
    downloads: Map<Long, Downloads.Item>,
    canDownload: Boolean,
    onDownload: (LibraryRom) -> Unit,
    onCancel: (LibraryRom) -> Unit,
) {
    val item = downloads[rom.id]
    val localPath = live?.localPath ?: rom.localPath
    Row(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.Top) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(rom.relPath, style = MaterialTheme.typography.bodyMedium, color = Stone.s200, modifier = Modifier.weight(1f, fill = false))
                if (rom.missing) Badge("missing", Tone.Red)
            }
            Text(
                listOfNotNull(
                    size(rom.totalSize),
                    rom.crc32?.let { "CRC32 $it" },
                    rom.titleId?.let { "Title ID $it" },
                ).joinToString(" · "),
                style = MaterialTheme.typography.bodySmall,
                color = Stone.s500,
            )
            rom.serverPath?.let { ServerPath(it) }
            if (rom.parts.isNotEmpty()) RomParts(rom)
            localPath?.let { Text("On this device as $it", style = MaterialTheme.typography.bodySmall, color = Brand.b400) }
            item?.error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Warning) }
            if (item != null && item.error == null && item.total > 0) {
                LinearProgressIndicator(
                    progress = { (item.done.toFloat() / item.total).coerceIn(0f, 1f) },
                    modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                    color = Brand.b400,
                )
            }
        }
        Spacer(Modifier.width(12.dp))
        when {
            localPath != null -> Icon(painterResource(R.drawable.ic_check_circle), contentDescription = "On this device", tint = Brand.b400)
            live == null || rom.missing -> Unit
            live.queued || (item != null && item.error == null) -> IconButton(onClick = { onCancel(live) }) {
                Icon(Icons.Filled.Close, contentDescription = "Cancel download", tint = Stone.s400)
            }
            canDownload -> TextButton(onClick = { onDownload(live) }) {
                Icon(painterResource(R.drawable.ic_download), contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("Download")
            }
        }
    }
}

/** Files that travel with a ROM (tracks, discs, .ccd/.sub). Long lists start folded. */
@Composable
private fun RomParts(rom: GameRom) {
    var open by remember(rom.id) { mutableStateOf(rom.parts.size <= 3) }
    val n = rom.parts.size
    Text(
        "$n file${if (n == 1) "" else "s"} included; downloads as one zip" + if (n > 3) (if (open) "  ▴" else "  ▾") else "",
        style = MaterialTheme.typography.bodySmall,
        color = Stone.s500,
        modifier = if (n > 3) Modifier.clickable { open = !open } else Modifier,
    )
    if (open) {
        Column(Modifier.padding(start = 10.dp, top = 2.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            rom.parts.forEach { p ->
                Row {
                    Text(p.path.substringAfterLast('/'), style = MaterialTheme.typography.bodySmall, color = Stone.s400, modifier = Modifier.weight(1f))
                    Text(size(p.size), style = MaterialTheme.typography.bodySmall, color = Stone.s600)
                }
            }
        }
    }
}

@Composable
private fun ExtraRow(x: GameExtra) {
    Row(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Badge(x.kind, Tone.Brand_)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(x.relPath, style = MaterialTheme.typography.bodyMedium, color = Stone.s200, modifier = Modifier.weight(1f, fill = false))
                if (x.missing) Badge("missing", Tone.Red)
            }
            x.serverPath?.let { ServerPath(it) }
        }
        Text(size(x.size), style = MaterialTheme.typography.bodySmall, color = Stone.s500)
    }
}
