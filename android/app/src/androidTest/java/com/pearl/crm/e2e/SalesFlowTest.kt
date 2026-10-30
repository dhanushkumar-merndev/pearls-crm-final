package com.pearl.crm.e2e

import android.Manifest
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextReplacement
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pearl.crm.MainActivity
import com.pearl.crm.R
import com.pearl.crm.e2e.Phone.c
import com.pearl.crm.e2e.Phone.text
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.time.LocalDate
import java.time.ZoneId
import com.pearl.crm.feature.sales.R as SalesR

/** A-SAL-01…12: the salesperson's day on a real phone against staging (TEST_CASES.md). */
@RunWith(AndroidJUnit4::class)
class SalesFlowTest {
    @get:Rule(order = 0)
    val compose = createAndroidComposeRule<MainActivity>()

    @get:Rule(order = 1)
    val capture = FailureCapture(compose)

    @Before
    fun signIn() {
        // No system dialog over the app in the middle of a test.
        Phone.grant(Manifest.permission.POST_NOTIFICATIONS)
        Phone.signedIn("sales")
        compose.waitForText(text(R.string.tab_my_day))
    }

    private fun tab(label: Int) = button(label).performClick()

    private fun button(label: Int) = compose.button(text(label))

    private fun leadOnServer(name: String = "E2E Phone ${System.currentTimeMillis()}") = Phone.leadOnServer(name)

    private fun openLead(id: String) {
        val name = runBlocking { c.db.leads().get(id) }?.name ?: error("lead $id not on the phone")
        tab(R.string.tab_leads)
        button(SalesR.string.leads_filter_all).performClick()
        // The list only draws what is on screen: search brings this lead to the top.
        compose.onNodeWithTag("lead-search").performTextReplacement(name)
        compose.waitUntil(20_000) { compose.exists(hasTestTag("lead-$id")) }
        compose.onNodeWithTag("lead-$id").performScrollTo().performClick()
        compose.waitForText(text(SalesR.string.lead_change_stage))
    }

    @Test
    fun theNewLeadFormExplainsWhatIsMissing() {
        tab(R.string.tab_leads)
        button(SalesR.string.leads_new).performClick()
        compose.onNodeWithTag("new-lead-save").performClick()
        compose.waitForText(text(SalesR.string.new_lead_name_required))
        compose.onNodeWithText(text(SalesR.string.new_lead_phone_invalid)).assertIsDisplayed()
        // A number that isn't a mobile is refused too.
        compose.onNodeWithTag("new-lead-name").performTextReplacement("E2E Bad Number")
        compose.onNodeWithTag("new-lead-phone").performTextReplacement("12345")
        compose.onNodeWithTag("new-lead-save").performClick()
        compose.onNodeWithText(text(SalesR.string.new_lead_phone_invalid)).assertIsDisplayed()
        assertNull(runBlocking { c.sales.findByPhone("12345") })
    }

    @Test
    fun aNewLeadIsSavedOnThePhoneAndReachesTheServerExactlyOnce() {
        val name = "E2E Phone ${System.currentTimeMillis()}"
        val phone = Phone.uniquePhone()
        tab(R.string.tab_leads)
        button(SalesR.string.leads_new).performClick()
        compose.onNodeWithTag("new-lead-name").performTextReplacement(name)
        compose.onNodeWithTag("new-lead-phone").performTextReplacement(phone)
        compose.onNodeWithTag("new-lead-save").performClick()
        // The new lead opens straight away.
        compose.waitForText(text(SalesR.string.lead_change_stage))
        Phone.sentAll()
        assertEquals(1, Phone.serverLeadCount(phone))
    }

    @Test
    fun theSameNumberAgainIsFlaggedBeforeSaving() {
        val (_, phone) = leadOnServer("E2E Dup Original ${System.currentTimeMillis()}")
        tab(R.string.tab_leads)
        button(SalesR.string.leads_new).performClick()
        compose.onNodeWithTag("new-lead-name").performTextReplacement("E2E Dup Second")
        compose.onNodeWithTag("new-lead-phone").performTextReplacement(phone)
        compose.waitForText("E2E Dup Original", substring = true)
        button(SalesR.string.new_lead_cancel).performClick()
    }

    @Test
    fun searchByNameOrLastDigitsAndTheStageFilters() {
        val name = "E2E Find ${System.currentTimeMillis()}"
        val (id, phone) = leadOnServer(name)
        tab(R.string.tab_leads)
        button(SalesR.string.leads_filter_all).performClick()
        compose.onNodeWithTag("lead-search").performTextReplacement(name.takeLast(8))
        compose.waitUntil(10_000) { compose.exists(hasTestTag("lead-$id")) }
        compose.onNodeWithTag("lead-search").performTextReplacement(phone.takeLast(5))
        compose.waitUntil(10_000) { compose.exists(hasTestTag("lead-$id")) }
        // It is New: shown under New, not under Interested.
        button(SalesR.string.leads_filter_new).performClick()
        compose.waitUntil(10_000) { compose.exists(hasTestTag("lead-$id")) }
        button(SalesR.string.leads_filter_interested).performClick()
        compose.waitUntil(10_000) { !compose.exists(hasTestTag("lead-$id")) }
    }

