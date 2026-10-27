package com.pearl.crm.feature.sales

import android.content.Context
import androidx.annotation.StringRes
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pearl.crm.core.data.OutboxWriter
import com.pearl.crm.core.data.SalesRepository
import com.pearl.crm.core.data.db.AppDatabase
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
import org.junit.After
import org.junit.Assert.assertEquals
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

    private fun text(@StringRes id: Int, vararg args: Any) = ApplicationProvider.getApplicationContext<Context>().getString(id, *args)

    private fun exists(matcher: SemanticsMatcher) = compose.onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty()

    @After
    fun close() {
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
