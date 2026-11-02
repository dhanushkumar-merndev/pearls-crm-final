package com.pearl.crm.e2e

import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pearl.crm.AppLock
import com.pearl.crm.MainActivity
import com.pearl.crm.R
import com.pearl.crm.e2e.Phone.c
import com.pearl.crm.e2e.Phone.text
import com.pearl.crm.ui.pin.BiometricUnlock
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import com.pearl.crm.feature.settings.R as SettingsR

/**
 * Owner, 02/11/2026: on a phone with a fingerprint or face, no app PIN. After login "Turn on
 * fingerprint" once; the lock is a plain screen with the phone's prompt; "Log in with password
 * instead" when it doesn't read. The phone's prompt is replaced by a pretend one (a test can't
 * touch the sensor); everything around it is the real app.
 */
@RunWith(AndroidJUnit4::class)
class BiometricLockTest {
    @get:Rule(order = 0)
    val compose = createAndroidComposeRule<MainActivity>()

    @get:Rule(order = 1)
    val capture = FailureCapture(compose)

    /** What the pretend sensor does when asked: read the finger (true) or nothing (false). */
    private var fingerReads = true
    private var prompts = 0

    @Before
    fun fingerprintPhone() {
        Phone.signedOut()
        BiometricUnlock.availableForTests = true
        BiometricUnlock.promptForTests = { ok -> prompts++; if (fingerReads) ok() }
    }

    @After
    fun backToPin() {
        BiometricUnlock.promptForTests = null
        BiometricUnlock.availableForTests = false
        Phone.signedOut()
    }

    private fun logIn(username: String) {
        compose.waitForText(text(R.string.login_title))
        compose.onNode(hasSetTextAction() and hasText(text(R.string.login_username))).performTextReplacement(username)
        compose.onNode(hasSetTextAction() and hasText(text(R.string.login_password))).performTextReplacement(Phone.password)
        compose.onNode(hasText(text(R.string.login_submit)) and hasClickAction()).performClick()
    }

    private fun lockNow() {
        c.settings.lastBackgroundAt = System.currentTimeMillis() - AppLock.LOCK_AFTER_MS - 60_000
        c.lock.onForeground()
    }

    @Test
    fun loginAsksForTheFingerprintNotAPin() {
        logIn("sales")
        compose.waitForText(text(R.string.biometric_setup_title))
        assertTrue("no PIN pad on the setup screen", compose.onAllNodes(hasTestTag("pin-key-1")).fetchSemanticsNodes().isEmpty())
        compose.onNodeWithTag("biometric-setup").performClick()
        compose.waitForText(text(R.string.tab_my_day))
        assertTrue(c.settings.biometricLock.value)
        assertFalse("no app PIN is kept", c.pins.hasPin.value)

        // Settings: nothing to change (no PIN).
        compose.onNodeWithText(text(R.string.tab_settings)).performClick()
        compose.waitForText(text(SettingsR.string.settings_title))
        assertTrue(compose.onAllNodes(hasText(text(SettingsR.string.settings_change_pin))).fetchSemanticsNodes().isEmpty())
    }

    @Test
    fun theLockIsAPlainScreenAndTheFingerOpensIt() {
        logIn("sales")
        compose.waitForText(text(R.string.biometric_setup_title))
        compose.onNodeWithTag("biometric-setup").performClick()
        compose.waitForText(text(R.string.tab_my_day))

        // 5 minutes away; the finger isn't read at first: the plain lock screen stays, no PIN pad.
        fingerReads = false
        val before = prompts
        lockNow()
        compose.waitUntil(20_000) { compose.exists(hasTestTag("biometric-unlock")) }
        compose.waitUntil(10_000) { prompts > before } // the prompt opens by itself
        assertTrue(compose.onAllNodes(hasTestTag("pin-key-1")).fetchSemanticsNodes().isEmpty())

        fingerReads = true
        compose.onNodeWithTag("biometric-unlock").performClick()
        compose.waitForText(text(R.string.tab_my_day))
        assertFalse(c.lock.locked.value)
    }

    @Test
    fun whenTheFingerDoesntReadLogInWithThePassword() {
        logIn("sales")
        compose.waitForText(text(R.string.biometric_setup_title))
        compose.onNodeWithTag("biometric-setup").performClick()
        compose.waitForText(text(R.string.tab_my_day))

        fingerReads = false
        lockNow()
        compose.waitUntil(20_000) { compose.exists(hasTestTag("biometric-login")) }
        compose.onNodeWithTag("biometric-login").performClick()
        compose.waitForText(text(R.string.login_reason_biometric))
        assertNull(c.sessions.session.value)
        assertFalse("the next login sets its lock up again", c.settings.biometricLock.value)
    }

    @Test
    fun aPhoneWithoutAFingerprintStillUsesAPin() {
        BiometricUnlock.availableForTests = false
        logIn("sales")
        compose.waitForText(text(R.string.pin_create_title))
        assertEquals(null, c.settings.biometricLock.value.takeIf { it })
    }
}