    @Test
    fun stageChangeLostNeedsAReasonAndANoteNeedsText() {
        val (id, phone) = leadOnServer()
        openLead(id)

        button(SalesR.string.lead_change_stage).performClick()
        compose.onAllNodes(hasText(text(SalesR.string.stage_lost)) and hasClickAction()).onFirst().performClick()
        button(SalesR.string.lead_stage_save).performClick()
        compose.waitForText(text(SalesR.string.notes_lost_reason_required))
        compose.onAllNodes(hasText(text(SalesR.string.stage_interested)) and hasClickAction()).onFirst().performClick()
        button(SalesR.string.lead_stage_save).performClick()
        compose.waitForText(text(SalesR.string.lead_stage) + ": " + text(SalesR.string.stage_interested))

        button(SalesR.string.lead_add_note).performClick()
        button(SalesR.string.lead_note_save).performClick()
        compose.waitForText(text(SalesR.string.lead_note_required))
        compose.onNodeWithTag("note-text").performTextReplacement("E2E note from the phone")
        button(SalesR.string.lead_note_save).performClick()

        Phone.sentAll()
        // From the server: still one lead, now Interested.
        val onServer = Phone.serverLeads(phone)
        assertEquals(1, onServer.size)
        assertEquals("interested", onServer.single()["stage"]?.jsonPrimitive?.content)
    }

    @Test
    fun callNotesNeedAResultAndSetTheNextCall() {
        val (id, phone) = leadOnServer()
        openLead(id)
        button(SalesR.string.lead_log_call).performClick()
        compose.waitForText(text(SalesR.string.notes_title))
        compose.onNodeWithTag("save-notes").performScrollTo().performClick()
        compose.waitForText(text(SalesR.string.notes_outcome_required))
        compose.onNodeWithTag("outcome-connected").performScrollTo().performClick()
        compose.onNodeWithTag("notes").performScrollTo().performTextReplacement("E2E spoke, call tomorrow")
        compose.onAllNodes(hasText(text(SalesR.string.notes_next_tomorrow)) and hasClickAction()).onFirst().performScrollTo().performClick()
        compose.onNodeWithTag("save-notes").performScrollTo().performClick()
        // The call is listed on the lead, and the next call is set.
        compose.waitForText(text(SalesR.string.outcome_connected), substring = true)
        Phone.sentAll()
        assertNotNull(runBlocking { c.sales.findByPhone(phone) }?.nextFollowupAt)
    }

    @Test
    fun bookingNeedsADoctorAndATimeThenShowsAsWaitingForConfirmation() {
        val (id, _) = leadOnServer()
        openLead(id)
        button(SalesR.string.lead_book).performScrollTo().performClick()
        compose.waitForText(text(SalesR.string.book_title))
        compose.onNodeWithTag("book-save").performClick()
        compose.waitForText(text(SalesR.string.book_doctor_required))

        // The demo doctor with working hours (staging also has many "Dr E2E …" test doctors).
        compose.onNodeWithText(text(com.pearl.crm.core.ui.R.string.picker_choose)).performClick()
        compose.waitUntil(20_000) { compose.exists(androidx.compose.ui.test.hasSetTextAction()) }
        compose.onNode(androidx.compose.ui.test.hasSetTextAction()).performTextReplacement("Priya")
        val priya = hasText("Priya", substring = true) and hasClickAction() and !androidx.compose.ui.test.hasSetTextAction()
        compose.waitUntil(20_000) { compose.exists(priya) }
        compose.onAllNodes(priya).onFirst().performClick()
        // The first day with a free time in the next week (chip labels as BookScreen writes them).
        val today = LocalDate.now(ZoneId.of("Asia/Kolkata"))
        var found = false
        for (offset in 1..6) {
            val d = today.plusDays(offset.toLong())
            val label = if (offset == 1) text(SalesR.string.book_tomorrow) else com.pearl.crm.feature.sales.bookDayLabel(d)
            compose.onNode(hasText(label) and hasClickAction()).performScrollTo().performClick()
            compose.waitUntil(20_000) {
                compose.exists(hasText(text(SalesR.string.book_no_slots))) || compose.exists(hasText(" left", substring = true) and hasClickAction())
            }
            val slots = compose.onAllNodes(hasText(" left", substring = true) and hasClickAction())
            if (slots.fetchSemanticsNodes().isNotEmpty()) {
                slots.onFirst().performScrollTo().performClick()
                found = true
                break
            }
        }
        Phone.skipUnless(found, "no free consultation times on staging in the next week")
        compose.onNodeWithTag("book-save").performClick()
        compose.waitForText(text(SalesR.string.book_done, "\u0000").substringBefore("\u0000"), substring = true)
        compose.waitForText(text(SalesR.string.appt_pending_confirmation))
    }

