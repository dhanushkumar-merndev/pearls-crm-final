package com.pearl.crm.feature.sales

import android.content.Context
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.annotation.StringRes
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.hasScrollToIndexAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToIndex
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import kotlinx.serialization.json.jsonArray
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pearl.crm.core.data.OutboxWriter
import com.pearl.crm.core.data.SalesRepository
import com.pearl.crm.core.data.db.AppDatabase
import com.pearl.crm.core.data.db.LeadEntity
import com.pearl.crm.core.data.net.PearlJson
import com.pearl.crm.core.model.CallOutcome
import com.pearl.crm.core.model.LeadStage
import com.pearl.crm.core.model.LibraryItem
import com.pearl.crm.core.model.LibraryPage
import com.pearl.crm.core.model.LibrarySource
import com.pearl.crm.core.model.RpcFailure
import com.pearl.crm.core.model.RpcTransport
import com.pearl.crm.core.ui.theme.PearlTheme
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

private class FakeLibrary : LibrarySource {
    override suspend fun search(kind: String, query: String, cursor: String?, limit: Int) =
        LibraryPage(listOf(LibraryItem("${kind}-1", if (kind == "doctor") "Dr. Test" else "Too costly")))

    override suspend fun create(kind: String, label: String, defaults: JsonObject) = LibraryItem("new", label)
}

@RunWith(AndroidJUnit4::class)
class SalesScreensTest {
    @get:Rule
    val compose = createComposeRule()

    private val library = FakeLibrary()
    private var db: AppDatabase? = null
    private var disposeScreen: (() -> Unit)? = null

    private fun text(@StringRes id: Int, vararg args: Any) = ApplicationProvider.getApplicationContext<Context>().getString(id, *args)

    private fun exists(matcher: SemanticsMatcher) = compose.onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty()

