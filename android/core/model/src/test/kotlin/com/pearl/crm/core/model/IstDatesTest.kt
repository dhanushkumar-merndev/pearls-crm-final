package com.pearl.crm.core.model

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant

/** Same cases as packages/shared/tests/dates.test.ts. */
class IstDatesTest {
    private fun ms(iso: String) = Instant.parse(iso).toEpochMilli()

    @Test
    fun formatsInIndiaTimeWithTwelveHourClock() {
        assertEquals("01/10/2026 10:56 AM", IstDates.formatDateTime(ms("2026-10-01T05:26:00Z")))
        assertEquals("12:00 PM", IstDates.formatTime(ms("2026-10-01T06:30:00Z")))
        assertEquals("12:00 AM", IstDates.formatTime(ms("2026-10-01T18:30:00Z")))
    }

    @Test
    fun theDateFollowsIndiaNotUtc() {
        // 23:59 UTC on 31/03 is already 01/04 in India.
        assertEquals("01/04/2027", IstDates.formatDate(ms("2027-03-31T23:59:00Z")))
    }
}
