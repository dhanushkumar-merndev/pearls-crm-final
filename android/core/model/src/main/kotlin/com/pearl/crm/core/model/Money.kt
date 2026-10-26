package com.pearl.crm.core.model

/** Money is whole paise everywhere (CLAUDE.md); shown as ₹1,50,000.00 (Indian grouping). */
object Money {
    fun formatInr(paise: Long): String {
        val negative = paise < 0
        val abs = kotlin.math.abs(paise)
        val rupees = (abs / 100).toString()
        val last3 = rupees.takeLast(3)
        val rest = rupees.dropLast(3).reversed().chunked(2).joinToString(",").reversed()
        val grouped = if (rest.isEmpty()) last3 else "$rest,$last3"
        return "${if (negative) "-" else ""}₹$grouped.${(abs % 100).toString().padStart(2, '0')}"
    }
}
