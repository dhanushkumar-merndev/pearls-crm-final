package com.pearl.crm.feature.sales

import android.content.Context
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pearl.crm.core.data.net.PearlJson
import com.pearl.crm.core.model.SalesDashboard
import com.pearl.crm.core.model.SalesTarget
import com.pearl.crm.core.model.TargetProgress
import com.pearl.crm.core.ui.theme.PearlTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class TargetsSectionTest {
    @get:Rule
    val compose = createComposeRule()

    private val context get() = ApplicationProvider.getApplicationContext<Context>()

    @Test
    fun showsAMeterForEachMetricWithATarget() {
        compose.setContent {
            PearlTheme {
                TargetsSection(
                    SalesTarget(
                        converted = TargetProgress(target = 5, actual = 3),
                        agreedPaise = TargetProgress(target = 10_000_000, actual = 5_000_000),
                        calls = TargetProgress(target = null, actual = 120),
                    ),
                )
            }
        }
        compose.onNodeWithText(context.getString(R.string.myday_targets)).assertIsDisplayed()
        compose.onNodeWithText("3 of 5 (60%)").assertIsDisplayed()
        compose.onNodeWithText("₹50,000.00 of ₹1,00,000.00 (50%)").assertIsDisplayed()
        // Calls have no target this month: no meter for them.
        assertEquals(0, compose.onAllNodes(androidx.compose.ui.test.hasText(context.getString(R.string.myday_target_calls))).fetchSemanticsNodes().size)
    }

    @Test
    fun readsTheServersTargetsAndTheirAbsence() {
        val off = PearlJson.decodeFromString(SalesDashboard.serializer(), """{"date":"2026-10-26","target":null}""")
        assertNull(off.target)
        val on = PearlJson.decodeFromString(
            SalesDashboard.serializer(),
            """{"target":{"month":"2026-10-01","converted":{"target":5,"actual":7},"agreed_paise":{"target":null,"actual":0},"calls":{"target":null,"actual":3}}}""",
        )
        assertEquals(1f, on.target!!.converted.fraction)
        assertEquals(140, on.target!!.converted.percent)
        assertFalse(SalesTarget().hasAny)
    }
}