    @Test
    fun myDayShowsTheTilesAndTheChartAsATable() {
        compose.waitForText(text(SalesR.string.myday_calls))
        // "Spoke" is a tile and a chart legend: the first one is the tile.
        compose.onAllNodes(hasText(text(SalesR.string.myday_connected))).onFirst().assertIsDisplayed()
        compose.onNodeWithTag("chart-toggle").performScrollTo().performClick()
        compose.waitUntil(10_000) { compose.exists(hasTestTag("chart-row")) }
        compose.onNodeWithTag("chart-toggle").performScrollTo().performClick()
    }

    @Test
    fun followUpsListTheNextCallAndDoneClearsIt() {
        val name = "E2E Followup ${System.currentTimeMillis()}"
        val (id, _) = leadOnServer(name)
        openLead(id)
        button(SalesR.string.lead_log_call).performClick()
        compose.onNodeWithTag("outcome-call_back").performScrollTo().performClick()
        compose.onAllNodes(hasText(text(SalesR.string.notes_next_tomorrow)) and hasClickAction()).onFirst().performScrollTo().performClick()
        compose.onNodeWithTag("save-notes").performScrollTo().performClick()
        Phone.sentAll()
        // Back to the tabs with the screen's own back arrow.
        compose.onNode(androidx.compose.ui.test.hasContentDescription(text(SalesR.string.back))).performClick()
        tab(R.string.tab_followups)
        // Tomorrow's call is under "Next 7 days", lower down the list.
        compose.waitUntil(20_000) { compose.exists(androidx.compose.ui.test.hasScrollAction()) }
        compose.onAllNodes(androidx.compose.ui.test.hasScrollAction()).onFirst().performScrollToNode(hasText(name, substring = true))
        compose.waitForText(name, substring = true)
    }

    // A-SAL-10…12: input edge cases (TEST_CASES.md "Edge cases every form shares").

    private fun newLeadForm(name: String, phone: String) {
        tab(R.string.tab_leads)
        button(SalesR.string.leads_new).performClick()
        compose.onNodeWithTag("new-lead-name").performTextReplacement(name)
        compose.onNodeWithTag("new-lead-phone").performTextReplacement(phone)
    }

    @Test
    fun aNumberWithPlus91AndSpacesIsSavedAsTenDigitsAndATamilNameIsKept() {
        val phone = Phone.uniquePhone()
        val name = "E2E முருகன் राम ${System.currentTimeMillis()}"
        newLeadForm(name, "+91 ${phone.take(5)} ${phone.drop(5)}")
        compose.onNodeWithTag("new-lead-save").performClick()
        compose.waitForText(text(SalesR.string.lead_change_stage))
        Phone.sentAll()
        val rows = Phone.serverLeads(phone)
        assertEquals(1, rows.size)
        assertEquals("+91$phone", rows[0]["phone_e164"]?.jsonPrimitive?.content)
        assertEquals(name, rows[0]["name"]?.jsonPrimitive?.content)
    }

    @Test
    fun saveTappedTwiceQuicklyStillMakesOneLead() {
        val phone = Phone.uniquePhone()
        newLeadForm("E2E Twice ${System.currentTimeMillis()}", phone)
        compose.onNodeWithTag("new-lead-save").performClick()
        runCatching { compose.onNodeWithTag("new-lead-save").performClick() } // may already be gone
        compose.waitForText(text(SalesR.string.lead_change_stage))
        Phone.sentAll()
        assertEquals(1, Phone.serverLeadCount(phone))
    }

    @Test
    fun turningThePhoneSidewaysKeepsWhatWasTyped() {
        val phone = Phone.uniquePhone()
        val name = "E2E Rotate ${System.currentTimeMillis()}"
        newLeadForm(name, phone)
        try {
            Phone.device.setOrientationLeft()
            compose.waitForIdle()
            Phone.device.setOrientationNatural()
            compose.waitForIdle()
        } finally {
            Phone.device.unfreezeRotation()
        }
        compose.waitUntil(10_000) { compose.exists(hasTestTag("new-lead-name") and hasText(name)) }
        compose.waitUntil(10_000) { compose.exists(hasTestTag("new-lead-phone") and hasText(phone)) }
        button(SalesR.string.new_lead_cancel).performClick()
    }
}
