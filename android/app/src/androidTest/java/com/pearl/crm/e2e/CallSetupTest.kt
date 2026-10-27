package com.pearl.crm.e2e

import android.Manifest
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pearl.crm.MainActivity
import com.pearl.crm.R
import com.pearl.crm.e2e.Phone.c
import com.pearl.crm.e2e.Phone.text
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import com.pearl.crm.feature.sales.R as SalesR
import com.pearl.crm.feature.settings.R as SettingsR

/**
 * A-SAL-26…28: Settings → Calls and recordings, and Recordings on this phone. Choosing the
 * dialer's recording folder is the phone's own picker (different on every brand): a manual
 * field check in TEST_CASES.md; matching and uploading are covered by the JVM and DB tests.
 */
@RunWith(AndroidJUnit4::class)
class CallSetupTest {
    @get:Rule(order = 0)
    val compose = createAndroidComposeRule<MainActivity>()

    @get:Rule(order = 1)
    val capture = FailureCapture(compose)

    @Before
    fun signIn() {
        Phone.grant(Manifest.permission.POST_NOTIFICATIONS, Manifest.permission.READ_PHONE_STATE, Manifest.permission.READ_CALL_LOG)
        Phone.shell("appops set ${Phone.app.packageName} SYSTEM_ALERT_WINDOW allow")
        c.settings.recordingFolder = null
        c.settings.callerPopup = true
        Phone.signedIn("sales")
        compose.waitForText(text(R.string.tab_my_day))
        compose.button(text(R.string.tab_settings)).performClick()
    }

    private fun stepDone(tag: String) = compose.exists(hasText(text(SalesR.string.setup_done)) and hasAnyAncestor(hasTestTag(tag)))

    @Test
    fun theSetupScreenShowsWhatIsDoneAndThePopUpSwitchIsKept() {
        compose.button(text(SettingsR.string.settings_call_setup)).performScrollTo().performClick()
        compose.waitForText(text(SalesR.string.setup_title))
        compose.waitUntil(10_000) { stepDone("setup-phone") }
        assertTrue("draw over other apps", stepDone("setup-overlay"))
        assertTrue("notifications", stepDone("setup-notify"))
        assertFalse("no recording folder yet", stepDone("setup-folder"))
        // "Look for recordings now" waits for a folder.
        compose.onNode(hasText(text(SalesR.string.setup_check)) and hasClickAction()).performScrollTo().assertIsNotEnabled()

        compose.onNodeWithTag("setup-popup").performScrollTo().performClick()
        compose.waitUntil(5_000) { !c.settings.callerPopup }
        compose.onNodeWithTag("setup-popup").performScrollTo().performClick()
        compose.waitUntil(5_000) { c.settings.callerPopup }
    }

    @Test
    fun aPermissionTakenAwayShowsAsNotDone() {
        Phone.shell("appops set ${Phone.app.packageName} SYSTEM_ALERT_WINDOW deny")
        try {
            compose.button(text(SettingsR.string.settings_call_setup)).performScrollTo().performClick()
            compose.waitForText(text(SalesR.string.setup_title))
            compose.waitUntil(10_000) { stepDone("setup-phone") }
            assertFalse(stepDone("setup-overlay"))
        } finally {
            Phone.shell("appops set ${Phone.app.packageName} SYSTEM_ALERT_WINDOW allow")
        }
    }

    @Test
    fun recordingsOnThisPhoneStartsEmpty() {
        compose.button(text(SettingsR.string.settings_recordings)).performScrollTo().performClick()
        compose.waitForText(text(SalesR.string.rec_title))
        compose.waitForText(text(SalesR.string.rec_empty))
    }
}
