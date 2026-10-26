package app.romsafe.desktop.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.romsafe.shared.sync.SyncReport
import app.romsafe.shared.sync.SyncStatus
import kotlinx.coroutines.delay

/** "Sync now" and what the last sync did. */
@Composable
fun SyncCard(status: SyncStatus, watchedFolders: Int, anythingSetUp: Boolean, onSyncNow: () -> Unit) {
    // Re-render "3 minutes ago" as time passes.
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(30_000)
            now = System.currentTimeMillis()
        }
    }
    val last = status.last

    Card(
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = Stone.s900),
        border = BorderStroke(1.dp, Stone.s800),
    ) {
        Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Save sync", style = MaterialTheme.typography.titleMedium, color = Stone.s100)
                    Text(
                        syncLine(status, anythingSetUp, now),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Spacer(Modifier.width(12.dp))
                Button(onClick = onSyncNow, enabled = !status.running && anythingSetUp) {
                    if (status.running) {
                        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                    } else {
                        Text("Sync now")
                    }
                }
            }
            if (last != null && !status.running) LastRun(last)
            Text(
                if (watchedFolders > 0) {
                    "Syncs a few seconds after an emulator saves (watching $watchedFolders folder${if (watchedFolders == 1) "" else "s"}), " +
                        "every 15 minutes, and when RomSafe starts. Closing the window keeps it running in the tray."
                } else {
                    "Syncs every 15 minutes and when RomSafe starts. Closing the window keeps it running in the tray."
                },
                style = MaterialTheme.typography.bodySmall,
                color = Stone.s500,
            )
        }
    }
}

/** The one-line status, also used for the tray tooltip. */
fun syncLine(status: SyncStatus, anythingSetUp: Boolean, now: Long = System.currentTimeMillis()): String {
    val last = status.last
    return when {
        status.running -> status.step ?: "Syncing…"
        last == null -> if (anythingSetUp) "Not synced yet" else "Set up a platform below to start syncing"
        last.error != null -> "Last sync failed " + ago(last.finishedAt, now)
        else -> "Last synced " + ago(last.finishedAt, now)
    }
}

fun ago(time: Long, now: Long): String {
    val minutes = (now - time) / 60_000
    return when {
        minutes < 1 -> "just now"
        minutes == 1L -> "1 minute ago"
        minutes < 60 -> "$minutes minutes ago"
        minutes < 120 -> "1 hour ago"
        minutes < 24 * 60 -> "${minutes / 60} hours ago"
        else -> "${minutes / (24 * 60)} days ago"
    }
}

@Composable
private fun LastRun(report: SyncReport) {
    if (report.error != null) {
        Text("Sync failed: ${report.error}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
        return
    }
    val parts = buildList {
        if (report.uploaded > 0) add("${report.uploaded} uploaded")
        if (report.downloaded > 0) add("${report.downloaded} downloaded")
        if (isEmpty()) add("Everything was already in sync")
    }
    Text(parts.joinToString(" · "), style = MaterialTheme.typography.bodyMedium, color = Brand.b400, fontWeight = FontWeight.Medium)
    for (p in report.platforms) {
        if (p.uploaded + p.downloaded == 0 && p.conflicts.isEmpty()) continue
        val detail = buildList {
            if (p.uploaded > 0) add("↑ ${p.uploaded}")
            if (p.downloaded > 0) add("↓ ${p.downloaded}")
        }.joinToString("  ")
        Text("${p.name}  $detail", style = MaterialTheme.typography.bodySmall, color = Stone.s300)
    }
    if (report.conflicts > 0) {
        val names = report.platforms.flatMap { it.conflicts }.map { it.substringAfterLast('/') }.distinct()
        Text(
            "${report.conflicts} conflict${if (report.conflicts == 1) "" else "s"} (${names.joinToString()}). " +
                "Both copies are on the server; pick one on the web app's Conflicts page.",
            style = MaterialTheme.typography.bodySmall,
            color = Warning,
        )
    }
    report.issues.take(4).forEach {
        Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
    if (report.issues.size > 4) {
        Text("…and ${report.issues.size - 4} more problems", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
    }
}
