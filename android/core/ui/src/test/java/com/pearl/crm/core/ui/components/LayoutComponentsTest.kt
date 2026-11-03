package com.pearl.crm.core.ui.components

import android.content.Context
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.People
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pearl.crm.core.ui.R
import com.pearl.crm.core.ui.theme.PearlTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LayoutComponentsTest {
    @get:Rule
    val compose = createComposeRule()

    private val context get() = ApplicationProvider.getApplicationContext<Context>()

    @Test
    fun fullPageEmptyStateCentersItsMessageInTheAvailableSpace() {
        compose.setContent {
            PearlTheme {
                Box(Modifier.size(320.dp, 480.dp).testTag("viewport")) {
                    EmptyState(Icons.Outlined.People, "No leads", Modifier.fillMaxSize())
                }
            }
        }
        val viewport = compose.onNodeWithTag("viewport").fetchSemanticsNode().boundsInRoot
        val title = compose.onNodeWithText("No leads").fetchSemanticsNode().boundsInRoot
        assertTrue("The message should be near the vertical centre", title.center.y in viewport.center.y..(viewport.center.y + viewport.height * 0.15f))
    }

    @Test
    fun centeredEmptyStateKeepsItsActionVisibleInAShortViewport() {
        compose.setContent {
            PearlTheme {
                Box(Modifier.size(320.dp, 200.dp).testTag("viewport")) {
                    EmptyState(
                        Icons.Outlined.People, "No leads", Modifier.fillMaxSize(),
                        action = EmptyAction("Show all leads", Icons.Outlined.People) {},
                    )
                }
            }
        }
        compose.onNodeWithText("Show all leads").assertIsDisplayed()
        val viewport = compose.onNodeWithTag("viewport").fetchSemanticsNode().boundsInRoot
        val action = compose.onNodeWithText("Show all leads").fetchSemanticsNode().boundsInRoot
        assertTrue(action.bottom <= viewport.bottom)
    }

    @Test
    fun emptyStateShowsItsTextAndTheNextStep() {
        var clicked = 0
        compose.setContent {
            PearlTheme {
                EmptyState(
                    Icons.Outlined.People,
                    "Nobody to call right now.",
                    body = "New leads show here.",
                    action = EmptyAction("Show all leads", Icons.Outlined.People) { clicked++ },
                )
            }
        }
        compose.onNodeWithText("Nobody to call right now.").assertIsDisplayed()
        compose.onNodeWithText("New leads show here.").assertIsDisplayed()
        compose.onNodeWithText("Show all leads").performClick()
        assertEquals(1, clicked)
    }

    @Test
    fun loadingBlockIsReadOutAsLoading() {
        compose.setContent { PearlTheme { LoadingBlock(rows = 2) } }
        compose.onNodeWithTag("loading").assertIsDisplayed()
        compose.onNode(hasContentDescription(context.getString(R.string.common_loading))).assertIsDisplayed()
    }

    @Test
    fun syncBannerShowsTheMessageAndItsAction() {
        var opened = 0
        compose.setContent {
            PearlTheme { SyncBanner("Some changes couldn't be saved.", StatusTone.Critical, actionLabel = "Open settings", onAction = { opened++ }) }
        }
        compose.onNodeWithTag("sync-banner").assertIsDisplayed()
        compose.onNodeWithText("Some changes couldn't be saved.").assertIsDisplayed()
        compose.onNodeWithText("Open settings").performClick()
        assertEquals(1, opened)
    }

    @Test
    fun statGridAndListRowRender() {
        var tapped = 0
        compose.setContent {
            PearlTheme {
                androidx.compose.foundation.layout.Column {
                    StatGrid(listOf("Calls today" to "12", "Spoke" to "7", "Follow-ups today" to "3", "Overdue" to "1"))
                    ListRow("Change PIN", icon = Icons.Outlined.People, onClick = { tapped++ }, chevron = true)
                    PearlTopBar("Asha Rao", onBack = {})
                }
            }
        }
        compose.onNodeWithText("12").assertIsDisplayed()
        compose.onNodeWithText("Overdue").assertIsDisplayed()
        compose.onNodeWithText("Change PIN").performClick()
        assertEquals(1, tapped)
        compose.onNode(hasContentDescription(context.getString(R.string.common_back))).assertIsDisplayed()
    }
}
