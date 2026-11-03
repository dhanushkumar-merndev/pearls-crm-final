package com.pearl.crm.e2e

import android.Manifest
import android.content.ContentValues
import android.provider.MediaStore
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Until
import com.pearl.crm.MainActivity
import com.pearl.crm.R
import com.pearl.crm.calls.AfterCallRequest
import com.pearl.crm.core.data.RecordingStatus
import com.pearl.crm.core.model.IstDates
import com.pearl.crm.core.model.LeadStage
import com.pearl.crm.core.model.LibraryKind
import com.pearl.crm.e2e.Phone.c
import com.pearl.crm.e2e.Phone.text
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.regex.Pattern
import com.pearl.crm.feature.sales.R as SalesR
import com.pearl.crm.feature.settings.R as SettingsR

/**
 * A-SAL-31: a lead lost on a call → one tap uploads the dialer's recording of that call.
 * The recordings folder is chosen in the phone's own picker, which opens on Recordings → Call by
 * itself. The tap comes before the dialer has written its file (as on a real phone); the file
 * then turns up and is uploaded without anything else to do. Emulator: the "dialer file" is a
 * 30-second test clip copied into Recordings/Call with a Samsung/Realme-style name.
 *
 * Uses a lead e2e_sales already has (no new lead: staging can send a WhatsApp welcome to a new one).
 */
@RunWith(AndroidJUnit4::class)
class LostCallRecordingTest {
    @get:Rule(order = 0)
    val compose = createAndroidComposeRule<MainActivity>()

    @get:Rule(order = 1)
    val capture = FailureCapture(compose)

