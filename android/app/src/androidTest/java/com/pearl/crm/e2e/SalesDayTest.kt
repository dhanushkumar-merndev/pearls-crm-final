package com.pearl.crm.e2e

import android.Manifest
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pearl.crm.MainActivity
import com.pearl.crm.R
import com.pearl.crm.e2e.Phone.c
import com.pearl.crm.e2e.Phone.text
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import com.pearl.crm.feature.bdm.R as BdmR

/**
 * A sales executive's day (owner, 02/11/2026): selfie + location at the office on My Day, then
 * End day. No route is recorded. `phone-run` resets today's day of the test salesperson first.
 */
@RunWith(AndroidJUnit4::class)
class SalesDayTest {
    @get:Rule(order = 0)
    val compose = createAndroidComposeRule<MainActivity>()

    @get:Rule(order = 1)
    val capture = FailureCapture(compose)

    private var camera: FakeCamera? = null
    private var gps: FakeGps? = null

    private val office: Pair<Double, Double>? =
        Phone.arg("officeLat")?.toDoubleOrNull()?.let { lat -> Phone.arg("officeLng")?.toDoubleOrNull()?.let { lat to it } }

    @Before
    fun setUp() {
        Phone.skipUnless(office != null, "no active office on staging (Admin → Offices)")
        Phone.grant(Manifest.permission.POST_NOTIFICATIONS, Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
        Phone.signedIn(Phone.SALES)
        runBlocking { c.bdm.refreshFromServer() }
        Phone.skipUnless(!c.bdm.day.value.ended && !c.bdm.day.value.open, "today's sales day already started: reset it first")
        // The card reads the location permission when it opens: open it again now it is granted.
        compose.activityRule.scenario.recreate()
        compose.waitForText(text(R.string.tab_my_day))
    }

    @After
    fun tearDown() {
        camera?.close()
        gps?.close()
    }

    private fun tap(t: String) {
        compose.waitUntil(30_000) { compose.exists(hasTestTag(t)) }
        compose.onNodeWithTag(t).performScrollTo()
        compose.waitForIdle()
        compose.onNodeWithTag(t).performClick()
    }

    @Test
    fun aSalesExecutiveStartsAtTheOfficeAndEndsTheDay() {
        val (lat, lng) = office!!
        gps = FakeGps(lat, lng)
        camera = FakeCamera()
        tap("bdm-start")
        compose.waitForText(text(BdmR.string.bdm_started_in_office), timeoutMs = 60_000)
        assertTrue(c.bdm.day.value.open)

        tap("sales-end-day")
        compose.waitUntil(10_000) { compose.exists(hasTestTag("sales-end-confirm")) }
        compose.onNodeWithTag("sales-end-confirm").performClick()
        compose.waitUntil(30_000) { compose.exists(hasTestTag("sales-day-ended")) }
        Phone.sentAll()
        val day = runBlocking { Phone.rpc.call("bdm_today", JsonObject(emptyMap())).jsonObject }["day"] as JsonObject
        assertTrue("ended on the server", day["ended_at"].toString() != "null")
    }
}
