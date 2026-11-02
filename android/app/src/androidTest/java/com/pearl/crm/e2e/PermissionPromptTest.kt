package com.pearl.crm.e2e

import android.Manifest
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Until
import com.pearl.crm.MainActivity
import com.pearl.crm.e2e.Phone.text
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.regex.Pattern
import com.pearl.crm.feature.bdm.R as BdmR

/**
 * 02/11/2026: version 1.2.0 closed itself on "Allow location" (an old androidx.fragment refused
 * the permission request). Other tests grant permissions behind the app's back; this one taps the
 * real button, answers Android's own question, and checks the app is still there.
 */
@RunWith(AndroidJUnit4::class)
class PermissionPromptTest {
    @get:Rule(order = 0)
    val compose = createAndroidComposeRule<MainActivity>()

    @get:Rule(order = 1)
    val capture = FailureCapture(compose)

    @Test
    fun allowLocationAsksAndDoesntCloseTheApp() {
        Phone.grant(Manifest.permission.POST_NOTIFICATIONS)
        Phone.shell("pm revoke ${Phone.app.packageName} ${Manifest.permission.ACCESS_FINE_LOCATION}")
        Phone.shell("pm revoke ${Phone.app.packageName} ${Manifest.permission.ACCESS_COARSE_LOCATION}")
        Phone.signedIn("bdm")
        compose.activityRule.scenario.recreate()
        val allow = text(BdmR.string.bdm_allow_location)
        compose.waitForText(allow)
        compose.button(allow).performClick()

        // Android's own question (its wording differs per phone brand): allow while using the app.
        val device = Phone.device
        // Never the "Don't allow" button.
        val answer = Pattern.compile("(?i)^(?!.*don).*(while using|only this time|allow).*$")
        val button = device.wait(Until.findObject(By.text(answer).clickable(true)), 15_000)
            ?: device.wait(Until.findObject(By.text(answer)), 5_000)
        assertTrue("Android's location question did not appear (or the app closed)", button != null)
        button!!.click()

        // Still our app, and the button has gone (location is allowed now).
        device.wait(Until.hasObject(By.pkg(Phone.app.packageName).depth(0)), 10_000)
        compose.waitUntil(20_000) { !compose.exists(androidx.compose.ui.test.hasText(allow)) }
        val perms = Phone.shell("dumpsys package ${Phone.app.packageName}")
        assertTrue(
            "location is allowed",
            perms.contains("android.permission.ACCESS_FINE_LOCATION: granted=true") || perms.contains("android.permission.ACCESS_COARSE_LOCATION: granted=true"),
        )
    }
}
