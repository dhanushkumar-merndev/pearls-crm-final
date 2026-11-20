package com.pearl.crm.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** One quotation line: [pricePaise] is for one; the line is qty × price. */
@Serializable
data class QuoteItem(
    @SerialName("treatment_id") val treatmentId: String? = null,
    val name: String,
    val qty: Int = 1,
    @SerialName("price_paise") val pricePaise: Long,
) {
    val amountPaise: Long get() = qty * pricePaise
}

/** Clinic details for the PDF header, from Admin → Clinic profile (never hard-coded). */
@Serializable
data class QuoteClinic(
    val name: String = "",
    @SerialName("legal_name") val legalName: String? = null,
    val gstin: String? = null,
    @SerialName("address_lines") val addressLines: List<String> = emptyList(),
    val city: String? = null,
    val state: String? = null,
    val pincode: String? = null,
    val phones: List<String> = emptyList(),
    val email: String? = null,
    val website: String? = null,
)

/** `save_lead_quotation` / `lead_quotations_list` (owner, 20/11/2026: quotation sent from own WhatsApp). */
@Serializable
data class Quotation(
    val id: String,
    @SerialName("lead_id") val leadId: String,
    @SerialName("quote_no") val quoteNo: Int,
    val items: List<QuoteItem>,
    @SerialName("subtotal_paise") val subtotalPaise: Long,
    @SerialName("discount_paise") val discountPaise: Long = 0,
    @SerialName("total_paise") val totalPaise: Long,
    @SerialName("valid_until") val validUntil: String? = null,
    val note: String? = null,
    val message: String,
    @SerialName("sent_count") val sentCount: Int = 0,
    @SerialName("created_at") val createdAt: String,
    @SerialName("lead_name") val leadName: String,
    @SerialName("lead_phone") val leadPhone: String,
    @SerialName("lead_sl_no") val leadSlNo: Long? = null,
    @SerialName("created_by_name") val createdByName: String? = null,
    val clinic: QuoteClinic = QuoteClinic(),
) {
    /** "Q-1234-2": the lead's number and this quotation's number (same as the printed one). */
    val reference: String get() = "Q-${leadSlNo ?: "—"}-$quoteNo"
}

/** A line being typed on the phone (qty as typed, price in paise or null). */
data class QuoteLineDraft(
    val treatmentId: String? = null,
    val name: String = "",
    val qty: String = "1",
    val pricePaise: Long? = null,
)

/** What can be wrong with a quotation form; same rules as the web form and the database. */
enum class QuoteProblem { NoLines, LineName, LineQty, LinePrice, DiscountTooBig, ValidPast, NoteLong }

object QuoteRules {
    const val MAX_LINES = 20
    const val MAX_NOTE = 500
    const val MAX_PRICE = 10_000_000_000L

    fun subtotal(lines: List<QuoteLineDraft>): Long =
        lines.sumOf { (it.qty.trim().toIntOrNull() ?: 0).toLong() * (it.pricePaise ?: 0) }

    /** Problems by line index (-1 = the whole form). Empty = ready to save. */
    fun check(lines: List<QuoteLineDraft>, discountPaise: Long?, validUntil: String?, today: String, note: String): Map<Int, Set<QuoteProblem>> {
        val out = mutableMapOf<Int, MutableSet<QuoteProblem>>()
        fun add(i: Int, p: QuoteProblem) = out.getOrPut(i) { mutableSetOf() }.add(p)
        if (lines.isEmpty() || lines.size > MAX_LINES) add(-1, QuoteProblem.NoLines)
        lines.forEachIndexed { i, l ->
            if (l.name.trim().isEmpty() || l.name.trim().length > 200) add(i, QuoteProblem.LineName)
            if (l.qty.trim().toIntOrNull()?.takeIf { it in 1..100 } == null) add(i, QuoteProblem.LineQty)
            if (l.pricePaise == null || l.pricePaise !in 0..MAX_PRICE) add(i, QuoteProblem.LinePrice)
        }
        if ((discountPaise ?: 0) < 0 || (discountPaise ?: 0) > subtotal(lines)) add(-1, QuoteProblem.DiscountTooBig)
        if (validUntil != null && validUntil < today) add(-1, QuoteProblem.ValidPast)
        if (note.trim().length > MAX_NOTE) add(-1, QuoteProblem.NoteLong)
        return out
    }
}
