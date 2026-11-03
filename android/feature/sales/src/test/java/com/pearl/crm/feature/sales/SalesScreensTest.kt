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
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.hasScrollToIndexAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToIndex
import androidx.compose.ui.test.performTextInput
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
}
