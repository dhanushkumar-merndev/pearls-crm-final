package com.pearl.crm.feature.bdm

import android.content.Context
import androidx.annotation.StringRes
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pearl.crm.core.data.AudioProcessor
import com.pearl.crm.core.data.BdmRepository
import com.pearl.crm.core.data.OutboxWriter
import com.pearl.crm.core.data.RecordingsRepository
import com.pearl.crm.core.data.SettingsStore
import com.pearl.crm.core.data.VisitResult
import com.pearl.crm.core.data.audio.VoiceRecorder
import com.pearl.crm.core.data.db.AppDatabase
import com.pearl.crm.core.data.device.DeviceLocation
import com.pearl.crm.core.data.net.FileUploader
import com.pearl.crm.core.data.net.PearlJson
import com.pearl.crm.core.model.LibraryItem
import com.pearl.crm.core.model.LibraryPage
import com.pearl.crm.core.model.LibrarySource
import com.pearl.crm.core.model.RawPoint
import com.pearl.crm.core.model.RpcTransport
import com.pearl.crm.core.model.UploadPlan
import com.pearl.crm.core.ui.theme.PearlTheme
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class BdmScreensTest {
    @get:Rule
    val compose = createComposeRule()

    private lateinit var db: AppDatabase
    private lateinit var bdm: BdmRepository
    private val context get() = ApplicationProvider.getApplicationContext<Context>()
    private var todayReply = """{"day":null}"""
    private val sent = mutableListOf<JsonObject>()

    private fun allowLocation() = org.robolectric.Shadows.shadowOf(ApplicationProvider.getApplicationContext<android.app.Application>())
        .grantPermissions(android.Manifest.permission.ACCESS_FINE_LOCATION, android.Manifest.permission.ACCESS_COARSE_LOCATION)

    private fun text(@StringRes id: Int, vararg args: Any) = context.getString(id, *args)

    private val library = object : LibrarySource {
        override suspend fun search(kind: String, query: String, cursor: String?, limit: Int) = LibraryPage(listOf(LibraryItem("lunch", "Lunch")))
        override suspend fun create(kind: String, label: String, defaults: JsonObject) = LibraryItem("x", label)
    }

    @Before
    fun open() {
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).allowMainThreadQueries().build()
        val rpc = RpcTransport { fn, args ->
            if (fn == "bdm_today") {
                PearlJson.parseToJsonElement(todayReply)
            } else if (fn == "day_start_request") {
                sent += args.getValue("p").jsonObject
                PearlJson.parseToJsonElement(
                    """{"id":"R1","status":"pending","reason":"${args.getValue("p").jsonObject.getValue("reason").jsonPrimitive.content}","distance_m":2300,"office":"Star Tech India"}""",
                )
            } else if (fn == "bdm_start_day") {
                PearlJson.parseToJsonElement("""{"day":{"id":"${args.getValue("p").jsonObject.getValue("client_id").jsonPrimitive.content}","work_date":"${java.time.LocalDate.now(com.pearl.crm.core.model.IstDates.ZONE)}","state":"in_office"},"inside":true}""")
            } else {
                JsonNull
            }
        }
        val uploader = FileUploader { _, _, _, _, _, clientId -> "f-$clientId" }
        val audio = object : AudioProcessor {
            override suspend fun sha256(uri: String) = "x"
            override suspend fun prepare(uri: String, plan: UploadPlan) = File("none")
        }
        val outbox = OutboxWriter(db.outbox())
        val settings = SettingsStore(context.getSharedPreferences("bdm-ui-settings", Context.MODE_PRIVATE))
        bdm = BdmRepository(rpc, db, outbox, uploader, RecordingsRepository(rpc, db, outbox, uploader, audio, settings), context.getSharedPreferences("bdm-ui", Context.MODE_PRIVATE))
    }

    @After
    fun close() {
        db.close()
        listOf("bdm-ui", "bdm-ui-settings").forEach { context.getSharedPreferences(it, Context.MODE_PRIVATE).edit().clear().commit() }
    }

    private fun show() = compose.setContent {
        PearlTheme {
            BdmDayScreen(
                name = "Bhavya",
                bdm = bdm,
                library = library,
                location = DeviceLocation(context),
                recorder = VoiceRecorder(context, context.cacheDir),
                photoAuthority = "test.files",
                onTrackingNeeded = {},
            )
        }
    }

    @Test
    fun beforeTheDayTheStartCardShowsAndLocationIsAskedFor() {
        show()
        compose.onNodeWithText(text(R.string.bdm_start_title)).assertIsDisplayed()
        compose.onNodeWithTag("bdm-allow-location").assertIsDisplayed()
    }

    @Test
    fun theReasonForStartingAwayIsChecked() {
        assertEquals(R.string.day_ask_reason_required, validateStartReason("  "))
        assertEquals(R.string.day_ask_reason_too_long, validateStartReason("x".repeat(501)))
        assertEquals(null, validateStartReason("Meeting at City Hospital"))
        assertEquals("350 m", distanceText(350))
        assertEquals("2.3 km", distanceText(2300))
    }

    @Test
    fun askingTheAdminSendsThePlaceAndReasonThenWaits() {
        runBlocking { bdm.requestStart(RawPoint(System.currentTimeMillis(), 12.98, 77.59, 12f), "  Meeting first  ", "REQ-1") }
        assertEquals("Meeting first", sent.single().getValue("reason").jsonPrimitive.content)
        assertEquals("REQ-1", sent.single().getValue("client_id").jsonPrimitive.content)
        allowLocation()
        show()
        compose.onNodeWithTag("day-request-waiting").assertIsDisplayed()
        compose.onNodeWithText(text(R.string.day_from_office, "2.3 km", "Star Tech India")).assertIsDisplayed()
        // Reaching the office while waiting: Start still works there.
        compose.onNodeWithTag("bdm-start").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("day-ask-admin").assertDoesNotExist()
    }

    @Test
    fun aNoFromTheAdminShowsTheirNoteAndYouCanAskAgain() {
        todayReply = """{"day":null,"start_request":{"id":"R2","status":"declined","reason":"x","decline_note":"Please come to the office"}}"""
        runBlocking { bdm.refreshFromServer() }
        allowLocation()
        show()
        compose.onNodeWithText(text(R.string.day_declined, "Please come to the office")).assertIsDisplayed()
        compose.onNodeWithTag("bdm-start").assertIsDisplayed()
        compose.onNodeWithTag("day-ask-admin").performClick()
        compose.onNodeWithTag("day-ask-send").performClick()
        compose.onNodeWithText(text(R.string.day_ask_reason_required)).assertIsDisplayed()
    }

    @Test
    fun anApprovedRequestLetsTheDayStartHere() {
        todayReply = """{"day":null,"start_request":{"id":"R3","status":"approved","reason":"x"}}"""
        runBlocking { bdm.refreshFromServer() }
        allowLocation()
        show()
        compose.onNodeWithTag("day-request-approved").assertIsDisplayed()
        compose.onNodeWithTag("bdm-start").assertIsDisplayed()
        compose.onNodeWithTag("day-ask-admin").assertDoesNotExist()
    }

    @Test
    fun travelNeedsADestinationThenIsQueued() {
        runBlocking { bdm.startDay(null, RawPoint(System.currentTimeMillis(), 12.97, 77.59, 10f), "DAY-UI") }
        show()
        compose.onNodeWithTag("bdm-travel").performClick()
        compose.onNodeWithTag("bdm-go").performClick()
        compose.onNodeWithText(text(R.string.bdm_destination_required)).assertIsDisplayed()

        compose.onNodeWithTag("bdm-destination").performTextInput("City Hospital")
        compose.onNodeWithTag("bdm-go").performClick()
        compose.waitUntil(5_000) { bdm.day.value.visitId != null }
        compose.onNodeWithText(text(R.string.bdm_going_to, "City Hospital")).assertIsDisplayed()
        compose.onNodeWithTag("bdm-reached").assertIsDisplayed()
        assertEquals("bdm_travel_start", runBlocking { db.outbox().dueHeads(Long.MAX_VALUE, 10).single().rpc })
    }

    @Test
    fun theVisitFormExplainsWhatIsMissing() {
        val saved = mutableListOf<VisitResult>()
        compose.setContent { PearlTheme { CompleteDialog(onDismiss = {}, onSave = { saved += it }) } }
        compose.onNodeWithTag("bdm-create-lead").performScrollTo().performClick()
        compose.onNodeWithTag("bdm-save-visit").performClick()
        compose.onNodeWithText(text(R.string.bdm_outcome_required)).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(text(R.string.bdm_lead_name_required)).performScrollTo().assertIsDisplayed()
        assertTrue(saved.isEmpty())

        compose.onNodeWithTag("bdm-outcome").performScrollTo().performTextInput("Interested")
        compose.onNodeWithTag("bdm-leadName").performScrollTo().performTextInput("Dr Rao referral")
        compose.onNodeWithTag("bdm-leadPhone").performScrollTo().performTextInput("98110 90002")
        compose.onNodeWithTag("bdm-save-visit").performClick()
        assertEquals("+919811090002", saved.single().lead?.phoneE164)
    }

    @Test
    fun formRules() {
        assertEquals(setOf("destination"), validateTravel("  ").keys)
        assertTrue(validateTravel("Clinic").isEmpty())
        assertEquals(setOf("outcome", "contactPhone"), validateVisit("", "12", false, "", "").keys)
        assertEquals(setOf("leadName", "leadPhone"), validateVisit("ok", "", true, "", "x").keys)
        assertEquals(30, validateBreakMinutes("30"))
        assertEquals(null, validateBreakMinutes("4"))
        assertEquals(null, validateBreakMinutes("abc"))
    }
}
