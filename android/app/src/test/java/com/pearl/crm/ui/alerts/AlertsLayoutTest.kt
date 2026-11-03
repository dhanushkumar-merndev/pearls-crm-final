package com.pearl.crm.ui.alerts

import android.app.Application
import android.content.Context
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pearl.crm.R
import com.pearl.crm.core.ui.theme.PearlTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

@RunWith(AndroidJUnit4::class)
@Config(application = Application::class)
class AlertsLayoutTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun emptyAlertsRemainReachableBelowTheHeaderOnAShortScreen() {
        compose.setContent {
            PearlTheme {
                Box(Modifier.size(320.dp, 180.dp)) {
                    AlertsContent(emptyList(), null, null, {}, {}, {}, {})
                }
            }
        }
        val context = ApplicationProvider.getApplicationContext<Context>()
        compose.onNodeWithText(context.getString(R.string.alerts_empty)).performScrollTo().assertIsDisplayed()
    }
}
