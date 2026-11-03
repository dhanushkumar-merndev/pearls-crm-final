package com.pearl.crm.core.ui.components

import android.content.Context
import androidx.compose.foundation.layout.Column
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.Place
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pearl.crm.core.ui.R
import com.pearl.crm.core.ui.theme.PearlTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.GraphicsMode
import java.io.File
import java.time.LocalDate
import java.util.Locale

@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class VisualsTest {
    @get:Rule
    val compose = createComposeRule()

    private val context get() = ApplicationProvider.getApplicationContext<Context>()

    @Test
    fun initialsUseTheFirstTwoWords() {
        assertEquals("PS", initialsOf("Priya Sharma"))
        assertEquals("AR", initialsOf("  asha   rao kumar "))
        assertEquals("M", initialsOf("Meena"))
        assertEquals("?", initialsOf("   "))
        assertEquals("R", initialsOf("(+91) Ravi"))
    }

    @Test
    fun todayLineIsDayNameAndDdMmYyyy() {
        assertEquals("Tuesday, 03/11/2026", todayLine(LocalDate.of(2026, 11, 3), Locale.ENGLISH))
    }

    @Test
    fun statTilesHeroAndPillsRender() {
        var called = 0
        compose.setContent {
            PearlTheme {
                Column {
                    GreetingHeader("Hello, Asha Rao", "Asha Rao")
                    StatTiles(
                        listOf(
                            StatItem("Calls today", "12", Icons.Outlined.Call, Accent.Blue),
                            StatItem("Visits", "3", Icons.Outlined.Place, Accent.Violet),
                        ),
                    )
                    HeroCard("At a visit", Icons.Outlined.Place, accentColor(Accent.Violet), subtitle = "At City Hospital") {
                        StatusPill("Your route is being recorded.", StatusTone.Good)
                    }
                    Tag("Interested")
                    TintedIconButton(Icons.Outlined.Call, "Call", accentColor(Accent.Teal), { called++ })
                }
            }
        }
        compose.onNodeWithText("Hello, Asha Rao").assertIsDisplayed()
        compose.onNodeWithText("AR").assertIsDisplayed()
        compose.onNodeWithText("12").assertIsDisplayed()
        compose.onNodeWithText("Visits").assertIsDisplayed()
        compose.onNodeWithText("At City Hospital").assertIsDisplayed()
        compose.onNodeWithText("Your route is being recorded.").assertIsDisplayed()
        compose.onNodeWithText("Interested").assertIsDisplayed()
        compose.onNode(hasContentDescription("Call")).performClick()
        assertEquals(1, called)
    }

    @Test
    fun photoPreviewShowsALoaderUntilThePhotoIsThere() {
        compose.setContent { PearlTheme { PhotoPreview() } }
        compose.onNodeWithTag("photo-loading").assertIsDisplayed()
        compose.onNode(hasContentDescription(context.getString(R.string.common_loading_photo))).assertIsDisplayed()
    }

    @Test
    fun photoPreviewShowsAReadyPhoto() {
        compose.setContent { PearlTheme { PhotoPreview(bitmap = ImageBitmap(8, 8), contentDescription = "Your selfie") } }
        compose.onNodeWithTag("photo").assertIsDisplayed()
        compose.onNode(hasContentDescription("Your selfie")).assertIsDisplayed()
    }

    @Test
    fun photoPreviewStopsLoadingWhenTheFileCannotBeRead() {
        val missing = File(context.cacheDir, "no-such-photo.webp").apply { delete() }
        compose.setContent { PearlTheme { PhotoPreview(file = missing) } }
        compose.waitUntil(5_000) { compose.onAllNodes(androidx.compose.ui.test.hasTestTag("photo")).fetchSemanticsNodes().isNotEmpty() }
        assertTrue(compose.onAllNodes(androidx.compose.ui.test.hasTestTag("photo-loading")).fetchSemanticsNodes().isEmpty())
    }
}
