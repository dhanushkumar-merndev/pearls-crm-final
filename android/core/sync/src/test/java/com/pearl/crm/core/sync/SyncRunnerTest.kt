package com.pearl.crm.core.sync

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pearl.crm.core.data.OutboxWriter
import com.pearl.crm.core.data.db.AppDatabase
import com.pearl.crm.core.data.net.PearlJson
import com.pearl.crm.core.model.RpcFailure
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.random.Random

@RunWith(AndroidJUnit4::class)
class SyncRunnerTest {
    private lateinit var db: AppDatabase
    private val server = FakeTransport()
    private var now = 5_000_000L
    private var signedIn = true
    private lateinit var runner: SyncRunner

    @Before
    fun open() {
        db = inMemoryDb()
        val outbox = OutboxProcessor(db.outbox(), server, clock = { now }, random = Random(1))
        val pull = PullEngine(server, listOf(LookupValuesSync(db.lookupValues())), db.syncMarkers(), db.transactionRunner(), clock = { now })
        runner = SyncRunner(outbox, pull, isSignedIn = { signedIn }, clock = { now })
    }

    @After
    fun close() = db.close()

    private suspend fun queueWrite(id: String) =
        OutboxWriter(db.outbox()) { now }.enqueue("lead_note_add", buildJsonObject { put("p_client_id", id) }, "lead:1", clientId = id)

    private val emptyPull = PearlJson.parseToJsonElement("""{"entities":{"lookup_values":{"rows":[],"next":"m1","has_more":false}}}""")

    @Test
    fun sendsTheOutboxFirstThenPulls() = runTest {
        server.handler = { fn, _ -> if (fn == "sync_pull") emptyPull else JsonNull }
        queueWrite("w1")
        queueWrite("w2")

        assertEquals(SyncResult.Done, runner.runOnce())

        assertEquals(listOf("lead_note_add", "lead_note_add", "sync_pull"), server.names)
        val status = runner.status.value
        assertEquals(now, status.lastSuccessAt)
        assertFalse(status.offline)
        assertFalse(status.running)
        assertNull(status.errorCode)
        assertNull(runner.nextRetryAt)
    }

    @Test
    fun offlineIsShownAndASyncIsTriedLater() = runTest {
        server.handler = { _, _ -> throw RpcFailure.Transient("offline") }
        queueWrite("w1")

        assertEquals(SyncResult.RetryLater, runner.runOnce())
        assertTrue(runner.status.value.offline)
        assertNull(runner.status.value.lastSuccessAt)
        assertFalse(runner.status.value.running)
        assertNotNull(runner.nextRetryAt)

        // Back online, but the write's retry isn't due yet: the pull still works.
        server.handler = { fn, _ -> if (fn == "sync_pull") emptyPull else JsonNull }
        assertEquals(SyncResult.RetryLater, runner.runOnce())
        assertFalse(runner.status.value.offline)
        assertEquals(now, runner.status.value.lastSuccessAt)

        now = runner.nextRetryAt!!
        assertEquals(SyncResult.Done, runner.runOnce())
        assertEquals(0, db.outbox().pendingCount())
    }

    @Test
    fun anEndedLoginWhileSendingStopsBeforeThePull() = runTest {
        server.handler = { _, _ -> throw RpcFailure.SignedOut("staff_inactive") }
        queueWrite("w1")

        assertEquals(SyncResult.SignedOut, runner.runOnce())
        assertEquals(listOf("lead_note_add"), server.names)
        assertFalse(runner.status.value.running)
        assertEquals(1, db.outbox().pendingCount())
    }

    @Test
    fun anEndedLoginWhilePulling() = runTest {
        server.handler = { _, _ -> throw RpcFailure.SignedOut("not_signed_in") }
        assertEquals(SyncResult.SignedOut, runner.runOnce())
        assertEquals(listOf("sync_pull"), server.names)
    }

    @Test
    fun aRefusedPullShowsItsCodeWithoutLooping() = runTest {
        server.handler = { _, _ -> throw RpcFailure.Permanent("not_allowed") }
        assertEquals(SyncResult.Done, runner.runOnce())
        assertEquals("not_allowed", runner.status.value.errorCode)
        assertFalse(runner.status.value.offline)
        assertNull(runner.status.value.lastSuccessAt)

        server.handler = { _, _ -> emptyPull }
        runner.runOnce()
        assertNull(runner.status.value.errorCode)
    }

    @Test
    fun nothingRunsWhenSignedOut() = runTest {
        signedIn = false
        queueWrite("w1")
        assertEquals(SyncResult.Done, runner.runOnce())
        assertTrue(server.calls.isEmpty())
    }
}
