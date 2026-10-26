package app.romsafe.android.sync

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.text.format.Formatter
import androidx.core.app.NotificationCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import app.romsafe.android.R
import app.romsafe.android.RomSafeApp
import app.romsafe.android.data.Folders
import app.romsafe.android.data.SafFileTree
import app.romsafe.shared.api.RomSafeApi
import app.romsafe.shared.sync.DownloadQueue
import app.romsafe.shared.sync.DownloadState
import app.romsafe.shared.sync.HashCache
import app.romsafe.shared.sync.QueueOutcome
import java.io.File

/** Live download state for the Library screen (same process as the worker). */
object Downloads : DownloadState() {
    /** Works through the server's download queue; a later call runs after the current one. */
    fun start(context: Context) {
        val request = OneTimeWorkRequestBuilder<DownloadWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork("romsafe-downloads", ExistingWorkPolicy.APPEND_OR_REPLACE, request)
    }
}

/**
 * Downloads every ROM in this device's server queue into the platform's ROM
 * folder, one at a time, as a foreground job with a progress notification
 * (disc images can take a while). Interrupted downloads resume next run.
 */
class DownloadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    private val notifications = context.getSystemService(NotificationManager::class.java)

    override suspend fun getForegroundInfo(): ForegroundInfo = foregroundInfo("Preparing downloads", 0, 0)

    override suspend fun doWork(): Result {
        val app = applicationContext as RomSafeApp
        val pairing = app.store.pairing() ?: return Result.success()
        // Android may refuse a foreground service when started from the background; download anyway.
        runCatching { setForeground(foregroundInfo("Preparing downloads", 0, 0)) }

        val outcome = RomSafeApi(pairing.serverUrl, pairing.token).use { api ->
            val granted = Folders.grantedUris(app)
            val cacheFile = File(app.filesDir, "hash-cache.json")
            val cache = HashCache({ cacheFile.takeIf { it.exists() }?.readText() }, { cacheFile.writeText(it) })
            val queue = DownloadQueue(api, Downloads, cache, System::currentTimeMillis) { uri ->
                uri.takeIf { it in granted }?.let { SafFileTree(app, Uri.parse(it)) }
            }
            var lastNotified = 0L
            queue.drain(app.store.setups(), isStopped = { isStopped }) { item ->
                val now = System.currentTimeMillis()
                if (now - lastNotified > 1_000) {
                    lastNotified = now
                    notifications.notify(NOTIFICATION_ID, notification(item.name, item.done, item.total))
                }
            }
        }
        return when (outcome) {
            QueueOutcome.Done -> Result.success()
            QueueOutcome.Retry -> Result.retry()
            QueueOutcome.Failed -> Result.failure()
        }
    }

    private fun foregroundInfo(name: String, done: Long, total: Long): ForegroundInfo {
        val n = notification(name, done, total)
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ForegroundInfo(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            ForegroundInfo(NOTIFICATION_ID, n)
        }
    }

    private fun notification(name: String, done: Long, total: Long): android.app.Notification {
        if (notifications.getNotificationChannel(CHANNEL) == null) {
            notifications.createNotificationChannel(NotificationChannel(CHANNEL, "ROM downloads", NotificationManager.IMPORTANCE_LOW))
        }
        val percent = if (total > 0) (done * 100 / total).toInt() else 0
        return NotificationCompat.Builder(applicationContext, CHANNEL)
            .setSmallIcon(R.drawable.ic_download)
            .setContentTitle(name)
            .setContentText(
                if (total > 0) {
                    "${Formatter.formatShortFileSize(applicationContext, done)} of ${Formatter.formatShortFileSize(applicationContext, total)}"
                } else {
                    "Downloading"
                },
            )
            .setProgress(100, percent, total <= 0)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()
    }

    private companion object {
        const val CHANNEL = "downloads"
        const val NOTIFICATION_ID = 42
    }
}
