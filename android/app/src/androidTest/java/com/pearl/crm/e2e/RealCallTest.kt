package com.pearl.crm.e2e

import android.Manifest
import android.telephony.TelephonyManager
import android.util.Log
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
import com.pearl.crm.core.model.Phones
import com.pearl.crm.e2e.Phone.c
import com.pearl.crm.e2e.Phone.text
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import com.pearl.crm.feature.sales.R as SalesR

/**
 * A-SAL-30: one real call, opt-in (`pnpm phone:test --real-call`). The phone dials the number in
 * PHONE_TEST_CALL_NUMBER (.env, never committed); a person answers it. Checks the bubble during
 * the call, then the notes sheet with the call's real length from the call log, and that the
 * call is saved once (the call-log import doesn't add it again).
 */
@RunWith(AndroidJUnit4::class)
class RealCallTest {
    @get:Rule(order = 0)
    val compose = createAndroidComposeRule<MainActivity>()

    @get:Rule(order = 1)
    val capture = FailureCapture(compose)

    private val telephony get() = Phone.app.getSystemService(TelephonyManager::class.java)

    @Suppress("DEPRECATION") // callState: the app holds READ_PHONE_STATE
    private fun inCall() = telephony.callState != TelephonyManager.CALL_STATE_IDLE

    @Test
    fun aRealCallShowsTheBubbleThenTheNotesWithItsRealLength() {
        val number = Phone.arg("realCallNumber")
        Phone.skipUnless(number != null, "real call is opt-in: pnpm phone:test --real-call")
        val dialled = Phones.normalize(number!!) ?: error("PHONE_TEST_CALL_NUMBER is not a valid mobile number")

        Phone.grant(Manifest.permission.POST_NOTIFICATIONS, Manifest.permission.READ_PHONE_STATE, Manifest.permission.READ_CALL_LOG)
        Phone.shell("appops set ${Phone.app.packageName} SYSTEM_ALERT_WINDOW allow")
        Phone.signedIn("sales")
        c.settings.callerPopup = true
        compose.waitForText(text(R.string.tab_my_day))

        // The number as a lead (made once; later runs find it).
        val leadId = runBlocking { c.sales.findByPhone(dialled.e164)?.id }
            ?: Phone.serverLeads(dialled.last10).firstOrNull()?.get("id")?.jsonPrimitive?.content
            ?: Phone.leadOnServer("E2E Real Call", dialled.last10).first
        compose.waitUntil(60_000) {
            runBlocking {
                c.syncRunner.runOnce()
                c.db.crmNumbers().card(dialled.last10) != null
            }
        }
        val callsBefore = runBlocking { c.sales.observeLeadCalls(leadId).first().size }

        Log.i(TAG, "Dialling now: answer the other phone and stay on the line for about 20 seconds.")
        Phone.shell("am start -a android.intent.action.CALL -d tel:${dialled.e164}")
        assertTrue("the CRM bubble shows during the call", Phone.device.wait(Until.hasObject(By.desc(text(R.string.caller_bubble_description))), 30_000))

        // Let it ring and be answered, talk ~20 s, then hang up (or wait for a person to).
        Thread.sleep(30_000)
        Phone.shell("input keyevent KEYCODE_ENDCALL")
        val deadline = System.currentTimeMillis() + 60_000
        while (inCall() && System.currentTimeMillis() < deadline) Thread.sleep(1_000)

        // After the call: the notes sheet, with the length and key from the phone's call log.
        compose.waitUntil(30_000) { c.pendingAfterCall.value != null }
        val request = c.pendingAfterCall.value!!
        assertEquals("outgoing", request.direction)
        assertNotNull("matched to the phone's call log", request.deviceCallKey)
        assertTrue("the call was answered (length ${request.durationS} s)", request.durationS > 0)

        compose.waitForText(text(SalesR.string.notes_title))
        compose.onNodeWithTag("outcome-connected").performScrollTo().performClick()
        compose.onNodeWithTag("notes").performScrollTo().performTextReplacement("E2E real call test")
        compose.onNodeWithTag("save-notes").performScrollTo().performClick()
        compose.waitUntil(10_000) { c.pendingAfterCall.value == null }
        Phone.sentAll()

        // The call-log import sees the same call: still one new call on the lead.
        runBlocking { c.runRecordings() }
        Phone.sentAll()
        val calls = runBlocking { c.sales.observeLeadCalls(leadId).first() }
        assertEquals(callsBefore + 1, calls.size)
        assertEquals(request.durationS, calls.maxBy { it.startedAt }.durationS)
    }

    companion object {
        private const val TAG = "PearlRealCall"
    }
}
