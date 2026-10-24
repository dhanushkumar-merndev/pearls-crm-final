package com.pearl.crm.feature.sales

import android.content.Context
import androidx.annotation.StringRes
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pearl.crm.core.data.AudioProcessor
import com.pearl.crm.core.data.OutboxWriter
import com.pearl.crm.core.data.RecordingsRepository
import com.pearl.crm.core.data.SettingsStore
import com.pearl.crm.core.data.db.AppDatabase
import com.pearl.crm.core.data.db.RecordingEntity
import com.pearl.crm.core.data.net.FileUploader
import com.pearl.crm.core.model.RpcTransport
import com.pearl.crm.core.model.UploadPlan
import com.pearl.crm.core.ui.theme.PearlTheme
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonNull
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class RecordingsScreensTest {
    @get:Rule
    val compose = createComposeRule()

    private lateinit var db: AppDatabase
    private lateinit var settings: SettingsStore
    private lateinit var repo: RecordingsRepository

    private fun text(@StringRes id: Int, vararg args: Any) = ApplicationProvider.getApplicationContext<Context>().getString(id, *args)

    @Before
    fun open() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).allowMainThreadQueries().build()
        settings = SettingsStore(context.getSharedPreferences("screens-test", Context.MODE_PRIVATE))
        val unused = object : AudioProcessor {
            override suspend fun sha256(uri: String) = "x"
            override suspend fun prepare(uri: String, plan: UploadPlan) = File("none")
        }
        repo = RecordingsRepository(RpcTransport { _, _ -> JsonNull }, db, OutboxWriter(db.outbox()), FileUploader { _, _, _, _, _, _ -> "f" }, unused, settings)
    }

    @After
    fun close() {
        db.close()
        ApplicationProvider.getApplicationContext<Context>().getSharedPreferences("screens-test", Context.MODE_PRIVATE).edit().clear().commit()
    }

    private fun rec(id: String, status: String, trimmed: Boolean = false) = RecordingEntity(
        id = id, kind = "call", uri = "content://rec/$id", fileName = "$id.m4a", sizeBytes = 1, recordedAt = 1_800_000_000_000,
        durationS = 840, callLogId = null, leadId = null, confidence = 0.95, needsReview = false, status = status, fileId = null,
        uploadedS = if (trimmed) 600 else null, trimmed = trimmed, error = null, attempts = 0, lostNote = false, createdAt = 0,
    )

    @Test
    fun syncAllQueuesWhatIsStillOnThePhone() {
        runBlocking {
            db.recordings().insert(rec("a", "on_phone"))
            db.recordings().insert(rec("b", "synced", trimmed = true))
        }
        var asked = 0
        compose.setContent { PearlTheme { RecordingsOnPhoneScreen(repo, onSyncRequested = { asked++ }, onBack = {}) } }

        compose.waitUntil(5_000) { compose.onAllNodesWithText(ApplicationProvider.getApplicationContext<Context>().resources.getQuantityString(R.plurals.rec_trimmed, 10, 10)).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("rec-sync-all").performClick()
        compose.waitUntil(5_000) { asked == 1 }
        assertEquals("queued", runBlocking { db.recordings().get("a")!!.status })
        assertEquals("synced", runBlocking { db.recordings().get("b")!!.status })
    }

    @Test
    fun setupShowsEveryStepAndRemembersThePopupSwitch() {
        compose.setContent { PearlTheme { CallSetupScreen(settings, onScanNow = { 0 }, onBack = {}) } }
        listOf("setup-phone", "setup-overlay", "setup-notify", "setup-battery", "setup-mic", "setup-folder").forEach {
            compose.onNodeWithTag(it).performScrollTo().assertIsDisplayed()
        }
        // The brand guide for this phone (Robolectric reports "robolectric", so the general text).
        compose.onNodeWithText(text(R.string.setup_battery_other)).performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("setup-popup").performScrollTo().assertIsOn().performClick().assertIsOff()
        assertFalse(settings.callerPopup)
    }

    @Test
    fun brandHints() {
        assertEquals(R.string.setup_folder_samsung, recordingFolderHint("samsung"))
        assertEquals(R.string.setup_folder_xiaomi, recordingFolderHint("Xiaomi"))
        assertEquals(R.string.setup_folder_coloros, recordingFolderHint("OnePlus"))
        assertEquals(R.string.setup_folder_vivo, recordingFolderHint("vivo"))
        assertEquals(R.string.setup_battery_samsung, batteryGuide("SAMSUNG"))
        assertTrue(recordingFolderHint("Google") == R.string.setup_folder_other)
    }
}
