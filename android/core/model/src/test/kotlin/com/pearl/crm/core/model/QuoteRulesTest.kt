package com.pearl.crm.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Same rules as the web's quotationSchema and save_lead_quotation. */
class QuoteRulesTest {
    private val today = "2026-11-20"
    private val good = QuoteLineDraft(name = "PRP", qty = "2", pricePaise = 150_000)

    @Test
    fun aGoodQuotationHasNoProblems() {
        assertTrue(QuoteRules.check(listOf(good), 50_000, "2026-12-05", today, "EMI available").isEmpty())
        assertEquals(300_000, QuoteRules.subtotal(listOf(good)))
    }

    @Test
    fun emptyAndTooManyLinesAreRefused() {
        assertEquals(setOf(QuoteProblem.NoLines), QuoteRules.check(emptyList(), null, null, today, "")[-1])
        assertEquals(setOf(QuoteProblem.NoLines), QuoteRules.check(List(21) { good }, null, null, today, "")[-1])
    }

    @Test
    fun eachBadLineSaysWhatIsWrong() {
        val p = QuoteRules.check(listOf(good, QuoteLineDraft(name = " ", qty = "0", pricePaise = null)), null, null, today, "")
        assertEquals(null, p[0])
        assertEquals(setOf(QuoteProblem.LineName, QuoteProblem.LineQty, QuoteProblem.LinePrice), p[1])
        assertEquals(setOf(QuoteProblem.LineQty), QuoteRules.check(listOf(good.copy(qty = "101")), null, null, today, "")[0])
    }

    @Test
    fun theDiscountCannotBeMoreThanTheLines() {
        assertEquals(setOf(QuoteProblem.DiscountTooBig), QuoteRules.check(listOf(good), 300_001, null, today, "")[-1])
        assertTrue(QuoteRules.check(listOf(good), 300_000, null, today, "").isEmpty())
    }

    @Test
    fun aPastDateAndALongNoteAreRefused() {
        assertEquals(setOf(QuoteProblem.ValidPast), QuoteRules.check(listOf(good), null, "2026-11-19", today, "")[-1])
        assertTrue(QuoteRules.check(listOf(good), null, today, today, "").isEmpty())
        assertEquals(setOf(QuoteProblem.NoteLong), QuoteRules.check(listOf(good), null, null, today, "x".repeat(501))[-1])
    }

    @Test
    fun theReferenceMatchesThePrintedOne() {
        val q = Quotation(
            id = "Q", leadId = "L", quoteNo = 2, items = listOf(QuoteItem(name = "PRP", qty = 2, pricePaise = 150_000)),
            subtotalPaise = 300_000, totalPaise = 300_000, message = "m", createdAt = "2026-11-20T10:00:00+00:00",
            leadName = "A", leadPhone = "+919845012345", leadSlNo = 1234,
        )
        assertEquals("Q-1234-2", q.reference)
        assertEquals(300_000, q.items.single().amountPaise)
    }
}
