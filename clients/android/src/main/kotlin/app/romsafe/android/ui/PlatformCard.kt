package app.romsafe.android.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.romsafe.android.R
import app.romsafe.shared.setup.EmulatorSetup
import app.romsafe.android.ui.theme.Brand
import app.romsafe.android.ui.theme.Stone
import app.romsafe.android.ui.theme.Warning
import app.romsafe.shared.api.PlatformInfo
import app.romsafe.shared.api.Profile
import app.romsafe.shared.api.SaveLayout

private const val INTERNAL = "Internal storage/"

@Composable
fun PlatformCard(
    platform: PlatformInfo,
    state: AppState,
    profiles: Map<String, Profile>,
    expanded: Boolean,
    onToggle: () -> Unit,
    onProfile: (slot: String, profile: String) -> Unit,
    onPick: (FolderKind, slot: String, hint: String?) -> Unit,
    onClear: (FolderKind, slot: String) -> Unit,
    onAddEmulator: () -> Unit,
    onRemoveEmulator: (slot: String) -> Unit,
) {
    val setup = state.setups[platform.slug]
    val emulators = state.emulators(platform)
    val problems = emulators.mapNotNull { e ->
        when {
            e.saveUri != null && e.saveUri !in state.granted -> "Folder access lost. Choose the folder again."
            else -> state.layoutProblems["${platform.slug}/${e.slot}"]
        }
    }
    val chosen = emulators.filter { it.saveUri != null }
    val arrow by animateFloatAsState(if (expanded) 180f else 0f, label = "arrow")

    Card(
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = Stone.s900),
        border = BorderStroke(1.dp, if (expanded) Stone.s700 else Stone.s800),
    ) {
        Row(
            Modifier.fillMaxWidth().clickable(onClick = onToggle).padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(platform.name, style = MaterialTheme.typography.titleMedium, color = Stone.s100)
                val summary = when {
                    platform.profiles.isEmpty() -> "No emulator profile yet"
                    problems.isNotEmpty() -> problems.first()
                    chosen.size == 1 -> {
                        val e = chosen.single()
                        "${profiles[e.profile]?.name ?: e.profile} · ${shortLabel(state.folderLabels[e.saveUri])}"
                    }
                    chosen.size > 1 -> "${chosen.size} emulators · " + chosen.joinToString(" + ") { shortLabel(state.folderLabels[it.saveUri]) }
                    else -> "Not set up"
                }
                Text(
                    summary,
                    style = MaterialTheme.typography.bodySmall,
                    color = if (problems.isNotEmpty()) Warning else MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            when {
                problems.isNotEmpty() -> Icon(Icons.Filled.Warning, contentDescription = "Needs attention", tint = Warning, modifier = Modifier.size(20.dp))
                state.isSetUp(platform) -> Icon(painterResource(R.drawable.ic_check_circle), contentDescription = "Set up", tint = Brand.b500, modifier = Modifier.size(20.dp))
            }
            Spacer(Modifier.width(8.dp))
            Icon(Icons.Filled.KeyboardArrowDown, contentDescription = null, tint = Stone.s500, modifier = Modifier.rotate(arrow))
        }

        AnimatedVisibility(expanded) {
            Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                if (platform.profiles.isEmpty()) {
                    Text(
                        "No emulator profile supports this platform yet, so its saves can't sync from this device.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    return@Column
                }
                emulators.forEachIndexed { i, e ->
                    if (i > 0) HorizontalDivider(color = Stone.s800)
                    EmulatorSection(
                        platform = platform,
                        emulator = e,
                        title = if (emulators.size > 1) "Emulator ${i + 1}" else "Emulator",
                        state = state,
                        profiles = profiles,
                        usedLabels = emulators.filter { it != e }.mapNotNull { state.folderLabels[it.saveUri] }.toSet(),
                        removable = emulators.size > 1,
                        onProfile = { onProfile(e.slot, it) },
                        onPick = { hint -> onPick(FolderKind.Save, e.slot, hint) },
                        onClear = { onClear(FolderKind.Save, e.slot) },
                        onRemove = { onRemoveEmulator(e.slot) },
                    )
                }
                if (chosen.isNotEmpty()) {
                    TextButton(onClick = onAddEmulator, modifier = Modifier.padding(start = 0.dp)) {
                        Icon(Icons.Filled.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Add another emulator")
                    }
                }
                HorizontalDivider(color = Stone.s800)
                SectionLabel("ROMs")
                FolderRow(
                    icon = R.drawable.ic_gamepad,
                    title = "ROM folder",
                    value = setup?.romUri?.let { state.folderLabels[it] ?: "Folder chosen" },
                    hint = "Optional. Used to match ROMs and for downloads from the library.",
                    warning = setup?.romUri?.takeIf { it !in state.granted }?.let { "Access lost. Tap to choose it again." },
                    onPick = { onPick(FolderKind.Rom, "", null) },
                    onClear = { onClear(FolderKind.Rom, "") },
                )
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun EmulatorSection(
    platform: PlatformInfo,
    emulator: EmulatorSetup,
    title: String,
    state: AppState,
    profiles: Map<String, Profile>,
    usedLabels: Set<String>,
    removable: Boolean,
    onProfile: (String) -> Unit,
    onPick: (hint: String?) -> Unit,
    onClear: () -> Unit,
    onRemove: () -> Unit,
) {
    val profile = profiles[emulator.profile]
    val defaults = profile?.defaultPaths?.android.orEmpty()
    // Open the picker at a usual location no other emulator here already uses
    // (Citra MMJ's citra-emu/sdmc after Azahar's azahar-emu/sdmc).
    val hint = defaults.firstOrNull { "$INTERNAL$it" !in usedLabels } ?: defaults.firstOrNull()
    val saveUri = emulator.saveUri
    val warning = when {
        saveUri != null && saveUri !in state.granted -> "Access lost. Tap to choose it again."
        else -> state.layoutProblems["${platform.slug}/${emulator.slot}"]
    }

    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            SectionLabel(title, Modifier.weight(1f))
            if (removable) {
                TextButton(onClick = onRemove) { Text("Remove", color = Stone.s400) }
            }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            platform.profiles.forEach { id ->
                FilterChip(
                    selected = id == emulator.profile,
                    onClick = { onProfile(id) },
                    label = { Text(profiles[id]?.name ?: id) },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = Brand.b900,
                        selectedLabelColor = Brand.b100,
                    ),
                )
            }
        }
        profile?.description?.let {
            Text(it.trim(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (profile != null) LayoutExample(profile, platform, defaults)
        FolderRow(
            icon = R.drawable.ic_save,
            title = "Save folder",
            value = saveUri?.let { state.folderLabels[it] ?: "Folder chosen" },
            hint = defaults.takeIf { it.isNotEmpty() }?.let { "Usually " + it.joinToString(" or ") },
            warning = warning,
            onPick = { onPick(hint) },
            onClear = onClear,
        )
    }
}

/** A small tree of what the save folder should contain, built from the profile's rules. */
@Composable
private fun LayoutExample(profile: Profile, platform: PlatformInfo, defaults: List<String>) {
    val examples = SaveLayout.examples(profile, platform)
    if (examples.isEmpty()) return
    val mono = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace, fontSize = 12.sp, lineHeight = 18.sp)
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(Stone.s950).padding(horizontal = 12.dp, vertical = 10.dp),
    ) {
        Text("Pick the folder that looks like this:", style = MaterialTheme.typography.labelMedium, color = Stone.s400)
        Spacer(Modifier.size(6.dp))
        Text("${defaults.firstOrNull() ?: "Your folder"}/", style = mono, color = Brand.b400)
        examples.forEachIndexed { i, path ->
            val branch = if (i == examples.lastIndex) "└─ " else "├─ "
            Text(branch + path, style = mono, color = Stone.s300)
        }
    }
}

@Composable
private fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(text.uppercase(), style = MaterialTheme.typography.labelSmall, color = Stone.s500, fontWeight = FontWeight.SemiBold, modifier = modifier)
}

@Composable
private fun FolderRow(
    icon: Int,
    title: String,
    value: String?,
    hint: String?,
    warning: String?,
    onPick: () -> Unit,
    onClear: () -> Unit,
) {
    Surface(
        onClick = onPick,
        shape = RoundedCornerShape(10.dp),
        color = Stone.s950,
        border = BorderStroke(1.dp, if (warning != null) Warning.copy(alpha = 0.6f) else Stone.s800),
    ) {
        Row(Modifier.fillMaxWidth().padding(start = 12.dp, top = 10.dp, bottom = 10.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(36.dp).clip(RoundedCornerShape(8.dp)).background(if (value != null) Brand.b950 else Stone.s800),
                contentAlignment = Alignment.Center,
            ) {
                Icon(painterResource(icon), contentDescription = null, tint = if (value != null) Brand.b400 else Stone.s400, modifier = Modifier.size(20.dp))
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.labelLarge, color = Stone.s200)
                Text(
                    value ?: "Tap to choose a folder",
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (value != null) Stone.s300 else Stone.s500,
                )
                when {
                    warning != null -> Text(warning, style = MaterialTheme.typography.bodySmall, color = Warning)
                    value == null && hint != null -> Text(hint, style = MaterialTheme.typography.bodySmall, color = Stone.s500)
                }
            }
            if (value != null) {
                IconButton(onClick = onClear) {
                    Icon(Icons.Filled.Close, contentDescription = "Clear $title", tint = Stone.s500)
                }
            } else {
                TextButton(onClick = onPick) { Text("Choose") }
            }
        }
    }
}

private fun shortLabel(label: String?): String = label?.removePrefix(INTERNAL) ?: "Folder chosen"
