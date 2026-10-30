package com.pearl.crm.e2e

import android.Manifest
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pearl.crm.MainActivity
import com.pearl.crm.R
import com.pearl.crm.core.data.security.PinCheck
import com.pearl.crm.core.model.ThemeMode
import com.pearl.crm.e2e.Phone.c
import com.pearl.crm.e2e.Phone.text
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import com.pearl.crm.feature.settings.R as SettingsR

/** A-SYS-14…17: Settings — change PIN, sign out asks first, theme kept, offline strip (TEST_CASES.md). */
@RunWith(AndroidJUnit4::class)
class SettingsTest {
    @get:Rule(order = 0)
    val compose = createAndroidComposeRule<MainActivity>()

    @get:Rule(order = 1)
    val capture = FailureCapture(compose)

    @Before
    fun signIn() {
        Phone.grant(Manifest.permission.POST_NOTIFICATIONS)
        Phone.signedIn("sales")
        compose.waitForText(text(R.string.tab_settings))
        compose.onNodeWithText(text(R.string.tab_settings)).performClick()
        compose.waitForText(text(SettingsR.string.settings_title))
    }

    private fun row(label: Int) = compose.button(text(label)).performScrollTo().performClick()

    private fun typePin(pin: String, button: Int) {
        pin.forEach { compose.onNodeWithTag("pin-key-$it").performClick() }
        compose.onNodeWithText(text(button)).performClick()
    }

    @Test
    fun changePinNeedsTheCurrentOneAndTheNewOneWorks() {
        try {
            row(SettingsR.string.settings_change_pin)
            compose.waitForText(text(R.string.pin_current_title))
            typePin("0000", R.string.pin_unlock)
            compose.waitForText(Phone.app.resources.getQuantityString(R.plurals.pin_wrong, 2, 2).substringBefore("2"), substring = true)
            typePin(Phone.PIN, R.string.pin_unlock)
            compose.waitForText(text(R.string.pin_create_title))
            typePin("1357", R.string.pin_next)
            compose.waitForText(text(R.string.pin_confirm_title))
            typePin("1357", R.string.pin_save)
            compose.waitForText(text(R.string.pin_changed))
            assertEquals(PinCheck.Ok, runBlocking { c.pins.verify("1357") })
            assertTrue(runBlocking { c.pins.verify(Phone.PIN) } !is PinCheck.Ok)
        } finally {
            // Back to the PIN every other test (and the owner) uses.
            runBlocking { c.pins.set(Phone.PIN) }
        }
    }

    @Test
    fun cancellingChangePinKeepsTheOldPin() {
        row(SettingsR.string.settings_change_pin)
        compose.waitForText(text(R.string.pin_current_title))
        compose.onNodeWithText(text(R.string.pin_cancel)).performClick()
        compose.waitForText(text(SettingsR.string.settings_title))
        assertEquals(PinCheck.Ok, runBlocking { c.pins.verify(Phone.PIN) })
    }

    @Test
    fun signOutAsksFirstAndStayKeepsYouIn() {
        row(SettingsR.string.settings_sign_out)
        compose.waitForText(text(SettingsR.string.settings_sign_out_title))
        compose.onNode(hasText(text(SettingsR.string.settings_stay)) and hasClickAction()).performClick()
        compose.waitUntil(10_000) { !compose.exists(hasText(text(SettingsR.string.settings_sign_out_title))) }
        assertEquals("sales", c.sessions.session.value?.username)
        // Still on Settings ("Settings" is both the title and the tab, so look for its own row).
        compose.waitForText(text(SettingsR.string.settings_change_pin))
    }

    @Test
    fun theThemeChoiceIsKept() {
        try {
            row(SettingsR.string.settings_theme_light)
            compose.waitUntil(5_000) { c.settings.theme.value == ThemeMode.Light }
            row(SettingsR.string.settings_theme_dark)
            compose.waitUntil(5_000) { c.settings.theme.value == ThemeMode.Dark }
        } finally {
            c.settings.setTheme(ThemeMode.Dark)
        }
    }

    @Test
    fun withNoSignalTheOfflineStripShowsAndGoesWhenBack() {
        // The strip sits above every tab except Settings (Settings says it in its own Sync box).
        compose.onNodeWithText(text(R.string.tab_my_day)).performClick()
        try {
            Phone.online(false)
            compose.waitForText(text(R.string.home_offline), timeoutMs = 30_000, substring = true)
        } finally {
            Phone.online(true)
        }
        compose.waitUntil(45_000) { !compose.exists(hasText(text(R.string.home_offline), substring = true)) }
    }
}
