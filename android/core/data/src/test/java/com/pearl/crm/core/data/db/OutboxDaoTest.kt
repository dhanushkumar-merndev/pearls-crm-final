package com.pearl.crm.core.data.db

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** The outbox queue: which writes are ready to send, and in what order. */
@RunWith(AndroidJUnit4::class)
class OutboxDaoTest {
    private lateinit var db: AppDatabase
    private lateinit var dao: OutboxDao

    @Before
    fun open() {
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        dao = db.outbox()
    }

    @After
    fun close() = db.close()

    private fun item(id: String, entity: String, dueAt: Long = 0, kind: OutboxKind = OutboxKind.User) = OutboxItem(
        id = id,
        seq = 0,
        rpc = "rpc_$id",
        args = "{}",
        entityKey = entity,
        kind = kind.wire,
        createdAt = 0,
        attempts = 0,
        nextAttemptAt = dueAt,
        lastError = null,
        state = OutboxState.Pending.wire,
    )

    private suspend fun ids(now: Long = 1_000, limit: Int = 50) = dao.dueHeads(now, limit).map { it.id }

    @Test
    fun enqueueNumbersItemsInTheOrderTheyWereAdded() = runTest {
        listOf("c", "a", "b").forEach { dao.enqueue(item(it, "lead:$it")) }
        assertEquals(listOf(1L, 2L, 3L), listOf("c", "a", "b").map { dao.get(it)!!.seq })
    }

    @Test
    fun dueHeadsReturnsOnlyTheFirstWaitingWritePerEntityOldestFirst() = runTest {
        dao.enqueue(item("a1", "lead:A"))
        dao.enqueue(item("b1", "lead:B"))
        dao.enqueue(item("a2", "lead:A"))
        dao.enqueue(item("c1", "lead:C"))
        dao.enqueue(item("b2", "lead:B"))
        assertEquals(listOf("a1", "b1", "c1"), ids())

        dao.delete("a1")
        assertEquals(listOf("b1", "a2", "c1"), ids())
    }

    @Test
    fun aWriteNotYetDueIsSkippedAndHoldsBackLaterWritesForTheSameEntity() = runTest {
        dao.enqueue(item("a1", "lead:A", dueAt = 5_000))
        dao.enqueue(item("a2", "lead:A"))
        dao.enqueue(item("b1", "lead:B"))
        assertEquals(listOf("b1"), ids(now = 1_000))
        assertEquals(listOf("a1", "b1"), ids(now = 5_000))
    }

    @Test
    fun aFailedWriteBlocksItsEntityUntilRetriedButNotOtherEntities() = runTest {
        dao.enqueue(item("a1", "lead:A"))
        dao.enqueue(item("a2", "lead:A"))
        dao.enqueue(item("b1", "lead:B"))
        dao.markFailed("a1", "duplicate")
        assertEquals(listOf("b1"), ids())
        assertEquals(2, dao.pendingCount()) // a2 and b1; a1 is failed

        val failed = dao.get("a1")!!
        assertEquals("failed", failed.state)
        assertEquals("duplicate", failed.lastError)
        assertEquals(1, failed.attempts)

        assertEquals(1, dao.retry("a1", now = 2_000))
        assertEquals(0, dao.retry("b1", now = 2_000)) // only failed items can be retried
        assertEquals(listOf("a1", "b1"), ids(now = 2_000))
        assertNull(dao.get("a1")!!.lastError)
    }

    @Test
    fun dueHeadsRespectsTheLimit() = runTest {
        (1..5).forEach { dao.enqueue(item("i$it", "lead:$it")) }
        assertEquals(listOf("i1", "i2"), ids(limit = 2))
    }

    @Test
    fun markRetryCountsTheTryAndMovesTheDueTime() = runTest {
        dao.enqueue(item("a1", "lead:A"))
        dao.markRetry("a1", nextAttemptAt = 9_000, error = "offline")
        val row = dao.get("a1")!!
        assertEquals(1, row.attempts)
        assertEquals(9_000L, row.nextAttemptAt)
        assertEquals("offline", row.lastError)
        assertEquals(9_000L, dao.earliestPending())
    }

    @Test
    fun earliestPendingIgnoresWritesWaitingBehindAnEarlierOne() = runTest {
        dao.enqueue(item("a1", "lead:A", dueAt = 50_000))
        dao.enqueue(item("a2", "lead:A", dueAt = 0)) // due long ago, but must wait for a1
        assertEquals(50_000L, dao.earliestPending())
        dao.markFailed("a1", "duplicate")
        assertNull(dao.earliestPending()) // a2 can't go until the person retries a1
    }

    @Test
    fun unsentCountIgnoresCrashReports() = runTest {
        dao.enqueue(item("u1", "lead:A"))
        dao.enqueue(item("t1", "crash:1", kind = OutboxKind.Telemetry))
        assertEquals(1, dao.unsentCount())
        assertEquals(2, dao.pendingCount())
    }
}
