package com.pearl.crm.core.sync

import com.pearl.crm.core.model.RpcFailure
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** What the last sync did, for the status line on screen. */
data class SyncStatus(
    val running: Boolean = false,
    /** Epoch ms of the last sync that reached the server. */
    val lastSuccessAt: Long? = null,
    /** True when the last try couldn't reach the server. */
    val offline: Boolean = false,
    /** Stable error code when the server refused the pull (shown, not retried in a loop). */
    val errorCode: String? = null,
)

enum class SyncResult {
    Done,

    /** Something is still waiting (offline, or a retry is due later). */
    RetryLater,

    /** The login ended; the app shows the login screen. */
    SignedOut,
}

/** One sync = send the outbox first (so the pull sees our own changes), then pull. */
class SyncRunner(
    private val outbox: OutboxProcessor,
    private val pull: PullEngine,
    private val isSignedIn: () -> Boolean,
    private val clock: () -> Long = System::currentTimeMillis,
    /** After a complete pull: tidy rows made on the phone that the server took but didn't send back. */
    private val afterPull: suspend () -> Unit = {},
) {
    private val _status = MutableStateFlow(SyncStatus())
    val status: StateFlow<SyncStatus> = _status.asStateFlow()

    /** When the next outbox retry is due, after the last run (epoch ms). */
    @Volatile
    var nextRetryAt: Long? = null
        private set

    /** One sync at a time: a "Sync now" tap waits for a background sync already running. */
    suspend fun runOnce(): SyncResult = mutex.withLock { runLocked() }

    private val mutex = Mutex()

    private suspend fun runLocked(): SyncResult {
        if (!isSignedIn()) return SyncResult.Done
        _status.value = _status.value.copy(running = true)
        try {
            val sent = outbox.run()
            nextRetryAt = sent.nextAttemptAt
            if (sent.signedOut) return SyncResult.SignedOut
            try {
                pull.pull()
            } catch (_: RpcFailure.Transient) {
                _status.value = _status.value.copy(offline = true)
                return SyncResult.RetryLater
            } catch (_: RpcFailure.SignedOut) {
                return SyncResult.SignedOut
            } catch (e: RpcFailure.Permanent) {
                _status.value = _status.value.copy(offline = false, errorCode = e.code)
                return if (sent.waiting > 0) SyncResult.RetryLater else SyncResult.Done
            }
            afterPull()
            _status.value = _status.value.copy(offline = false, errorCode = null, lastSuccessAt = clock())
            return if (sent.waiting > 0) SyncResult.RetryLater else SyncResult.Done
        } finally {
            _status.value = _status.value.copy(running = false)
        }
    }
}
