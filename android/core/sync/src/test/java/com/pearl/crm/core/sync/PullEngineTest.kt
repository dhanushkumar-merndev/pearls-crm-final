package com.pearl.crm.core.sync

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pearl.crm.core.data.db.AppDatabase
import com.pearl.crm.core.data.db.SyncMarker
import com.pearl.crm.core.data.net.PearlJson
import com.pearl.crm.core.model.RpcFailure
import com.pearl.crm.core.model.SyncEntityName
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PullEngineTest {
    private lateinit var db: AppDatabase
    private val server = FakeTransport()
    private val now = 1_700_000_000_000L

    @Before
    fun open() {
        db = inMemoryDb()
    }

    @After
    fun close() = db.close()

    private fun engine(vararg entities: SyncEntity = arrayOf(LookupValuesSync(db.lookupValues()))) =
        PullEngine(server, entities.toList(), db.syncMarkers(), db.transactionRunner(), clock = { now }, pageSize = 2)

    /** Answers each `sync_pull` with the next of [pages] (sync_pull JSON). */
    private fun serverAnswers(vararg pages: String) {
        var round = 0
        server.handler = { _, _ -> PearlJson.parseToJsonElement(pages[round++]) }
    }

    private fun row(id: String, label: String = "Source $id") =
        """{"id":"$id","kind":"lead_source","label":"$label","usage_count":1,"updated_at":"2026-10-24T00:00:00Z"}"""

    private fun page(rows: List<String> = emptyList(), removed: List<String> = emptyList(), next: String?, hasMore: Boolean) =
        """{"rows":[${rows.joinToString(",")}],"removed":[${removed.joinToString(",") { "\"$it\"" }}],""" +
            """"next":${next?.let { "\"$it\"" } ?: "null"},"has_more":$hasMore}"""

    private fun answer(vararg entities: Pair<String, String>) =
        """{"server_time":"2026-10-24T00:00:00Z","entities":{${entities.joinToString(",") { (k, v) -> "\"$k\":$v" }}}}"""

    private fun sinceOf(call: Int): JsonObject = server.calls[call].second.getValue("p_since").jsonObject

    private suspend fun marker() = db.syncMarkers().marker(SyncEntityName.LOOKUP_VALUES)

    @Test
    fun pagesUntilTheServerHasNoMore() = runTest {
        serverAnswers(
            answer(SyncEntityName.LOOKUP_VALUES to page(listOf(row("a"), row("b")), next = "m1", hasMore = true)),
            answer(SyncEntityName.LOOKUP_VALUES to page(listOf(row("c")), next = "m2", hasMore = false)),
        )

        val outcome = engine().pull()

        assertEquals(PullEngine.Outcome(rounds = 2, rows = 3, removed = 0), outcome)
        assertEquals(listOf("sync_pull", "sync_pull"), server.names)
        assertEquals(JsonNull, sinceOf(0).getValue(SyncEntityName.LOOKUP_VALUES))
        assertEquals("m1", sinceOf(1).getValue(SyncEntityName.LOOKUP_VALUES).jsonPrimitive.content)
        assertEquals(2, server.calls[0].second.getValue("p_limit").jsonPrimitive.content.toInt())
        assertEquals("m2", marker())
        listOf("a", "b", "c").forEach { assertNotNull(db.lookupValues().get(it)) }
    }

    @Test
    fun startsFromTheSavedMarker() = runTest {
        db.syncMarkers().set(SyncMarker(SyncEntityName.LOOKUP_VALUES, "m7", 1))
        serverAnswers(answer(SyncEntityName.LOOKUP_VALUES to page(next = "m7", hasMore = false)))
        engine().pull()
        assertEquals("m7", sinceOf(0).getValue(SyncEntityName.LOOKUP_VALUES).jsonPrimitive.content)
        assertEquals(now, db.syncMarkers().observeLastPull().first())
    }

    @Test
    fun removedIdsAreDeleted() = runTest {
        serverAnswers(
            answer(SyncEntityName.LOOKUP_VALUES to page(listOf(row("a"), row("b")), next = "m1", hasMore = false)),
            answer(SyncEntityName.LOOKUP_VALUES to page(listOf(row("c")), removed = listOf("a", "zz"), next = "m2", hasMore = false)),
        )
        engine().pull()
        val outcome = engine().pull()

        assertEquals(2, outcome.removed) // ids the server listed, known here or not
        assertNull(db.lookupValues().get("a"))
        assertNotNull(db.lookupValues().get("b"))
        assertNotNull(db.lookupValues().get("c"))
    }

    @Test
    fun aMalformedRowIsSkippedAndTheRestSaved() = runTest {
        serverAnswers(
            answer(SyncEntityName.LOOKUP_VALUES to page(listOf("""{"label":"no id"}""", row("b")), next = "m1", hasMore = false)),
        )
        engine().pull()
        assertNotNull(db.lookupValues().get("b"))
        assertEquals("m1", marker())
    }

    @Test
    fun thePageAndItsMarkerAreSavedTogetherOrNotAtAll() = runTest {
        val lookups = LookupValuesSync(db.lookupValues())
        val crashing = object : SyncEntity {
            override val name = SyncEntityName.LOOKUP_VALUES

            override suspend fun apply(rows: List<JsonObject>, removed: List<String>) {
                lookups.apply(rows, removed)
                throw IllegalStateException("disk full")
            }
        }
        serverAnswers(answer(SyncEntityName.LOOKUP_VALUES to page(listOf(row("a")), next = "m1", hasMore = false)))

        try {
            engine(crashing).pull()
            fail("expected the crash")
        } catch (_: IllegalStateException) {
        }

        assertNull(db.lookupValues().get("a"))
        assertNull(marker())
    }

    @Test
    fun aServerThatDoesNotMoveTheMarkerIsNotAskedAgain() = runTest {
        db.syncMarkers().set(SyncMarker(SyncEntityName.LOOKUP_VALUES, "m1", 1))
        serverAnswers(answer(SyncEntityName.LOOKUP_VALUES to page(listOf(row("a")), next = "m1", hasMore = true)))

        val outcome = engine().pull()

        assertEquals(1, outcome.rounds)
        assertEquals(1, server.calls.size)
    }

    @Test
    fun hasMoreWithoutANextMarkerKeepsTheOldMarkerAndStops() = runTest {
        db.syncMarkers().set(SyncMarker(SyncEntityName.LOOKUP_VALUES, "m1", 1))
        serverAnswers(answer(SyncEntityName.LOOKUP_VALUES to page(listOf(row("a")), next = null, hasMore = true)))

        assertEquals(1, engine().pull().rounds)
        assertEquals("m1", marker())
    }

    @Test
    fun anEndlessServerIsCutOffAndTheNextSyncCarriesOn() = runTest {
        var n = 0
        server.handler = { _, _ ->
            n++
            PearlJson.parseToJsonElement(answer(SyncEntityName.LOOKUP_VALUES to page(listOf(row("r$n")), next = "m$n", hasMore = true)))
        }

        val outcome = engine().pull()

        assertEquals(100, outcome.rounds)
        assertEquals("m100", marker())
    }

    @Test
    fun aFailureMidwayKeepsTheEarlierRounds() = runTest {
        var round = 0
        server.handler = { _, _ ->
            if (++round == 2) throw RpcFailure.Transient("offline")
            PearlJson.parseToJsonElement(answer(SyncEntityName.LOOKUP_VALUES to page(listOf(row("a")), next = "m1", hasMore = true)))
        }

        try {
            engine().pull()
            fail("expected the failure")
        } catch (_: RpcFailure.Transient) {
        }

        assertEquals("m1", marker())
        assertNotNull(db.lookupValues().get("a"))
    }

    @Test
    fun onlyEntitiesWithMoreAreAskedAgainAndUnknownOnesAreIgnored() = runTest {
        val leads = RecordingEntity(SyncEntityName.LEADS)
        serverAnswers(
            answer(
                SyncEntityName.LOOKUP_VALUES to page(listOf(row("a")), next = "m1", hasMore = false),
                SyncEntityName.LEADS to page(next = "L1", hasMore = true),
                "something_new" to page(next = "x", hasMore = true),
            ),
            answer(SyncEntityName.LEADS to page(removed = listOf("lead-9"), next = "L2", hasMore = false)),
        )

        val outcome = engine(LookupValuesSync(db.lookupValues()), leads).pull()

        assertEquals(2, outcome.rounds)
        assertEquals(setOf(SyncEntityName.LOOKUP_VALUES, SyncEntityName.LEADS), sinceOf(0).keys)
        assertEquals(setOf(SyncEntityName.LEADS), sinceOf(1).keys)
        assertEquals(listOf(listOf("lead-9")), leads.removedPages.drop(1))
        assertEquals("L2", db.syncMarkers().marker(SyncEntityName.LEADS))
        assertNull(db.syncMarkers().marker("something_new"))
        assertTrue(leads.ranInsideTransaction.all { it })
    }

    /** A second synced entity; also checks it is always applied inside the transaction. */
    private inner class RecordingEntity(override val name: String) : SyncEntity {
        val removedPages = mutableListOf<List<String>>()
        val ranInsideTransaction = mutableListOf<Boolean>()

        override suspend fun apply(rows: List<JsonObject>, removed: List<String>) {
            removedPages += removed
            ranInsideTransaction += db.inTransaction()
        }
    }
}
