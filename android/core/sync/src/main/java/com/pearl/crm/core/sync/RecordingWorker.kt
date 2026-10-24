package com.pearl.crm.core.sync

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/** Implemented by the Application: import the call log, find recordings, upload what's queued. */
interface RecordingsHost {
    /** Returns true when an upload still waits (no connection, or a retry is due). */
    suspend fun runRecordings(): Boolean
}

class RecordingWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val host = applicationContext as? RecordingsHost ?: return Result.failure()
        return if (host.runRecordings() && runAttemptCount < MAX_RETRIES) Result.retry() else Result.success()
    }

    companion object {
        private const val UNIQUE = "recordings"
        private const val MAX_RETRIES = 8

        /** After a call (give the dialer time to finish writing the file) and after each sync. */
        fun schedule(context: Context, delayMs: Long = 0) {
            val request = OneTimeWorkRequestBuilder<RecordingWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setInitialDelay(delayMs, TimeUnit.MILLISECONDS)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES)
                .build()
            WorkManager.getInstance(context.applicationContext)
                .enqueueUniqueWork(UNIQUE, if (delayMs > 0) ExistingWorkPolicy.REPLACE else ExistingWorkPolicy.KEEP, request)
        }

        fun cancel(context: Context) = WorkManager.getInstance(context.applicationContext).cancelUniqueWork(UNIQUE)
    }
}
