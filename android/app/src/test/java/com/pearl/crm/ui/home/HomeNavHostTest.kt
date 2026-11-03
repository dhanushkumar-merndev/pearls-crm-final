package com.pearl.crm.ui.home

import android.app.Application
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.pearl.crm.core.model.StaffRole
import com.pearl.crm.core.ui.theme.PearlTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import androidx.test.ext.junit.runners.AndroidJUnit4

@RunWith(AndroidJUnit4::class)
@Config(application = Application::class)
class HomeNavHostTest {
    @get:Rule val compose = createComposeRule()
    private lateinit var nav: NavHostController

    private fun show(role: StaffRole = StaffRole.SalesExecutive) {
        compose.setContent {
            nav = rememberNavController()
            PearlTheme {
                val tabs = HomeTab.forRole(role)
                HomeNavHost(nav, tabs, Modifier.size(320.dp, 480.dp)) {
                    tabs.forEach { tab ->
                        composable(tab.route) { Box(Modifier.fillMaxSize().testTag(tab.route)) }
                    }
                    composable("detail") { Box(Modifier.fillMaxSize().testTag("detail")) }
                }
            }
        }
        compose.waitForIdle()
        compose.mainClock.autoAdvance = false
    }

    private fun move(action: () -> Unit) {
        compose.runOnUiThread(action)
        compose.mainClock.advanceTimeBy(80)
        compose.waitForIdle()
    }

    private fun x(tag: String) = compose.onNodeWithTag(tag).fetchSemanticsNode().positionInRoot.x

    private fun finishMotion() {
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
    }

    @Test
    fun openingAScreenSlidesInFromTheRightAndBackReversesIt() {
        show()
        move { nav.navigate("detail") }
        assertTrue("Opening should slide from the right instead of fading", x("detail") > 0f)
        finishMotion()
        move { nav.popBackStack() }
        assertTrue("Back should reveal the previous page from the left", x("my-day") < 0f)
        assertTrue("The closed page should move right", x("detail") > 0f)
    }

    @Test
    fun selectingATabToTheLeftReversesTheSlide() {
        show()
        move { nav.navigate("calls") }
        assertTrue(x("calls") > 0f)
        finishMotion()
        move { nav.navigate("leads") }
        assertTrue("Leads is left of Calls", x("leads") < 0f)
    }

    @Test
    fun bdmTabsUseTheirVisibleOrder() {
        show(StaffRole.Bdm)
        move { nav.navigate("visits") }
        finishMotion()
        move { nav.navigate("leads") }
        assertTrue("BDM Leads is right of Visits", x("leads") > 0f)
    }

}
