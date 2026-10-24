package com.pearl.crm.core.data

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pearl.crm.core.data.db.AppDatabase
import com.pearl.crm.core.data.db.LookupValueEntity
import com.pearl.crm.core.model.LibraryKind
import com.pearl.crm.core.model.RpcFailure
import com.pearl.crm.core.model.RpcTransport
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LibraryRepositoryTest {
    private lateinit var db: AppDatabase
    private val calls = mutableListOf<Pair<String, JsonObject>>()

    /** What the fake server does; offline by default. */
    private var server: (String, JsonObject) -> JsonElement = { _, _ -> throw RpcFailure.Transient("offline") }
    private val transport = RpcTransport { fn, args ->
        calls += fn to args
        server(fn, args)
    }
    private lateinit var repo: LibraryRepository

    @Before
    fun open() {
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        repo = LibraryRepository(transport, db.lookupValues())
    }

    @After
    fun close() = db.close()

    private fun lookup(
        id: String,
        label: String,
        usage: Int = 0,
        kind: String = LibraryKind.LEAD_SOURCE,
        active: Boolean = true,
        mergedInto: String? = null,
    ) = LookupValueEntity(
        id = id, kind = kind, label = label, code = null, sort = 100, active = active, usageCount = usage,
        lastUsedAt = null, createdOnTheFly = false, reviewedAt = null, mergedIntoId = mergedInto, updatedAt = "2026-10-24T00:00:00Z",
    )

    @Test
    fun searchesOnTheServerWithTheTrimmedQuery() = runTest {
        server = { _, _ ->
            JsonObject(
                mapOf(
                    "items" to JsonArray(
                        listOf(buildJsonObject { put("id", "s1"); put("label", "Walk-in"); put("on_the_fly", true) }),
                    ),
                    "next_cursor" to JsonPrimitive("c2"),
                ),
            )
        }
        val page = repo.search(LibraryKind.SERVICE, "  walk ", "c1", 10)

        assertEquals(listOf("s1"), page.items.map { it.id })
        assertTrue(page.items.single().onTheFly)
        assertEquals("c2", page.nextCursor)
        val (fn, args) = calls.single()
        assertEquals("library_search", fn)
        assertEquals("service", args.getValue("p_kind").jsonPrimitive.content)
        assertEquals("walk", args.getValue("p_q").jsonPrimitive.content)
        assertEquals("c1", args.getValue("p_cursor").jsonPrimitive.content)
        assertEquals(10, args.getValue("p_limit").jsonPrimitive.content.toInt())
    }

    @Test
    fun firstPageAsksTheServerWithoutACursor() = runTest {
        server = { _, _ -> buildJsonObject { } }
        val page = repo.search(LibraryKind.SERVICE, "", null, 10)
        assertTrue(page.items.isEmpty())
        assertNull(page.nextCursor)
        assertSame(JsonNull, calls.single().second["p_cursor"])
    }

    @Test
    fun offlineLookupKindsUseThePhonesCopyWithLoadMore() = runTest {
        // 23 visible lead sources (usage 23 … 1), plus rows the picker must never show.
        db.lookupValues().upsert(
            (1..23).map { lookup("l%02d".format(it), "Source %02d".format(it), usage = 24 - it) } +
                lookup("x1", "Old source", active = false) +
                lookup("x2", "Merged source", mergedInto = "l01") +
                lookup("x3", "A lost reason", kind = LibraryKind.LOST_REASON),
        )

        val first = repo.search(LibraryKind.LEAD_SOURCE, "", null, 10)
        assertEquals((1..10).map { "l%02d".format(it) }, first.items.map { it.id })
        assertEquals("local:10", first.nextCursor)

        // "Load 10 more" with a local cursor never goes to the server.
        calls.clear()
        val second = repo.search(LibraryKind.LEAD_SOURCE, "", first.nextCursor, 10)
        assertTrue(calls.isEmpty())
        assertEquals((11..20).map { "l%02d".format(it) }, second.items.map { it.id })
        assertEquals("local:20", second.nextCursor)

        val last = repo.search(LibraryKind.LEAD_SOURCE, "", second.nextCursor, 10)
        assertEquals(listOf("l21", "l22", "l23"), last.items.map { it.id })
        assertNull(last.nextCursor)
    }

    @Test
    fun offlineSearchMatchesAnywherePrefixFirstThenMostUsed() = runTest {
        db.lookupValues().upsert(
            listOf(
                lookup("a", "Google ads", usage = 1),
                lookup("b", "Friend from Google", usage = 50),
                lookup("c", "Google maps", usage = 9),
                lookup("d", "Walk-in", usage = 99),
            ),
        )
        val page = repo.search(LibraryKind.LEAD_SOURCE, " google ", null, 10)
        assertEquals(listOf("c", "a", "b"), page.items.map { it.id })
    }

    @Test
    fun offlineSearchTreatsPercentAndUnderscoreAsPlainText() = runTest {
        db.lookupValues().upsert(
            listOf(
                lookup("a", "50% off camp"),
                lookup("b", "500 club"),
                lookup("c", "walk_in"),
                lookup("d", "walk-in"),
            ),
        )
        assertEquals(listOf("a"), repo.search(LibraryKind.LEAD_SOURCE, "50%", null, 10).items.map { it.id })
        assertEquals(listOf("c"), repo.search(LibraryKind.LEAD_SOURCE, "walk_", null, 10).items.map { it.id })
    }

    @Test
    fun offlineNonLookupKindsReportTheFailure() = runTest {
        try {
            repo.search(LibraryKind.SERVICE, "", null, 10)
            fail("expected the offline failure")
        } catch (_: RpcFailure.Transient) {
        }
    }

    @Test
    fun aRefusalIsNotHiddenByTheOfflineCopy() = runTest {
        db.lookupValues().upsert(listOf(lookup("a", "Walk-in")))
        server = { _, _ -> throw RpcFailure.Permanent("not_allowed") }
        try {
            repo.search(LibraryKind.LEAD_SOURCE, "", null, 10)
            fail("expected the refusal")
        } catch (e: RpcFailure.Permanent) {
            assertEquals("not_allowed", e.code)
        }
    }

    @Test
    fun createSendsTheTrimmedLabelWithDefaultsAndAClientId() = runTest {
        server = { _, _ -> buildJsonObject { put("id", "n1"); put("label", "Camp"); put("on_the_fly", true) } }
        val item = repo.create(LibraryKind.LEAD_SOURCE, "  Camp ", buildJsonObject { put("code", "CMP") })

        assertEquals("n1", item.id)
        val (fn, args) = calls.single()
        assertEquals("library_create", fn)
        val payload = args.getValue("p_payload").jsonObject
        assertEquals("Camp", payload.getValue("label").jsonPrimitive.content)
        assertEquals("CMP", payload.getValue("code").jsonPrimitive.content)
        assertEquals(36, args.getValue("p_client_id").jsonPrimitive.content.length)
    }
}
