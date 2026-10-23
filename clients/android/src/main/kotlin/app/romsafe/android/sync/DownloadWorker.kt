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
import app.romsafe.shared.sync.HashCache
import app.romsafe.shared.sync.RomDownloader
import app.romsafe.shared.sync.SyncEngine
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import java.io.File
import java.io.IOException

/** Live download state for the Library screen (same process as the worker). */
object Downloads {
    data class Item(val romId: Long, val name: String, val done: Long = 0, val total: Long = 0, val error: String? = null)

    private val _items = MutableStateFlow<Map<Long, Item>>(emptyMap())
    val items: StateFlow<Map<Long, Item>> = _items

    /** Bumped after each finished download, so the library reloads. */
    private val _finished = MutableStateFlow(0)
    val finished: StateFlow<Int> = _finished

    internal fun update(item: Item) = _items.update { it + (item.romId to item) }

    internal fun done(romId: Long) {
        _items.update { it - romId }
        _finished.update { it + 1 }
    }

    fun clearError(romId: Long) = _items.update { m -> if (m[romId]?.error != null) m - romId else m }

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

        RomSafeApi(pairing.serverUrl, pairing.token).use { api ->
            val config = try {
                api.config()
            } catch (e: IOException) {
                return Result.retry()
            }
            val setups = app.store.setups()
            val granted = Folders.grantedUris(app)
            val platforms = config.platforms.associateBy { it.slug }
            val cacheFile = File(app.filesDir, "hash-cache.json")
            val cache = HashCache({ cacheFile.takeIf { it.exists() }?.readText() }, { cacheFile.writeText(it) })
            val skipped = mutableSetOf<Long>()

            while (!isStopped) {
                val rom = try {
                    api.queue().firstOrNull { it.id !in skipped }
                } catch (e: IOException) {
                    return Result.retry()
                } ?: break
                val platform = platforms[rom.platform]
                val romUri = setups[rom.platform]?.romUri?.takeIf { it in granted }
                if (platform == null || romUri == null) {
                    val name = platform?.name ?: rom.platform
                    Downloads.update(Downloads.Item(rom.id, rom.fileName, error = "Choose a ROM folder for $name first"))
                    skipped += rom.id
                    continue
                }
                Downloads.update(Downloads.Item(rom.id, rom.fileName))
                var lastNotified = 0L
                try {
                    RomDownloader(api).download(rom, SafFileTree(app, Uri.parse(romUri))) { done, total ->
                        Downloads.update(Downloads.Item(rom.id, rom.fileName, done, total))
                        val now = System.currentTimeMillis()
                        if (now - lastNotified > 1_000) {
                            lastNotified = now
                            notifications.notify(NOTIFICATION_ID, notification(rom.fileName, done, total))
                        }
                    }
                    // Report the new ROM so the server matches it (and saves follow), then make sure it's off the queue.
                    runCatching { SyncEngine(api, cache, System::currentTimeMillis).reportRoms(platform, SafFileTree(app, Uri.parse(romUri)), romUri) }
                    runCatching { api.dequeue(rom.id) }
                    Downloads.done(rom.id)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: IOException) {
                    // Network trouble: try again later; the part file lets it resume.
                    Downloads.update(Downloads.Item(rom.id, rom.fileName, error = "Interrupted; will resume"))
                    return Result.retry()
                } catch (e: Exception) {
                    Downloads.update(Downloads.Item(rom.id, rom.fileName, error = e.message ?: e.javaClass.simpleName))
                    skipped += rom.id
                }
            }
        }
        return Result.success()
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
