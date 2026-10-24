package com.pearl.crm.core.sync

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pearl.crm.core.data.OutboxWriter
import com.pearl.crm.core.data.db.AppDatabase
import com.pearl.crm.core.data.db.OutboxDao
import com.pearl.crm.core.data.db.OutboxItem
import com.pearl.crm.core.data.db.OutboxKind
import com.pearl.crm.core.model.RpcFailure
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.random.Random

@RunWith(AndroidJUnit4::class)
class OutboxProcessorTest {
    private lateinit var db: AppDatabase
    private lateinit var dao: OutboxDao
    private lateinit var writer: OutboxWriter
    private val server = FakeTransport()
    private var now = 1_000_000L

    @Before
    fun open() {
        db = inMemoryDb()
        dao = db.outbox()
        writer = OutboxWriter(dao) { now }
    }

    @After
    fun close() = db.close()

    private fun processor() = OutboxProcessor(dao, server, clock = { now }, random = Random(7))

    private suspend fun queue(id: String, entity: String, rpc: String = "lead_note_add", kind: OutboxKind = OutboxKind.User) =
        writer.enqueue(rpc, buildJsonObject { put("p_client_id", id) }, entity, clientId = id, kind = kind)

    private fun sentIds() = synchronized(server.calls) { server.calls.map { it.second.getValue("p_client_id").jsonPrimitive.content } }

    @Test
    fun sentWritesAreDeletedInQueueOrder() = runTest {
        queue("a1", "lead:A")
        queue("b1", "lead:B")
        queue("a2", "lead:A")

        val outcome = processor().run()

        assertEquals(listOf("a1", "b1", "a2"), sentIds())
        assertEquals(OutboxProcessor.Outcome(sent = 3, failed = 0, waiting = 0, signedOut = false, nextAttemptAt = null), outcome)
        assertEquals(0, dao.pendingCount())
    }

    @Test
    fun noConnectionKeepsTheWriteAndRetriesWithAGrowingWait() = runTest {
        server.handler = { _, _ -> throw RpcFailure.Transient("offline") }
        queue("a1", "lead:A")
        queue("a2", "lead:A")

        val first = processor().run()
        assertEquals(listOf("a1"), sentIds()) // a2 waits behind a1
        assertEquals(0, first.sent)
        assertEquals(2, first.waiting)
        assertFalse(first.signedOut)
        val row = dao.get("a1")!!
        assertEquals(1, row.attempts)
        assertEquals("offline", row.lastError)
        assertEquals("pending", row.state)
        assertInRange(now + 30_000, now + 36_000, row.nextAttemptAt)
        assertTrue(first.nextAttemptAt != null)

        // Not due yet: nothing is sent.
        processor().run()
        assertEquals(1, server.calls.size)

        now = row.nextAttemptAt
        processor().run()
        assertEquals(2, server.calls.size)
        assertInRange(now + 60_000, now + 72_000, dao.get("a1")!!.nextAttemptAt)

        server.handler = { _, _ -> JsonNull }
        now = dao.get("a1")!!.nextAttemptAt
        val done = processor().run()
        assertEquals(2, done.sent)
        assertEquals(listOf("a1", "a1", "a1", "a2"), sentIds())
    }

    @Test
    fun theOutcomeSaysWhenTheRetryIsDue() = runTest {
        server.handler = { _, _ -> throw RpcFailure.Transient("offline") }
        queue("a1", "lead:A")
        val outcome = processor().run()
        assertEquals(dao.get("a1")!!.nextAttemptAt, outcome.nextAttemptAt)
    }

    @Test
    fun backoffDoublesFromThirtySecondsUpToOneHour() {
        assertEquals(30_000L, OutboxProcessor.backoffMs(0))
        assertEquals(30_000L, OutboxProcessor.backoffMs(1))
        assertEquals(60_000L, OutboxProcessor.backoffMs(2))
        assertEquals(120_000L, OutboxProcessor.backoffMs(3))
        assertEquals(1_920_000L, OutboxProcessor.backoffMs(7))
        assertEquals(3_600_000L, OutboxProcessor.backoffMs(8))
        assertEquals(3_600_000L, OutboxProcessor.backoffMs(50))
    }

