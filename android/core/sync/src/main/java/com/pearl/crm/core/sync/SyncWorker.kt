package com.pearl.crm.core.sync

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/** Implemented by the Application so the worker can reach the app's [SyncRunner]. */
interface SyncHost {
    val syncRunner: SyncRunner

    /** Called when a sync finds the login has ended. */
    fun onSyncSignedOut()
}

/** Runs one sync. Always "succeeds"; a retry is scheduled separately so a new write never waits behind a long backoff. */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val host = applicationContext as? SyncHost ?: return Result.failure()
        when (host.syncRunner.runOnce()) {
            SyncResult.Done -> Unit
            SyncResult.RetryLater -> SyncScheduler(applicationContext).retryAt(host.syncRunner.nextRetryAt)
            SyncResult.SignedOut -> host.onSyncSignedOut()
        }
        return Result.success()
    }
}

/**
 * - [syncSoon]: after every local write (queued behind a running sync, never replacing it).
 * - [retryAt]: when something is still waiting (replaces the previous retry).
 * - [startPeriodic]: every 15 minutes while signed in, to pull other people's changes.
 * All need a network connection.
 */
class SyncScheduler(context: Context) {
    private val work = WorkManager.getInstance(context.applicationContext)
    private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    fun syncSoon() {
        val request = OneTimeWorkRequestBuilder<SyncWorker>().setConstraints(online).build()
        work.enqueueUniqueWork(NOW, ExistingWorkPolicy.APPEND_OR_REPLACE, request)
    }

    fun retryAt(epochMs: Long?, now: Long = System.currentTimeMillis()) {
        val delay = ((epochMs ?: now) - now).coerceIn(MIN_RETRY_MS, MAX_RETRY_MS)
        val request = OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(online)
            .setInitialDelay(delay, TimeUnit.MILLISECONDS)
            .build()
        work.enqueueUniqueWork(RETRY, ExistingWorkPolicy.REPLACE, request)
    }

    fun startPeriodic() {
        val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES).setConstraints(online).build()
        work.enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    fun stopAll() {
        listOf(NOW, RETRY, PERIODIC).forEach(work::cancelUniqueWork)
    }

    private companion object {
        const val NOW = "sync-now"
        const val RETRY = "sync-retry"
        const val PERIODIC = "sync-periodic"
        const val MIN_RETRY_MS = 30_000L
        const val MAX_RETRY_MS = 3_600_000L
    }
}
