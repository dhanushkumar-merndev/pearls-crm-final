package com.pearl.crm.e2e

import android.Manifest
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextReplacement
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pearl.crm.MainActivity
import com.pearl.crm.R
import com.pearl.crm.core.data.net.PearlJson
import com.pearl.crm.e2e.Phone.c
import com.pearl.crm.e2e.Phone.text
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID
import com.pearl.crm.feature.sales.R as SalesR
import com.pearl.crm.feature.settings.R as SettingsR

/** A-SYS-10…14: working with no signal, and changes the server refuses (TEST_CASES.md). */
@RunWith(AndroidJUnit4::class)
class OfflineSyncTest {
    @get:Rule(order = 0)
    val compose = createAndroidComposeRule<MainActivity>()

    @get:Rule(order = 1)
    val capture = FailureCapture(compose)

    @Before
    fun signIn() {
        Phone.grant(Manifest.permission.POST_NOTIFICATIONS)
        Phone.signedIn("sales")
        compose.waitForText(text(R.string.tab_my_day))
    }

    /** Whatever happens in a test, the phone ends up online again. */
    @After
    fun backOnline() = Phone.online(true)

    private fun button(label: Int) = compose.button(text(label))

    @Test
    fun aLeadAndANoteMadeWithNoSignalReachTheServerOnceWhenItIsBack() {
        val name = "E2E Offline ${System.currentTimeMillis()}"
        val phone = Phone.uniquePhone()
        Phone.online(false)

        button(R.string.tab_leads).performClick()
        button(SalesR.string.leads_new).performClick()
        compose.onNodeWithTag("new-lead-name").performTextReplacement(name)
        compose.onNodeWithTag("new-lead-phone").performTextReplacement(phone)
        compose.onNodeWithTag("new-lead-save").performClick()
        compose.waitForText(text(SalesR.string.lead_change_stage))
        button(SalesR.string.lead_add_note).performClick()
        compose.onNodeWithTag("note-text").performTextReplacement("E2E note with no signal")
        button(SalesR.string.lead_note_save).performClick()

        // Kept on the phone, waiting: the lead and its note.
        val lead = runBlocking { c.sales.findByPhone(phone) }
        assertNotNull("the lead is saved on the phone", lead)
        val create = runBlocking { c.db.outbox().get(lead!!.id) }
        assertNotNull("the new lead waits to be sent", create)
        compose.waitUntil(10_000) { runBlocking { c.db.outbox().unsentCount() } >= 2 }
        // Settings says how many changes wait (sync tried and found no connection).
        runBlocking { c.syncRunner.runOnce() }
        compose.onNode(androidx.compose.ui.test.hasContentDescription(text(SalesR.string.back))).performClick()
        button(R.string.tab_settings).performClick()
        compose.waitForText(text(SettingsR.string.settings_offline))
        compose.waitForText(Phone.app.resources.getQuantityString(SettingsR.plurals.settings_unsent, 2, 2).substringBefore("2"), substring = true)

        Phone.online(true)
        Phone.sentAll()
        assertEquals(1, Phone.serverLeadCount(phone))

        // A send whose answer was lost is sent again: the server still keeps one lead.
        runBlocking { Phone.rpc.call(create!!.rpc, PearlJson.parseToJsonElement(create.args).jsonObject) }
        assertEquals(1, Phone.serverLeadCount(phone))
    }

    @Test
    fun aChangeTheServerRefusesIsShownAndCanBeRetriedOrDiscarded() {
        // A note for a lead that doesn't exist: the server refuses it for good.
        val id = UUID.randomUUID().toString()
        runBlocking {
            c.outbox.enqueue(
                "add_lead_note",
                buildJsonObject {
                    put("p_id", UUID.randomUUID().toString())
                    put("p_body", "E2E refused note")
                    put("p_client_id", id)
                },
                "lead:e2e-missing-$id",
                clientId = id,
            )
            c.syncRunner.runOnce()
        }
        assertEquals("failed", runBlocking { c.db.outbox().get(id) }?.state)

        // The banner above the tabs warns; Settings lists it with Retry and Discard.
        compose.waitForText(text(R.string.home_unsent_failed))
        button(R.string.tab_settings).performClick()
        compose.waitForText(text(SettingsR.string.settings_failed_made, "\u0000").substringBefore("\u0000"), substring = true)

        val tappedAt = System.currentTimeMillis()
        button(SettingsR.string.settings_retry).performScrollTo().performClick()
        // Tried again, refused again: "Try again" puts it back in line (attempts start over, due now),
        // the sync sends it and the server refuses it once more.
        compose.waitUntil(30_000) {
            runBlocking { c.db.outbox().get(id) }?.let { it.state == "failed" && it.attempts >= 1 && it.nextAttemptAt >= tappedAt } == true
        }

        button(SettingsR.string.settings_discard).performScrollTo().performClick()
        compose.waitForText(text(SettingsR.string.settings_discard_title))
        // The dialog's own "Discard", the last of the two.
        compose.onAllNodes(hasText(text(SettingsR.string.settings_discard)) and androidx.compose.ui.test.hasClickAction())
            .let { it[it.fetchSemanticsNodes().size - 1] }.performClick()
        compose.waitUntil(10_000) { runBlocking { c.db.outbox().get(id) } == null }
        compose.waitUntil(10_000) { !compose.exists(hasText(text(SettingsR.string.settings_retry))) }
    }

    @Test
    fun syncNowSaysWhenTheLastSyncWas() {
        button(R.string.tab_settings).performClick()
        button(SettingsR.string.settings_sync_now).performScrollTo().performClick()
        compose.waitForText(text(SettingsR.string.settings_last_sync, "\u0000").substringBefore("\u0000"), timeoutMs = 60_000, substring = true)
    }
}