    @Test
    fun aRefusedWriteIsMarkedFailedAndHoldsBackOnlyItsOwnEntity() = runTest {
        server.handler = { fn, _ -> if (fn == "bad") throw RpcFailure.Permanent("duplicate") else JsonNull }
        queue("a1", "lead:A", rpc = "bad")
        queue("a2", "lead:A")
        queue("b1", "lead:B")

        val outcome = processor().run()

        assertEquals(listOf("a1", "b1"), sentIds())
        assertEquals(1, outcome.sent)
        assertEquals(1, outcome.failed)
        assertEquals(1, outcome.waiting) // a2, behind the failed a1
        val failed = dao.get("a1")!!
        assertEquals("failed", failed.state)
        assertEquals("duplicate", failed.lastError)
        assertTrue(dao.get("a2") != null)

        // Running again doesn't send a2 while a1 is failed.
        processor().run()
        assertEquals(2, server.calls.size)

        // "Try again" after the cause is fixed: a1 then a2, in order.
        server.handler = { _, _ -> JsonNull }
        dao.retry("a1", now)
        assertEquals(2, processor().run().sent)
        assertEquals(listOf("a1", "b1", "a1", "a2"), sentIds())
    }

    @Test
    fun aRetryThatFindsTheWorkAlreadyDoneCountsAsSent() = runTest {
        // The first send went through but its answer was lost: the server now says "already closed".
        server.handler = { fn, _ ->
            when (fn) {
                "complete_followup" -> throw RpcFailure.Permanent("stale_version")
                "set_appointment_status" -> throw RpcFailure.Permanent("invalid_status_change")
                else -> throw RpcFailure.Permanent("stale_version")
            }
        }
        queue("f1", "lead:A", rpc = "complete_followup")
        queue("p1", "appointment:1", rpc = "set_appointment_status")
        queue("x1", "lead:B", rpc = "update_lead")

        val outcome = processor().run()

        assertEquals(2, outcome.sent)
        assertEquals(1, outcome.failed) // the same code from another call is a real refusal
        assertNull(dao.get("f1"))
        assertNull(dao.get("p1"))
        assertEquals("failed", dao.get("x1")!!.state)
    }

    @Test
    fun aRefusedCrashReportIsDroppedQuietly() = runTest {
        server.handler = { fn, _ -> if (fn == "telemetry_add") throw RpcFailure.Permanent("invalid_input") else JsonNull }
        queue("t1", "crash", rpc = "telemetry_add", kind = OutboxKind.Telemetry)
        queue("t2", "crash")

        val outcome = processor().run()

        assertEquals(0, outcome.failed)
        assertEquals(1, outcome.sent)
        assertNull(dao.get("t1"))
        assertEquals(listOf("t1", "t2"), sentIds())
    }

    @Test
    fun anEndedLoginStopsTheRunAndKeepsEverything() = runTest {
        server.handler = { _, _ -> throw RpcFailure.SignedOut("not_signed_in") }
        queue("a1", "lead:A")
        queue("b1", "lead:B")
        queue("c1", "lead:C")

        val outcome = processor().run()

        assertTrue(outcome.signedOut)
        assertEquals(1, server.calls.size)
        assertEquals(3, outcome.waiting)
        assertEquals(0, dao.get("a1")!!.attempts)
    }

    @Test
    fun unreadableArgumentsAreMarkedFailedWithoutSending() = runTest {
        dao.enqueue(
            OutboxItem(
                id = "x1", seq = 0, rpc = "lead_note_add", args = "not json", entityKey = "lead:A",
                kind = OutboxKind.User.wire, createdAt = now, attempts = 0, nextAttemptAt = now, lastError = null, state = "pending",
            ),
        )
        val outcome = processor().run()
        assertEquals(1, outcome.failed)
        assertTrue(server.calls.isEmpty())
        assertEquals("unknown", dao.get("x1")!!.lastError)
    }

    @Test
    fun anUnexpectedErrorKeepsTheWriteForALaterTry() = runTest {
        server.handler = { _, _ -> throw IllegalStateException("bug") }
        queue("a1", "lead:A")
        val outcome = processor().run()
        assertEquals(0, outcome.failed)
        assertEquals(1, outcome.waiting)
        assertEquals("IllegalStateException", dao.get("a1")!!.lastError)
        assertEquals("pending", dao.get("a1")!!.state)
    }

    @Test
    fun twoRunsAtOnceNeverSendTheSameWriteTwice() = runTest {
        val firstCall = CompletableDeferred<Unit>()
        val gate = CompletableDeferred<Unit>()
        server.handler = { _, _ ->
            firstCall.complete(Unit)
            gate.await()
            JsonNull
        }
        queue("a1", "lead:A")
        queue("b1", "lead:B")
        queue("c1", "lead:C")

        // Two processors (e.g. "Sync now" and the background worker) share the queue.
        val one = async { processor().run() }
        firstCall.await()
        val two = async { processor().run() }
        gate.complete(Unit)
        val outcomes = listOf(one.await(), two.await())

        assertEquals(listOf("a1", "b1", "c1"), sentIds())
        assertEquals(3, outcomes.sumOf { it.sent })
    }

    private fun assertInRange(min: Long, max: Long, actual: Long) =
        assertTrue("$actual not in $min..$max", actual in min..max)
}
