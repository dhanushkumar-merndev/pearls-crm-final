package com.pearl.crm.e2e

import android.Manifest
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextReplacement
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Until
import com.pearl.crm.MainActivity
import com.pearl.crm.R
import com.pearl.crm.calls.CallStateReceiver
import com.pearl.crm.core.model.CallTracker
import com.pearl.crm.e2e.Phone.c
import com.pearl.crm.e2e.Phone.text
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import com.pearl.crm.feature.sales.R as SalesR

/**
 * A-SAL-20…25: the caller pop-up and the notes after a call, with the phone's call states
 * simulated (only the system may send the real ones; RealCallTest makes a real call).
 */
@RunWith(AndroidJUnit4::class)
class CallerTest {
    @get:Rule(order = 0)
    val compose = createAndroidComposeRule<MainActivity>()

    @get:Rule(order = 1)
    val capture = FailureCapture(compose)

    private val bubble get() = By.desc(text(R.string.caller_bubble_description))

    @Before
    fun setUp() {
        Phone.grant(Manifest.permission.POST_NOTIFICATIONS, Manifest.permission.READ_PHONE_STATE, Manifest.permission.READ_CALL_LOG)
        Phone.shell("appops set ${Phone.app.packageName} SYSTEM_ALERT_WINDOW allow")
        Phone.signedIn("sales")
        c.settings.callerPopup = true
        compose.waitForText(text(R.string.tab_my_day))
    }

    @After
    fun hangUp() {
        // Never leave a call "in progress" for the next test.
        runBlocking { CallStateReceiver().handle(Phone.app, CallTracker.IDLE, null)?.join() }
        c.pendingAfterCall.value = null
        c.settings.callerPopup = true
        Phone.shell("appops set ${Phone.app.packageName} SYSTEM_ALERT_WINDOW allow")
    }

    private fun phoneSays(state: String, number: String?) = runBlocking {
        CallStateReceiver().handle(Phone.app, state, number)?.join()
    }

    /** A lead on the server whose number the phone knows (crm_numbers synced). */
    private fun knownLead(name: String): Pair<String, String> {
        val lead = Phone.leadOnServer(name)
        compose.waitUntil(60_000) {
            runBlocking {
                c.syncRunner.runOnce()
                c.db.crmNumbers().card(lead.second) != null
            }
        }
        return lead
    }

    @Test
    fun aCallWithAKnownLeadShowsTheBubbleThenAsksForNotes() {
        val name = "E2E Caller ${System.currentTimeMillis()}"
        val (id, phone) = knownLead(name)

        // Outgoing call: off the hook, with the number.
        phoneSays(CallTracker.OFFHOOK, "+91$phone")
        assertTrue("the bubble shows", Phone.device.wait(Until.hasObject(bubble), 10_000))
        assertTrue("with the lead's name", Phone.device.hasObject(By.text(name)))

        phoneSays(CallTracker.IDLE, null)
        assertTrue("the bubble goes", Phone.device.wait(Until.gone(bubble), 10_000))
        // The notes sheet opens over the app.
        compose.waitForText(text(SalesR.string.notes_title))
        compose.onNodeWithTag("save-notes").performScrollTo().performClick()
        compose.waitForText(text(SalesR.string.notes_outcome_required))
        compose.onNodeWithTag("outcome-connected").performScrollTo().performClick()
        compose.onNodeWithTag("notes").performScrollTo().performTextReplacement("E2E simulated call")
        compose.onNodeWithTag("save-notes").performScrollTo().performClick()
        compose.waitUntil(10_000) { c.pendingAfterCall.value == null }

        Phone.sentAll()
        val calls = runBlocking { c.sales.observeLeadCalls(id).first() }
        assertEquals(1, calls.size)
        assertEquals("outgoing", calls.single().direction)
    }

    @Test
    fun anIncomingCallRingsWithTheBubbleAndAMissedCallStillAsksForNotes() {
        val name = "E2E Ringing ${System.currentTimeMillis()}"
        val (_, phone) = knownLead(name)
        // Android sends RINGING twice: first without the number, then with it.
        phoneSays(CallTracker.RINGING, null)
        phoneSays(CallTracker.RINGING, "0$phone")
        assertTrue(Phone.device.wait(Until.hasObject(bubble), 10_000))
        phoneSays(CallTracker.IDLE, null)
        compose.waitUntil(15_000) { c.pendingAfterCall.value != null }
        assertEquals("missed", c.pendingAfterCall.value?.direction)
        assertEquals(0, c.pendingAfterCall.value?.durationS)
    }

    @Test
    fun aNumberTheCrmDoesNotKnowIsLeftAlone() {
        phoneSays(CallTracker.OFFHOOK, "+91${Phone.uniquePhone()}")
        assertFalse("no bubble", Phone.device.wait(Until.hasObject(bubble), 5_000))
        phoneSays(CallTracker.IDLE, null)
        Thread.sleep(3_000)
        assertNull("no notes asked", c.pendingAfterCall.value)
    }

    @Test
    fun withThePopUpSwitchedOffNothingIsShown() {
        val (_, phone) = knownLead("E2E Popup Off ${System.currentTimeMillis()}")
        c.settings.callerPopup = false
        phoneSays(CallTracker.OFFHOOK, "+91$phone")
        assertFalse(Phone.device.wait(Until.hasObject(bubble), 5_000))
        phoneSays(CallTracker.IDLE, null)
        Thread.sleep(3_000)
        assertNull(c.pendingAfterCall.value)
    }

    @Test
    fun withoutDrawOverAppsTheNotesComeAsANotification() {
        val name = "E2E No Overlay ${System.currentTimeMillis()}"
        val (_, phone) = knownLead(name)
        Phone.shell("appops set ${Phone.app.packageName} SYSTEM_ALERT_WINDOW deny")
        phoneSays(CallTracker.OFFHOOK, "+91$phone")
        assertFalse("no bubble without the permission", Phone.device.wait(Until.hasObject(bubble), 4_000))
        phoneSays(CallTracker.IDLE, null)
        Phone.device.openNotification()
        try {
            assertTrue(Phone.device.wait(Until.hasObject(By.text(text(R.string.calls_notes_title))), 15_000))
            Phone.device.findObject(By.text(text(R.string.calls_notes_title))).click()
            compose.waitForText(text(SalesR.string.notes_title))
        } finally {
            Phone.device.pressBack()
        }
    }
}
