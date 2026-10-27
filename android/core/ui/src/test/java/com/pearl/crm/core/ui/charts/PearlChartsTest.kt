package com.pearl.crm.core.ui.charts

import androidx.compose.foundation.layout.Column
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pearl.crm.core.ui.theme.PearlTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PearlChartsTest {
    @get:Rule
    val compose = createComposeRule()

    private val days = (1..14).map { "%02d/10".format(it) }

    @Test
    fun theYScaleUsesWholeNiceStepsAndAtMostFourOfThem() {
        assertEquals(1.0 to 1.0, chartScale(0.0))
        assertEquals(1.0 to 3.0, chartScale(3.0))
        assertEquals(2.0 to 8.0, chartScale(7.0))
        assertEquals(5.0 to 15.0, chartScale(12.0))
        assertEquals(50.0 to 150.0, chartScale(142.0))
        listOf(1.0, 9.0, 17.0, 33.0, 99.0, 1234.0).forEach { max ->
            val (step, top) = chartScale(max)
            assertTrue(step % 1.0 == 0.0 && top >= max && top / step <= 4)
        }
    }

    @Test
    fun columnChartCardShowsTheHeadlineLegendAndToggle() {
        var toggled = 0
        compose.setContent {
            PearlTheme {
                PearlChartCard(
                    headline = "142 calls · 61% spoke",
                    supporting = "Last 14 days",
                    asTable = false,
                    onToggleTable = { toggled++ },
                    legend = listOf(LegendEntry("Spoke", Color.Blue), LegendEntry("Target 10 a day", Color.Gray, dashed = true)),
                ) {
                    PearlColumnChart(
                        xLabels = days,
                        stacks = listOf(
                            ChartSeries("Spoke", days.indices.map { it % 5 }, Color.Blue),
                            ChartSeries("Not reached", days.indices.map { 2 }, Color.Gray),
                        ),
                        markerText = { "Day $it" },
                        description = "Calls per day",
                        target = 10.0,
                    )
                }
            }
        }
        compose.onNodeWithText("142 calls · 61% spoke").assertIsDisplayed()
        compose.onNodeWithText("Last 14 days").assertIsDisplayed()
        compose.onNodeWithText("Target 10 a day").assertIsDisplayed()
        compose.onNode(hasContentDescription("Calls per day")).assertIsDisplayed()
        compose.onNodeWithTag("chart-toggle").performClick()
        assertEquals(1, toggled)
    }

    @Test
    fun lineChartRenders() {
        compose.setContent {
            PearlTheme {
                Column {
                    PearlLineChart(xLabels = days, values = days.indices.map { it * 3 }, markerText = { "Day $it" }, description = "Leads per day")
                }
            }
        }
        compose.onNodeWithTag("line-chart").assertIsDisplayed()
        compose.onNode(hasContentDescription("Leads per day")).assertIsDisplayed()
    }
}
