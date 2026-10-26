package com.pearl.crm.core.model

import org.junit.Assert.assertEquals
import org.junit.Test

class MoneyTest {
    @Test
    fun indianGroupingFromPaise() {
        assertEquals("₹1,50,000.00", Money.formatInr(15_000_000))
        assertEquals("₹12,34,567.89", Money.formatInr(123_456_789))
        assertEquals("₹999.00", Money.formatInr(99_900))
        assertEquals("₹0.05", Money.formatInr(5))
        assertEquals("-₹25.00", Money.formatInr(-2_500))
    }
}
