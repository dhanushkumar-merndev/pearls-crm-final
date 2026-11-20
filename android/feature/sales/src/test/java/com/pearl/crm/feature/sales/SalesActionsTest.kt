package com.pearl.crm.feature.sales

import com.pearl.crm.core.model.IstDates
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.LocalTime

class SalesActionsTest {
    @Test
    fun rupeesAsTypedBecomePaise() {
        assertEquals(150_000L, rupeesToPaise("1500"))
        assertEquals(150_000L, rupeesToPaise("1,500"))
        assertEquals(150_050L, rupeesToPaise("1500.50"))
        assertEquals(150_005L, rupeesToPaise("₹1500.05"))
        assertEquals(150_050L, rupeesToPaise("1500.5"))
        assertNull(rupeesToPaise(""))
        assertNull(rupeesToPaise("abc"))
        assertNull(rupeesToPaise("1.234"))
        assertNull(rupeesToPaise("-5"))
    }

    @Test
    fun paiseShowAsRupeesInAField() {
        assertEquals("1500", paiseToRupeesText(150_000))
        assertEquals("1500.50", paiseToRupeesText(150_050))
        assertEquals("", paiseToRupeesText(null))
        assertEquals(150_050L, rupeesToPaise(paiseToRupeesText(150_050)))
    }

    @Test
    fun nextCallTimesAreHalfHoursAndTodayLeavesOutPastOnes() {
        assertEquals(LocalTime.of(9, 0), NEXT_CALL_TIMES.first())
        assertEquals(LocalTime.of(20, 30), NEXT_CALL_TIMES.last())
        assertEquals(24, NEXT_CALL_TIMES.size)
        val today = LocalDate.of(2026, 11, 20)
        val noonIst = today.atTime(12, 10).atZone(IstDates.ZONE).toInstant().toEpochMilli()
        val left = nextCallTimes(today, today, noonIst)
        assertEquals(LocalTime.of(12, 30), left.first())
        assertTrue(left.none { it < LocalTime.of(12, 10) })
        assertEquals(NEXT_CALL_TIMES, nextCallTimes(today.plusDays(1), today, noonIst))
        assertTrue(nextCallTimes(today, today, today.atTime(21, 0).atZone(IstDates.ZONE).toInstant().toEpochMilli()).isEmpty())
    }

    @Test
    fun postgresTimesReadAsInstants() {
        assertEquals("2026-11-20T10:15:30.123456Z", normaliseIso("2026-11-20 10:15:30.123456+00:00"))
        assertEquals("2026-11-20T04:45:00Z", normaliseIso("2026-11-20T10:15:00+05:30"))
    }
}
