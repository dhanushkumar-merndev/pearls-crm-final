package com.pearl.crm.e2e

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextReplacement
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pearl.crm.AppLock
import com.pearl.crm.MainActivity
import com.pearl.crm.R
import com.pearl.crm.e2e.Phone.c
import com.pearl.crm.e2e.Phone.text
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import com.pearl.crm.feature.settings.R as SettingsR

/** A-SYS-01…09: login, PIN, the 5-minute lock, forgot PIN, sign out (TEST_CASES.md). */
@RunWith(AndroidJUnit4::class)
class LoginPinTest {
    @get:Rule(order = 0)
    val compose = createAndroidComposeRule<MainActivity>()

    @get:Rule(order = 1)
    val capture = FailureCapture(compose)

    private fun field(label: Int) = compose.onNode(hasSetTextAction() and hasText(text(label)))

    private fun logIn(username: String, password: String) {
        compose.waitForText(text(R.string.login_title))
        field(R.string.login_username).performTextReplacement(username)
        field(R.string.login_password).performTextReplacement(password)
        compose.onNode(hasText(text(R.string.login_submit)) and hasClickAction()).performClick()
    }

    private fun typePin(pin: String, button: Int) {
        pin.forEach { compose.onNodeWithTag("pin-key-$it").performClick() }
        compose.onNodeWithText(text(button)).performClick()
    }

    private fun lockNow() {
        c.settings.lastBackgroundAt = System.currentTimeMillis() - AppLock.LOCK_AFTER_MS - 60_000
        c.lock.onForeground()
        compose.waitForText(text(R.string.pin_unlock_title))
    }

    @Test
    fun emptyLoginIsStoppedBeforeAnythingIsSent() {
        Phone.signedOut()
        compose.waitForText(text(R.string.login_title))
        compose.onNode(hasText(text(R.string.login_submit)) and hasClickAction()).performClick()
        compose.waitForText(text(R.string.login_required))
        assertNull(c.sessions.session.value)
    }

    @Test
    fun wrongPasswordGetsAFriendlyMessage() {
        Phone.signedOut()
        logIn(Phone.SALES, "not-the-password-1")
        compose.waitForText(text(R.string.login_wrong))
        assertNull(c.sessions.session.value)
    }

    @Test
    fun offlineLoginSaysTheServerCantBeReached() {
        Phone.signedOut()
        try {
            Phone.online(false)
            logIn(Phone.SALES, Phone.password)
            compose.waitForText(text(R.string.login_offline))
        } finally {
            Phone.online(true)
        }
    }

    /** Since 02/11/2026 reception and admin use the app for alerts only (work stays on the web). */
    @Test
    fun receptionGetsAlertsOnly() {
        Phone.signedOut()
        logIn("reception", Phone.password)
        compose.waitForText(text(R.string.pin_create_title))
        typePin(Phone.PIN, R.string.pin_next)
        compose.waitForText(text(R.string.pin_confirm_title))
        typePin(Phone.PIN, R.string.pin_save)
        compose.waitForText(text(R.string.alerts_intro), timeoutMs = 30_000)
        compose.onNodeWithText(text(R.string.tab_settings)).assertIsDisplayed()
        assertTrue("no sales tabs", compose.onAllNodes(hasText(text(R.string.tab_my_day))).fetchSemanticsNodes().isEmpty())
    }

    @Test
    fun loginThenPinsThatDontMatchThenAPinThatWorks() {
        Phone.signedOut()
        logIn(Phone.SALES, Phone.password)
        compose.waitForText(text(R.string.pin_create_title))
        typePin("2468", R.string.pin_next)
        compose.waitForText(text(R.string.pin_confirm_title))
        typePin("1357", R.string.pin_save)
        compose.waitForText(text(R.string.pin_mismatch))
        // Start again with matching PINs.
        compose.waitForText(text(R.string.pin_create_title))
        typePin(Phone.PIN, R.string.pin_next)
        compose.waitForText(text(R.string.pin_confirm_title))
        typePin(Phone.PIN, R.string.pin_save)
        compose.waitForText(text(R.string.tab_my_day))
        assertEquals(Phone.SALES, c.sessions.session.value?.username)
    }

    @Test
    fun underFiveMinutesAwayNoPinIsAsked() {
        Phone.signedIn(Phone.SALES)
        compose.waitForText(text(R.string.tab_my_day))
        c.settings.lastBackgroundAt = System.currentTimeMillis() - 60_000
        c.lock.onForeground()
        compose.waitForIdle()
        compose.onNodeWithText(text(R.string.tab_my_day)).assertIsDisplayed()
    }

    @Test
    fun afterFiveMinutesThePinIsAskedAndAWrongOneCountsDown() {
        Phone.signedIn(Phone.SALES)
        lockNow()
        typePin("0000", R.string.pin_unlock)
        // "Wrong PIN. N tries left …": the words before the number.
        compose.waitForText(Phone.app.resources.getQuantityString(R.plurals.pin_wrong, 2, 2).substringBefore("2"), substring = true)
        typePin(Phone.PIN, R.string.pin_unlock)
        compose.waitForText(text(R.string.tab_my_day))
    }

    @Test
    fun forgotPinMeansLoggingInAgain() {
        Phone.signedIn(Phone.SALES)
        lockNow()
        compose.onNodeWithText(text(R.string.pin_forgot)).performClick()
        compose.onNodeWithText(text(R.string.pin_forgot_confirm)).performClick()
        compose.waitForText(text(R.string.login_reason_forgot_pin))
        assertNull(c.sessions.session.value)
    }

    @Test
    fun signOutRemovesThisPersonsDataFromThePhone() {
        Phone.signedIn(Phone.SALES)
        compose.waitForText(text(R.string.tab_settings))
        compose.onNodeWithText(text(R.string.tab_settings)).performClick()
        compose.waitForText(text(SettingsR.string.settings_sign_out))
        compose.onNodeWithText(text(SettingsR.string.settings_sign_out)).performScrollTo().performClick()
        // The dialog's own "Sign out" (nothing unsent after the sync in signedIn), the last of the two.
        compose.waitForText(text(SettingsR.string.settings_sign_out_title))
        compose.onAllNodes(hasText(text(SettingsR.string.settings_sign_out)) and hasClickAction()).let { it[it.fetchSemanticsNodes().size - 1] }.performClick()
        compose.waitForText(text(R.string.login_title))
        val leads = runBlocking { c.db.openHelper.readableDatabase.query("SELECT COUNT(*) FROM leads").use { it.moveToFirst(); it.getInt(0) } }
        assertEquals(0, leads)
    }
}
