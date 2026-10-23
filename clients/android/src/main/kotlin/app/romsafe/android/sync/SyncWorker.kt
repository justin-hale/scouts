package app.romsafe.android.sync

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import app.romsafe.android.RomSafeApp
import java.util.concurrent.TimeUnit

/** The periodic background sync. */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val report = SyncRunner.run(applicationContext as RomSafeApp) ?: return Result.success()
        // A failed run (server down, off the home network) just waits for the next period.
        return if (report.error != null && runAttemptCount < 2) Result.retry() else Result.success()
    }

    companion object {
        private const val NAME = "romsafe-sync"

        /** Every 15 minutes (Android's minimum) while there's a network. */
        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, request)
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(NAME)
        }
    }
}