    @Test
    fun aLostLeadsCallRecordingUploadsWithOneTap() {
        Phone.grant(Manifest.permission.POST_NOTIFICATIONS, Manifest.permission.READ_PHONE_STATE, Manifest.permission.READ_CALL_LOG)
        Phone.shell("mkdir -p $DIALER_DIR")
        c.settings.recordingFolder = null
        c.settings.callUploadRequests = emptySet()
        Phone.signedIn(Phone.SALES)
        compose.waitForText(text(R.string.tab_my_day))
        Phone.sentAll()

        val lead = runBlocking {
            c.db.leads().observeList(true, emptyList(), null, "E2E", System.currentTimeMillis(), 50).first()
                .firstOrNull { it.phoneE164 != null }
        }
        Phone.skipUnless(lead != null, "e2e_sales has no E2E lead on this phone yet (run SalesFlowTest once)")
        val phone = lead!!.phoneE164!!

        // 1. Settings → Calls and recordings → Recordings folder: the picker opens on Recordings/Call.
        compose.button(text(R.string.tab_settings)).performClick()
        compose.button(text(SettingsR.string.settings_call_setup)).performScrollTo().performClick()
        compose.waitForText(text(SalesR.string.setup_title))
        compose.onNode(hasText(text(SalesR.string.setup_fix)) and hasAnyAncestor(hasTestTag("setup-folder"))).performScrollTo().performClick()
        val useFolder = Phone.device.wait(Until.findObject(By.text(Pattern.compile("(?i)use this folder"))), 15_000)
        assertNotNull("the folder picker opened", useFolder)
        assertTrue("it opened on the Call folder", Phone.device.hasObject(By.text("Call")))
        useFolder.click()
        Phone.device.wait(Until.findObject(By.text(Pattern.compile("(?i)allow"))), 10_000)?.click()
        compose.waitUntil(15_000) { c.settings.recordingFolder?.contains("Recordings%2FCall") == true }
        compose.waitForText(text(SalesR.string.setup_done))
        Phone.device.pressBack()

        // 2. A call just ended: Connected → Lost → reason → Upload call recording → Save.
        val startedAt = System.currentTimeMillis() - 45_000
        c.pendingAfterCall.value = AfterCallRequest(lead.id, phone, startedAt, 30, "outgoing", null)
        compose.waitForText(text(SalesR.string.notes_title))
        compose.onNodeWithTag("outcome-connected").performScrollTo().performClick()
        compose.onNodeWithTag("stage-${LeadStage.LOST}").performScrollTo().performClick()
        val reason = runBlocking { c.library.search(LibraryKind.LOST_REASON, "", null, 5).items.first().label }
        compose.onNodeWithTag("lost-reason").performScrollTo().performClick()
        compose.waitForText(reason)
        compose.onNodeWithText(reason).performClick()
        compose.onNodeWithTag("upload-call-recording").performScrollTo().performClick()
        compose.onNodeWithText(text(SalesR.string.notes_recording_will_upload)).assertExists()
        compose.onNodeWithTag("save-notes").performScrollTo().performClick()
        compose.waitUntil(10_000) { c.pendingAfterCall.value == null }
        Phone.sentAll()
        assertEquals("waiting for the dialer's file", 1, c.settings.callUploadRequests.size)

        // 3. The dialer writes its recording a little later (into Recordings/Call, through the media store).
        val name = "Call recording ${spaced(phone)}_${NAME_TIME.format(Instant.ofEpochMilli(startedAt))}.m4a"
        val resolver = Phone.app.contentResolver
        val fileUri = resolver.insert(
            MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY),
            ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                put(MediaStore.MediaColumns.MIME_TYPE, "audio/mp4")
                put(MediaStore.MediaColumns.RELATIVE_PATH, "Recordings/Call/")
            },
        )
        assertNotNull("the test recording was written", fileUri)
        try {
            resolver.openOutputStream(fileUri!!)!!.use { out ->
                InstrumentationRegistry.getInstrumentation().context.assets.open("call-30s.m4a").use { it.copyTo(out) }
            }
            uploadsWithoutAnotherTap(name, lead.id)
        } finally {
            resolver.delete(fileUri!!, null, null)
        }
    }

    private fun uploadsWithoutAnotherTap(name: String, leadId: String) {
        // 4. The next look at the folder finds it, matches the call and uploads it; nothing to tap.
        val deadline = System.currentTimeMillis() + 120_000
        var done = false
        while (!done && System.currentTimeMillis() < deadline) {
            runBlocking {
                c.runRecordings()
                Phone.sentAll()
                c.runRecordings()
            }
            done = runBlocking { c.recordings.observe().first().any { it.recording.fileName == name && it.recording.status == RecordingStatus.SYNCED } }
            if (!done) Thread.sleep(3_000)
        }
        if (!done) {
            val why = runBlocking {
                val recs = c.recordings.observe().first().joinToString { "${it.recording.fileName}=${it.recording.status}/${it.recording.error}" }
                val calls = c.sales.observeLeadCalls(leadId).first().take(3).joinToString { "${it.startedAt}/${it.durationS}s/${it.phoneE164}" }
                val files = c.settings.recordingFolder?.let { f ->
                    com.pearl.crm.core.data.device.SafRecordingFolder(Phone.app, android.net.Uri.parse(f)).list(0).joinToString { "${it.name}@${it.lastModified}" }
                }
                "recordings: [$recs] calls: [$calls] files: [$files] requests: ${c.settings.callUploadRequests} folder: ${c.settings.recordingFolder}"
            }
            android.util.Log.e("PearlLostRec", why)
            throw AssertionError("not uploaded: $why")
        }
        val rec = runBlocking { c.recordings.observe().first().first { it.recording.fileName == name }.recording }
        assertEquals(leadId, rec.leadId)
        assertNotNull("stored on the server", rec.fileId)
        assertTrue("the request is used up", c.settings.callUploadRequests.isEmpty())

        // The phone's list shows it as uploaded.
        compose.button(text(SettingsR.string.settings_recordings)).performScrollTo().performClick()
        compose.waitForText(text(SalesR.string.rec_status_synced))
        Thread.sleep(VIEW_PAUSE_MS) // headed run: leave it on screen a moment
    }

    private fun spaced(e164: String): String = "+91 ${e164.takeLast(10).take(5)} ${e164.takeLast(5)}"

    companion object {
        private const val DIALER_DIR = "/sdcard/Recordings/Call"
        private const val VIEW_PAUSE_MS = 3_000L
        private val NAME_TIME: DateTimeFormatter = DateTimeFormatter.ofPattern("yyMMdd_HHmmss").withZone(IstDates.ZONE)
    }
}
