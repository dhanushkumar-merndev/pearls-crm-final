package com.pearl.crm.e2e

import android.Manifest
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextReplacement
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pearl.crm.MainActivity
import com.pearl.crm.R
import com.pearl.crm.e2e.Phone.c
import com.pearl.crm.e2e.Phone.text
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.FixMethodOrder
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.MethodSorters
import com.pearl.crm.feature.bdm.R as BdmR

/**
 * A-BDM-01…12: a BDM's field day with a pretend GPS and camera. One day per date, so the tests
 * run in name order: refused away from the office first, then the whole day. `pnpm phone:test`
 * resets today's day of the test BDM on staging before the run.
 */
@RunWith(AndroidJUnit4::class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class BdmDayTest {
    @get:Rule(order = 0)
    val compose = createAndroidComposeRule<MainActivity>()

    @get:Rule(order = 1)
    val capture = FailureCapture(compose)

    private lateinit var camera: FakeCamera
    private var gps: FakeGps? = null

    /** The office (from staging, passed by `pnpm phone:test`). */
    private val office: Pair<Double, Double>? =
        Phone.arg("officeLat")?.toDoubleOrNull()?.let { lat -> Phone.arg("officeLng")?.toDoubleOrNull()?.let { lat to it } }

    @Before
    fun setUp() {
        Phone.skipUnless(office != null, "no active office on staging (Admin → Offices)")
        Phone.grant(
            Manifest.permission.POST_NOTIFICATIONS, Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.RECORD_AUDIO,
        )
        Phone.signedIn("bdm")
        runBlocking { c.bdm.refreshFromServer() }
        Phone.skipUnless(!c.bdm.day.value.ended, "today's BDM day already ended: run through `pnpm phone:test` (it resets the day)")
        // The day screen reads the location permission when it opens: open it again now it is granted.
        compose.activityRule.scenario.recreate()
        compose.waitForText(text(BdmR.string.bdm_hello, "\u0000").substringBefore("\u0000"), substring = true)
        camera = FakeCamera()
    }

    @After
    fun tearDown() {
        if (::camera.isInitialized) camera.close()
        gps?.close()
    }

    private fun tag(t: String) = compose.onNodeWithTag(t).performScrollTo()

    private fun waitForTag(t: String, timeoutMs: Long = 30_000) = compose.waitUntil(timeoutMs) { compose.exists(hasTestTag(t)) }

    private fun today(): JsonObject = runBlocking { Phone.rpc.call("bdm_today", JsonObject(emptyMap())).jsonObject }

    @Test
    fun a_startingFarFromTheOfficeIsRefused() {
        val (lat, lng) = office!!
        Phone.skipUnless(!c.bdm.day.value.open, "today's day is already started")
        gps = FakeGps(lat + 0.5, lng) // about 55 km north
        waitForTag("bdm-start")
        tag("bdm-start").performClick()
        waitForTag("bdm-failure", 60_000)
        assertEquals(1, camera.photos)
        assertFalse("no day started", c.bdm.day.value.open)
        assertTrue(today()["day"] !is JsonObject)
    }

    @Test
    fun b_aWholeDayStartTravelVisitBreakAndEnd() {
        val (lat, lng) = office!!
        gps = FakeGps(lat, lng)

        // Start: selfie + location at the office.
        if (!c.bdm.day.value.open) {
            waitForTag("bdm-start")
            tag("bdm-start").performClick()
            compose.waitForText(text(BdmR.string.bdm_started_in_office), timeoutMs = 60_000)
        }
        compose.waitForText(text(BdmR.string.bdm_recording_route))

        // Travel: a destination is needed.
        waitForTag("bdm-travel")
        tag("bdm-travel").performClick()
        compose.onNodeWithTag("bdm-go").performClick()
        compose.waitForText(text(BdmR.string.bdm_destination_required))
        compose.onNodeWithTag("bdm-destination").performTextReplacement("E2E Partner Clinic")
        compose.onNodeWithTag("bdm-go").performClick()
        compose.waitForText(text(BdmR.string.bdm_going_to, "E2E Partner Clinic"))

        // A pretend drive: Android marks these readings as mock, so they don't count as km.
        for (i in 1..6) {
            gps!!.moveTo(lat + i * 0.001, lng)
            Thread.sleep(2_000)
        }

        // Reached, with a photo of the place.
        tag("bdm-reached").performClick()
        compose.button(text(BdmR.string.bdm_take_photo)).performClick()
        compose.waitForText(text(BdmR.string.bdm_photo_ready))
        compose.onNodeWithTag("bdm-confirm-reached").performClick()
        compose.waitForText(text(BdmR.string.bdm_at, "E2E Partner Clinic"))

        // A short meeting recording.
        tag("bdm-record").performClick()
        compose.waitForText(text(BdmR.string.bdm_stop_recording))
        Thread.sleep(3_000)
        compose.button(text(BdmR.string.bdm_stop_recording)).performClick()
        compose.waitForText(text(BdmR.string.bdm_meeting_ready, 0, 0).substringBefore("0"), substring = true)

        // Complete: the outcome is needed, and a new lead needs a valid number.
        tag("bdm-complete").performClick()
        compose.onNodeWithTag("bdm-save-visit").performClick()
        compose.waitForText(text(BdmR.string.bdm_outcome_required))
        compose.onNodeWithTag("bdm-outcome").performTextReplacement("E2E met the doctor, will refer patients")
        compose.onNodeWithTag("bdm-create-lead").performScrollTo().performClick()
        compose.onNodeWithTag("bdm-leadName").performScrollTo().performTextReplacement("E2E BDM Lead ${System.currentTimeMillis()}")
        compose.onNodeWithTag("bdm-leadPhone").performScrollTo().performTextReplacement("123")
        compose.onNodeWithTag("bdm-save-visit").performClick()
        compose.waitForText(text(BdmR.string.bdm_phone_invalid))
        compose.onNodeWithTag("bdm-leadPhone").performScrollTo().performTextReplacement(Phone.uniquePhone())
        compose.onNodeWithTag("bdm-save-visit").performClick()
        waitForTag("bdm-travel")

        // A break: minutes between 5 and 180.
        tag("bdm-break").performClick()
        compose.onNodeWithTag("bdm-break-minutes").performTextReplacement("2")
        compose.onNodeWithTag("bdm-start-break").performClick()
        compose.waitForText(text(BdmR.string.bdm_break_minutes_invalid))
        compose.onNodeWithTag("bdm-break-minutes").performTextReplacement("15")
        compose.onNodeWithTag("bdm-start-break").performClick()
        waitForTag("bdm-end-break")
        tag("bdm-end-break").performClick()
        waitForTag("bdm-end-day")

        // End of the day.
        tag("bdm-end-day").performClick()
        compose.onNodeWithTag("bdm-end-confirm").performClick()
        compose.waitForText(text(BdmR.string.bdm_day_ended), timeoutMs = 30_000)

        // On the server: the day is over, flagged for the pretend location, with one finished visit.
        Phone.sentAll(120_000)
        val day = today()["day"]?.jsonObject
        assertNotNull(day?.get("ended_at")?.jsonPrimitive?.contentOrNull)
        assertTrue(day!!["flags"]!!.jsonArray.any { it.jsonPrimitive.content == "mock_location" })
        val staffId = c.sessions.session.value!!.staffId
        val visits = runBlocking { c.bdm.visitsToday(staffId) }
        assertEquals(1, visits.count { it.destination == "E2E Partner Clinic" && it.completedAt != null })
        // Mock readings never count as kilometres.
        assertEquals(0L, runBlocking { c.bdm.dashboard() }.today?.distanceM ?: 0L)
        assertTrue("the place photo came from the camera", camera.photos >= 1)
    }
}
