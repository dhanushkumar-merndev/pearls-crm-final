package com.pearl.crm.feature.sales

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pearl.crm.core.model.CallsOnDay
import com.pearl.crm.core.model.SalesTarget
import com.pearl.crm.core.model.TargetProgress
import com.pearl.crm.core.ui.theme.PearlTheme
import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CallsChartTest {
    @get:Rule
    val compose = createComposeRule()

    /** 14 days from 13/10 to 26/10: 10 calls a day, 6 of them spoke. */
    private val days = (0 until 14).map { CallsOnDay(LocalDate.of(2026, 10, 13).plusDays(it.toLong()).toString(), calls = 10, connected = 6) }

    @Test
    fun theHeadlineSaysHowManyCallsAndHowManySpoke() {
        compose.setContent { PearlTheme { CallsChart(days, dailyTarget = 12) } }
        compose.onNodeWithText("140 calls · 60% spoke").assertIsDisplayed()
        compose.onNodeWithText("Last 14 days").assertIsDisplayed()
        compose.onNodeWithText("Target 12 a day").assertIsDisplayed()
        compose.onNodeWithTag("column-chart").assertIsDisplayed()
    }

    @Test
    fun tableModeListsEveryDay() {
        compose.setContent { PearlTheme { CallsChart(days) } }
        compose.onNodeWithTag("chart-toggle").performClick()
        assertEquals(14, compose.onAllNodes(hasTestTag("chart-row")).fetchSemanticsNodes().size)
        // Back to the chart.
        compose.onNodeWithTag("chart-toggle").performClick()
        assertEquals(0, compose.onAllNodes(hasTestTag("chart-row")).fetchSemanticsNodes().size)
    }

    @Test
    fun noCallsShowsTheEmptyState() {
        compose.setContent { PearlTheme { CallsChart(days.map { it.copy(calls = 0, connected = 0) }) } }
        compose.onNodeWithText("No calls in the last 14 days").assertIsDisplayed()
        compose.onNodeWithTag("empty-state").assertIsDisplayed()
    }

    @Test
    fun whileLoadingTheChartKeepsItsSpace() {
        compose.setContent { PearlTheme { CallsChart(null) } }
        compose.onNodeWithTag("calls-chart-loading").assertIsDisplayed()
    }

    @Test
    fun theDailyTargetIsTheMonthsTargetOverItsWorkingDays() {
        // October 2026: 31 days, 4 Sundays → 27 working days; 270 calls → 10 a day.
        val target = SalesTarget(month = "2026-10-01", calls = TargetProgress(target = 270))
        assertEquals(10, dailyCallsTarget(target, LocalDate.of(2026, 10, 26)))
        assertNull(dailyCallsTarget(SalesTarget(), LocalDate.of(2026, 10, 26)))
        assertNull(dailyCallsTarget(null, LocalDate.of(2026, 10, 26)))
    }

    @Test
    fun bookDayChipsUseTheDayName() {
        assertEquals("Mon 26/10", bookDayLabel(LocalDate.of(2026, 10, 26), java.util.Locale.ENGLISH))
    }
}
