package com.pearl.crm.core.sync

import com.pearl.crm.core.data.db.OutboxDao
import com.pearl.crm.core.data.db.OutboxItem
import com.pearl.crm.core.data.db.OutboxKind
import com.pearl.crm.core.data.net.PearlJson
import com.pearl.crm.core.model.ErrorCodes
import com.pearl.crm.core.model.RpcFailure
import com.pearl.crm.core.model.RpcTransport
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.jsonObject
import kotlin.random.Random

/**
 * Sends queued writes, oldest first, keeping each entity's writes in order.
 * - Sent → deleted from the queue.
 * - Network / server busy → stays queued, retried with a growing wait (30 s … 1 h).
 * - Refused with a stable code → marked failed and shown to the person (crash reports are
 *   dropped instead). Later writes for the same entity wait behind it; other entities go on.
 * - Login ended → stops; nothing is lost.
 * Only one send runs at a time in the app process.
 */
class OutboxProcessor(
    private val dao: OutboxDao,
    private val transport: RpcTransport,
    private val clock: () -> Long = System::currentTimeMillis,
    private val random: Random = Random.Default,
) {
    data class Outcome(
        val sent: Int,
        val failed: Int,
        /** Still queued (waiting for a retry or behind an earlier write). */
        val waiting: Int,
        val signedOut: Boolean,
        /** When the next retry is due (epoch ms), if anything is waiting. */
        val nextAttemptAt: Long?,
    )

    suspend fun run(): Outcome = LOCK.withLock {
        var sent = 0
        var failed = 0
        while (true) {
            val batch = dao.dueHeads(clock(), BATCH)
            if (batch.isEmpty()) break
            for (item in batch) {
                when (send(item)) {
                    Result.Sent -> sent++
                    Result.Failed -> failed++
                    Result.Retry -> Unit
                    Result.SignedOut -> return@withLock outcome(sent, failed, signedOut = true)
                }
            }
        }
        outcome(sent, failed, signedOut = false)
    }

    private enum class Result { Sent, Failed, Retry, SignedOut }

    private suspend fun send(item: OutboxItem): Result {
        val args = try {
            PearlJson.parseToJsonElement(item.args).jsonObject
        } catch (_: SerializationException) {
            return refuse(item, ErrorCodes.UNKNOWN)
        } catch (_: IllegalArgumentException) {
            return refuse(item, ErrorCodes.UNKNOWN)
        }
        return try {
            transport.call(item.rpc, args)
            dao.delete(item.id)
            Result.Sent
        } catch (e: CancellationException) {
            throw e
        } catch (e: RpcFailure.Transient) {
            retry(item, e.message ?: "transient")
        } catch (e: RpcFailure.Permanent) {
            refuse(item, e.code)
        } catch (_: RpcFailure.SignedOut) {
            Result.SignedOut
        } catch (e: Exception) {
            // A bug, not the server's answer: keep the write and try again later.
            retry(item, e.javaClass.simpleName)
        }
    }

    private suspend fun retry(item: OutboxItem, error: String): Result {
        val delay = backoffMs(item.attempts + 1)
        dao.markRetry(item.id, clock() + delay + random.nextLong(delay / 5 + 1), error.take(200))
        return Result.Retry
    }

    private suspend fun refuse(item: OutboxItem, code: String): Result {
        if (item.kind == OutboxKind.Telemetry.wire) {
            dao.delete(item.id)
            return Result.Retry
        }
        dao.markFailed(item.id, code)
        return Result.Failed
    }

    private suspend fun outcome(sent: Int, failed: Int, signedOut: Boolean) =
        Outcome(sent, failed, dao.pendingCount(), signedOut, dao.earliestPending())

    companion object {
        private const val BATCH = 50
        private val LOCK = Mutex()

        /** 30 s, 1 min, 2 min, … capped at 1 hour. */
        fun backoffMs(attempt: Int): Long = minOf(30_000L shl (attempt - 1).coerceIn(0, 7), 3_600_000L)
    }
}