    @Test
    fun emptyCallsAreCenteredBelowTheTitle() {
        val database = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), AppDatabase::class.java)
            .allowMainThreadQueries().build()
        db = database
        val sales = SalesRepository(RpcTransport { _, _ -> error("Empty lists use the phone database") }, database, OutboxWriter(database.outbox()))
        compose.setContent {
            PearlTheme {
                Box(Modifier.size(320.dp, 480.dp).testTag("screen")) {
                    CallsScreen(sales, onOpenLead = {})
                }
            }
        }
        compose.waitUntil(5_000) { exists(hasText(text(R.string.calls_empty))) }
        val viewport = compose.onNodeWithTag("screen").fetchSemanticsNode().boundsInRoot
        val empty = compose.onNodeWithText(text(R.string.calls_empty)).fetchSemanticsNode().boundsInRoot
        assertTrue("Empty calls should occupy the centre, below the screen controls", empty.center.y > viewport.center.y)
        assertTrue("Keep clearance above navigation", empty.bottom < viewport.bottom - viewport.height * 0.15f)
    }

    @Test
    fun longEmptySearchCanScrollToClearSearchOnAShortScreen() {
        val database = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), AppDatabase::class.java)
            .allowMainThreadQueries().build()
        db = database
        val sales = SalesRepository(RpcTransport { _, _ -> error("Search uses the phone database") }, database, OutboxWriter(database.outbox()))
        compose.setContent {
            PearlTheme {
                Box(Modifier.size(320.dp, 320.dp)) {
                    LeadsScreen(sales, library, onOpenLead = {}, swipeHint = false)
                }
            }
        }
        compose.onNodeWithTag("lead-search").performTextInput("Nobody matches this long search ".repeat(12))
        compose.waitUntil(5_000) { exists(hasText(text(R.string.leads_clear_search))) }
        compose.onNodeWithText(text(R.string.leads_clear_search)).performScrollTo().assertIsDisplayed().performClick()
        compose.onNodeWithText(text(R.string.leads_show_all)).performScrollTo().assertIsDisplayed()
    }

    @Test
    fun laterLeadsAreReachableAndANewSearchResetsThePage() {
        val database = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), AppDatabase::class.java)
            .allowMainThreadQueries().build()
        db = database
        runBlocking {
            database.leads().upsert((1..51).map { i ->
                val n = i.toString().padStart(3, '0')
                LeadEntity.fromRow(PearlJson.parseToJsonElement(
                    """{"id":"L$n","name":"Person $n","phone_e164":"+919845000000","stage":"new","updated_at":"2026-11-03T00:00:00Z"}""",
                ).jsonObject)
            })
        }
        val sales = SalesRepository(RpcTransport { _, _ -> error("Paging works offline") }, database, OutboxWriter(database.outbox()))
        compose.setContent { PearlTheme { LeadsScreen(sales, library, onOpenLead = {}, swipeHint = false) } }
        compose.onNodeWithText(text(R.string.leads_filter_all)).performClick()
        compose.waitUntil(5_000) { exists(hasText("Person 001")) }
        compose.onNode(hasScrollToIndexAction()).performScrollToIndex(50)
        compose.onNodeWithTag("next-page").performClick()
        compose.waitUntil(5_000) { exists(hasText("Person 051")) }
        compose.onNodeWithText("Person 051").assertIsDisplayed()
        compose.onNodeWithTag("lead-search").performTextInput("Person 001")
        compose.waitUntil(5_000) { exists(hasTestTag("lead-L001")) }
        compose.onNodeWithTag("lead-L001").assertIsDisplayed()
        compose.onNodeWithTag("previous-page").assertDoesNotExist()
    }

    @Test
    fun returningFromALeadRestoresTheListScrollPosition() = checkScrollRestoration(clearCache = true)

    @Test
    fun cachedLeadPageAppearsImmediatelyDuringTheBackSlide() = checkScrollRestoration(clearCache = false)

    private fun checkScrollRestoration(clearCache: Boolean) {
        val database = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), AppDatabase::class.java)
            .allowMainThreadQueries().build()
        db = database
        runBlocking {
            database.leads().upsert((1..50).map { i ->
                val n = i.toString().padStart(3, '0')
                LeadEntity.fromRow(PearlJson.parseToJsonElement(
                    """{"id":"L$n","name":"Person $n","phone_e164":"+919845000000","stage":"new","updated_at":"2026-11-03T00:00:00Z"}""",
                ).jsonObject)
            })
        }
        val sales = SalesRepository(RpcTransport { _, _ -> error("List reads are offline") }, database, OutboxWriter(database.outbox()))
        val owner = object : LifecycleOwner {
            val registry = LifecycleRegistry.createUnsafe(this)
            override val lifecycle: Lifecycle get() = registry
        }
        compose.runOnUiThread { owner.registry.currentState = Lifecycle.State.RESUMED }
        val attached = mutableStateOf(true)
        disposeScreen = { attached.value = false }
        compose.setContent {
            if (attached.value) CompositionLocalProvider(LocalLifecycleOwner provides owner) { PearlTheme {
                val holder = rememberSaveableStateHolder()
                val detail = remember { mutableStateOf(false) }
                if (detail.value) {
                    TextButton(onClick = {
                        owner.registry.currentState = Lifecycle.State.STARTED
                        detail.value = false
                    }) { Text("Return to list") }
                } else {
                    holder.SaveableStateProvider("leads") {
                        LeadsScreen(sales, library, onOpenLead = { detail.value = true }, swipeHint = false)
                    }
                }
            } }
        }
        compose.onNodeWithText(text(R.string.leads_filter_all)).performClick()
        compose.waitUntil(5_000) { exists(hasTestTag("lead-L001")) }
        compose.onNode(hasScrollToIndexAction()).performScrollToIndex(40)
        compose.onNodeWithTag("lead-L041").performClick()
        if (clearCache) compose.runOnIdle { sales.clearCachedReads() }
        compose.onNodeWithText("Return to list").performClick()
        if (clearCache) compose.onNodeWithTag("loading").assertIsDisplayed()
        else compose.onNodeWithTag("lead-L041").assertIsDisplayed()
        compose.mainClock.advanceTimeBy(250)
        compose.runOnUiThread { owner.registry.currentState = Lifecycle.State.RESUMED }
        compose.waitUntil(5_000) { !exists(hasTestTag("loading")) }
        compose.onNodeWithTag("lead-L041").assertIsDisplayed()
    }

    @After
    fun close() {
        if (disposeScreen != null) {
            compose.runOnIdle { disposeScreen?.invoke() }
            compose.waitForIdle()
        }
        db?.close()
    }

    private fun showNotes(saved: MutableList<CallNotesInput>) {
        compose.setContent {
            PearlTheme { CallNotesForm(leadName = "Asha", library = library, onSave = { saved += it }, onLater = {}) }
        }
    }

    @Test
    fun notesSheetWithoutAResultShowsTheMessageAndSavesNothing() {
        val saved = mutableListOf<CallNotesInput>()
        showNotes(saved)

        compose.onNodeWithTag("save-notes").performScrollTo().performClick()

        compose.onNodeWithTag("outcome-error").assertIsDisplayed()
        compose.onNodeWithText(text(R.string.notes_outcome_required)).assertIsDisplayed()
        assertTrue(saved.isEmpty())

        // Choosing a result clears the message.
        compose.onNodeWithTag("outcome-${CallOutcome.BUSY}").performScrollTo().performClick()
        compose.onNodeWithTag("outcome-error").assertDoesNotExist()
    }

    @Test
    fun notesSheetSavesTheResultNotesAndNextStep() {
        val saved = mutableListOf<CallNotesInput>()
        showNotes(saved)

        compose.onNodeWithTag("outcome-${CallOutcome.CONNECTED}").performClick()
        compose.onNodeWithTag("notes").performTextInput("Wants the price list")
        compose.onNodeWithText(text(R.string.notes_next_tomorrow)).performScrollTo().performClick()
        compose.onNodeWithTag("save-notes").performScrollTo().performClick()

        val input = saved.single()
        assertEquals(CallOutcome.CONNECTED, input.outcome)
        assertEquals("Wants the price list", input.notes)
        assertEquals(NextChoice.Tomorrow, input.next)
        assertNull(input.stage)
    }

    @Test
    fun lostNeedsAReasonFromTheList() {
        val saved = mutableListOf<CallNotesInput>()
        showNotes(saved)

        compose.onNodeWithTag("outcome-${CallOutcome.CONNECTED}").performClick()
        compose.onNodeWithTag("stage-${LeadStage.LOST}").performScrollTo().performClick()
        compose.onNodeWithTag("save-notes").performScrollTo().performClick()
        compose.onNodeWithTag("lost-reason-error").assertIsDisplayed()
        assertTrue(saved.isEmpty())

        compose.onNodeWithTag("lost-reason").performScrollTo().performClick()
        compose.onNodeWithText("Too costly").performClick()
        compose.onNodeWithTag("save-notes").performScrollTo().performClick()
        assertEquals("lost_reason-1", saved.single().lostReason?.id)
        assertFalse("no upload unless tapped", saved.single().uploadRecording)
    }

    @Test
    fun anyCallUploadsItsRecordingWithOneTap() {
        val saved = mutableListOf<CallNotesInput>()
        compose.setContent {
            PearlTheme { CallNotesForm(leadName = "Asha", library = library, onSave = { saved += it }, onLater = {}, offerCallRecording = true) }
        }
        // Offered after every call, whatever the stage.
        compose.onNodeWithTag("outcome-${CallOutcome.CONNECTED}").performClick()
        compose.onNodeWithTag("upload-call-recording").performScrollTo().performClick()
        compose.onNodeWithTag("save-notes").performScrollTo().performClick()
        assertTrue(saved.single().uploadRecording)
    }

    @Test
    fun lostAfterACallUploadsItsRecordingWithOneTap() {
        val saved = mutableListOf<CallNotesInput>()
        compose.setContent {
            PearlTheme { CallNotesForm(leadName = "Asha", library = library, onSave = { saved += it }, onLater = {}, offerCallRecording = true) }
        }
        compose.onNodeWithTag("outcome-${CallOutcome.CONNECTED}").performClick()
        compose.onNodeWithTag("stage-${LeadStage.LOST}").performScrollTo().performClick()
        compose.onNodeWithTag("upload-call-recording").performScrollTo().performClick()
        compose.onNodeWithText(text(R.string.notes_recording_will_upload)).assertIsDisplayed()
        // Changing the mind and back again.
        compose.onNodeWithText(text(R.string.notes_recording_undo)).performClick()
        compose.onNodeWithTag("upload-call-recording").performScrollTo().performClick()
        compose.onNodeWithTag("lost-reason").performScrollTo().performClick()
        compose.onNodeWithText("Too costly").performClick()
        compose.onNodeWithTag("save-notes").performScrollTo().performClick()
        assertTrue(saved.single().uploadRecording)
    }

    @Test
    fun notesRulesMatchTheServer() {
        assertEquals(setOf(NotesField.Outcome), validateCallNotes(CallNotesInput()).keys)
        assertEquals(
            setOf(NotesField.Notes),
            validateCallNotes(CallNotesInput(outcome = CallOutcome.BUSY, notes = "x".repeat(SalesRepository.MAX_NOTES + 1))).keys,
        )
        assertTrue(validateCallNotes(CallNotesInput(outcome = CallOutcome.BUSY, notes = "x".repeat(SalesRepository.MAX_NOTES))).isEmpty())
        assertEquals(setOf(NotesField.LostReason), validateCallNotes(CallNotesInput(outcome = CallOutcome.BUSY, stage = LeadStage.LOST)).keys)
    }

    @Test
    fun newLeadRules() {
        assertEquals(setOf("name", "phone"), validateNewLead(" ", "12").keys)
        assertTrue(validateNewLead("Asha", "98450 12345").isEmpty())
    }

    @Test
    fun aSlotTakenBySomeoneElseShowsSlotFull() {
        val transport = RpcTransport { fn, _ ->
            when (fn) {
                "get_free_slots" -> PearlJson.parseToJsonElement(
                    """[{"start":"2030-01-16T05:30:00+00:00","capacity":1,"booked":0,"left":1,"blocked_reason":null}]""",
                )
                else -> throw RpcFailure.Permanent("slot_full")
            }
        }
        val database = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        db = database
        val sales = SalesRepository(transport, database, OutboxWriter(database.outbox()))
        compose.setContent {
            PearlTheme { BookScreen("L1", sales, library, onBack = {}, onBooked = {}) }
        }

        // Book without choosing: the message is under the time list.
        compose.onNodeWithTag("book-save").performClick()
        compose.onNodeWithText(text(R.string.book_doctor_required)).assertIsDisplayed()

        compose.onNodeWithTag("book-doctor").performClick()
        compose.onNodeWithText("Dr. Test").performClick()
        compose.waitUntil(5_000) { exists(hasText("11:00 AM", substring = true)) }
        compose.onNodeWithText(text(R.string.book_slot_left, "11:00 AM", 1)).performScrollTo().performClick()
        compose.onNodeWithTag("book-save").performClick()

        compose.waitUntil(5_000) { exists(hasTestTag("book-failure")) }
        compose.onNodeWithText(text(com.pearl.crm.core.ui.R.string.error_slot_full)).assertIsDisplayed()
    }

    private fun showLead(transport: RpcTransport): AppDatabase {
        val database = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), AppDatabase::class.java)
            .allowMainThreadQueries().build()
        db = database
        runBlocking {
            database.leads().upsert(listOf(LeadEntity.fromRow(PearlJson.parseToJsonElement(
                """{"id":"L1","sl_no":7,"name":"Asha","phone_e164":"+919845000001","stage":"interested","amount_quoted_paise":6000000,
                "comments1":"Wants EMI","updated_at":"2026-11-03T00:00:00Z"}""",
            ).jsonObject)))
        }
        val sales = SalesRepository(transport, database, OutboxWriter(database.outbox()))
        compose.setContent { PearlTheme { LeadDetailScreen("L1", sales, library, onBack = {}, onBook = {}, onReschedule = { _, a -> rescheduled = a }) } }
        return database
    }

    private var rescheduled: String? = null

    private fun queuedRpcs(database: AppDatabase): List<String> {
        val out = mutableListOf<String>()
        database.query("SELECT rpc FROM outbox ORDER BY seq", null).use { c -> while (c.moveToNext()) out += c.getString(0) }
        return out
    }

    private val quoteJson = """{"id":"Q1","lead_id":"L1","quote_no":1,"items":[{"name":"PRP","qty":2,"price_paise":150000}],
        "subtotal_paise":300000,"discount_paise":0,"total_paise":300000,"valid_until":"2030-01-01","note":null,
        "message":"Hello Asha","sent_count":0,"created_at":"2026-11-20T05:00:00+00:00","lead_name":"Asha",
        "lead_phone":"+919845000001","lead_sl_no":7,"created_by_name":"Priya","clinic":{"name":"Clinic"}}"""

    private fun followup(id: String, status: String, dueDate: String) = com.pearl.crm.core.data.db.FollowupEntity(
        id = id, kind = "followup", leadId = "L1", patientId = null, dueDate = dueDate, dueAt = null,
        reason = "Call back $id", status = status, outcome = null, assignedTo = "me", updatedAt = "x",
    )

    @Test
    fun anOpenFollowupOnTheLeadPageOpensTheFollowupsTab() {
        var opened: String? = null
        val database = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), AppDatabase::class.java)
            .allowMainThreadQueries().build()
        db = database
        runBlocking {
            database.leads().upsert(listOf(LeadEntity.fromRow(PearlJson.parseToJsonElement(
                """{"id":"L1","sl_no":7,"name":"Asha","phone_e164":"+919845000001","stage":"interested","updated_at":"x"}""",
            ).jsonObject)))
            database.followups().upsert(listOf(followup("F1", "open", "2030-01-10"), followup("F2", "done", "2026-11-01")))
        }
        val sales = SalesRepository(RpcTransport { _, _ -> throw RpcFailure.Transient("offline") }, database, OutboxWriter(database.outbox()))
        compose.setContent { PearlTheme { LeadDetailScreen("L1", sales, library, onBack = {}, onBook = {}, onOpenFollowup = { opened = it }) } }
        compose.waitUntil(5_000) { exists(hasTestTag("lead-task-F2")) }
        compose.onNodeWithTag("lead-task-F2").performScrollTo().performClick()
        assertNull(opened) // a done one stays put
        compose.onNodeWithTag("lead-task-F1").performScrollTo().performClick()
        assertEquals("F1", opened)
    }

    @Test
    fun theFollowupsTabPinsTheOneOpenedFromTheLeadEvenWhenItIsWeeksAway() {
        var cleared = false
        val database = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), AppDatabase::class.java)
            .allowMainThreadQueries().build()
        db = database
        val far = istToday().plusDays(20).toString()
        runBlocking {
            database.leads().upsert(listOf(LeadEntity.fromRow(PearlJson.parseToJsonElement(
                """{"id":"L1","sl_no":7,"name":"Asha","phone_e164":"+919845000001","stage":"interested","updated_at":"x"}""",
            ).jsonObject)))
            database.followups().upsert(listOf(followup("F1", "open", far)))
        }
        val sales = SalesRepository(RpcTransport { _, _ -> error("the list uses the phone database") }, database, OutboxWriter(database.outbox()))
        val focus = mutableStateOf<String?>("F1")
        compose.setContent {
            PearlTheme { FollowupsScreen("me", sales, library, onOpenLead = {}, focusId = focus.value, onClearFocus = { cleared = true; focus.value = null }) }
        }
        compose.waitUntil(5_000) { exists(hasTestTag("task-pinned-F1")) }
        compose.onNodeWithText(text(R.string.followups_from_lead)).assertIsDisplayed()
        compose.onNodeWithText("Asha").assertIsDisplayed()
        compose.onNodeWithTag("pinned-close").performClick()
        compose.waitUntil(5_000) { !exists(hasTestTag("task-pinned-F1")) }
        assertTrue(cleared)
        // 20 days away is outside the usual 7-day list.
        compose.onNodeWithText(text(R.string.followups_empty)).assertIsDisplayed()
    }

    @Test
    fun theLeadPageListsQuotationsAndBookingsCanBeConfirmedMovedAndCancelled() {
        val database = showLead { fn, _ ->
            when (fn) {
                "lead_quotations_list" -> PearlJson.parseToJsonElement("[$quoteJson]")
                else -> throw RpcFailure.Transient("offline")
            }
        }
        runBlocking {
            database.appointments().upsert(listOf(com.pearl.crm.core.data.db.AppointmentEntity.fromRow(PearlJson.parseToJsonElement(
                """{"id":"A1","lead_id":"L1","doctor_id":"D1","doctor":"Dr X","appt_date":"2030-01-16",
                "slot_start":"2030-01-16T05:00:00+00:00","status":"pending","mode":"offline","version":1,"updated_at":"x"}""",
            ).jsonObject)))
        }
        compose.waitUntil(5_000) { exists(hasTestTag("quote-1")) }
        compose.onNodeWithText(text(R.string.quote_row, 1, "₹3,000.00")).performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("quote-share-1").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("quote-text-1").assertIsDisplayed()

        compose.waitUntil(5_000) { exists(hasTestTag("booking-reschedule-A1")) }
        compose.onNodeWithTag("booking-reschedule-A1").performScrollTo().performClick()
        assertEquals("A1", rescheduled)

        // Cancel asks for a reason first.
        compose.onNodeWithTag("booking-cancel-A1").performScrollTo().performClick()
        compose.onNodeWithTag("cancel-booking-save").performClick()
        compose.onNodeWithText(text(R.string.booking_cancel_reason_required)).assertIsDisplayed()
        compose.onNodeWithTag("cancel-reason").performTextInput("Coming next month")
        compose.onNodeWithTag("cancel-booking-save").performClick()
        compose.waitUntil(5_000) { queuedRpcs(database).contains("set_appointment_status") }
        compose.waitUntil(5_000) { !exists(hasTestTag("booking-cancel-A1")) }
    }

    @Test
    fun changeTimeOnTheLeadPageQueuesTheNewNextCall() {
        val database = showLead { fn, _ -> if (fn == "lead_quotations_list") PearlJson.parseToJsonElement("[]") else throw RpcFailure.Transient("offline") }
        compose.onNodeWithTag("next-call-change").performScrollTo().performClick()
        compose.onNodeWithTag("next-call-10:00").performScrollTo().performClick()
        compose.onNodeWithTag("next-call-save").performClick()
        compose.waitUntil(5_000) { queuedRpcs(database) == listOf("set_lead_next_call") }
        assertTrue(runBlocking { database.leads().get("L1")!!.nextFollowupAt } != null)
    }

    @Test
    fun aQuotationIsCheckedOnThePhoneThenSavedWithThePriceListPrice() {
        val sent = mutableListOf<JsonObject>()
        val database = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), AppDatabase::class.java)
            .allowMainThreadQueries().build()
        db = database
        val sales = SalesRepository(RpcTransport { fn, args ->
            assertEquals("save_lead_quotation", fn)
            sent += args
            PearlJson.parseToJsonElement(quoteJson)
        }, database, OutboxWriter(database.outbox()))
        val priced = object : LibrarySource {
            override suspend fun search(kind: String, query: String, cursor: String?, limit: Int) = LibraryPage(
                listOf(LibraryItem("T1", "PRP", defaults = PearlJson.parseToJsonElement("""{"price_paise":150000}""").jsonObject)),
            )
            override suspend fun create(kind: String, label: String, defaults: JsonObject) = LibraryItem("new", label)
        }
        var saved: String? = null
        compose.setContent { PearlTheme { QuotationScreen("L1", "Asha", sales, priced, onBack = {}, onSaved = { saved = it }) } }

        compose.onNodeWithTag("quote-save").performClick()
        compose.onNodeWithTag("quote-no-lines").assertIsDisplayed()
        assertTrue(sent.isEmpty())

        compose.onNodeWithTag("quote-pick").performClick()
        compose.onNodeWithText("PRP").performClick()
        compose.onNodeWithTag("quote-price-0").assertIsDisplayed()
        compose.onNodeWithTag("quote-total").assertTextEquals("₹1,500.00")
        compose.onNodeWithTag("quote-discount").performScrollTo().performTextInput("99999")
        compose.onNodeWithTag("quote-save").performClick()
        compose.onNodeWithText(text(R.string.quote_discount_too_big)).assertExists()
        assertTrue(sent.isEmpty())

        compose.onNodeWithTag("quote-discount").performTextClearance()
        compose.onNodeWithTag("quote-discount").performTextInput("100")
        compose.onNodeWithTag("quote-save").performClick()
        // (Checking the screen each time keeps it running while the save comes back.)
        compose.waitUntil(5_000) { saved != null || exists(hasTestTag("quote-failure")) }
        assertFalse(exists(hasTestTag("quote-failure")))
        assertEquals(text(R.string.quote_saved), saved)
        val quote = sent.single().getValue("p_quote").jsonObject
        assertEquals("150000", quote.getValue("items").jsonArray.single().jsonObject.getValue("price_paise").toString())
        assertEquals("10000", quote.getValue("discount_paise").toString())
    }

    @Test
    fun theLeadPageShowsTheSalesSheetColumnsFromTheServer() {
        showLead { fn, _ ->
            if (fn == "lead_quotations_list") return@showLead PearlJson.parseToJsonElement("[]")
            assertEquals("lead_sheet_row", fn)
            PearlJson.parseToJsonElement(
                """{"id":"L1","source_label":"Instagram","assigned_name":"Priya","doctor_name":"Dr Rao","amount_quoted_paise":6000000,
                "amount_finalised_paise":5500000,"amount_locked":false,"surgery_date":"2026-11-27","comments1":"Wants EMI",
                "consult":{"at":"2026-11-20T05:30:00+00:00","date":"2026-11-20","status":"confirmed","doctor":"Dr Rao"},
                "followups":[{"at":"2026-11-17T04:30:00+00:00","outcome":"connected","by":"Priya","notes":null}],"calls_total":1}""",
            )
        }
        compose.waitUntil(5_000) { exists(hasText("Instagram")) }
        compose.onNodeWithText("20/11/2026 11:00 AM · Dr Rao · Confirmed").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Quoted ₹60,000.00 → Final ₹55,000.00").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("27/11/2026").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("17/11/2026 10:00 AM · Spoke · Priya").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(text(R.string.sheet_followup, 3)).performScrollTo().assertIsDisplayed()
        assertFalse(exists(hasText(text(R.string.sheet_offline))))
    }

    @Test
    fun offlineTheSheetShowsWhatThePhoneHasAndSaysTheRestNeedsTheConnection() {
        showLead { _, _ -> throw RpcFailure.Transient("offline") }
        compose.waitUntil(5_000) { exists(hasText(text(R.string.sheet_offline))) }
        compose.onNodeWithText("Quoted ₹60,000.00").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Wants EMI").performScrollTo().assertIsDisplayed()
        assertFalse(exists(hasText(text(R.string.sheet_followup, 1))))
    }
}
