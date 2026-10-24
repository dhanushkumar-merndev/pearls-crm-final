package com.pearl.crm.core.model

/** A phone number as the server stores it. Same rules as packages/shared/src/phone.ts. */
data class NormalizedPhone(
    /** E.164, e.g. "+919845012345". */
    val e164: String,
    /** Last 10 digits, used for search and matching. */
    val last10: String,
    /** Starts with 6–9 like every Indian mobile (a hint only: some landlines look the same). */
    val isIndianMobile: Boolean,
)

object Phones {
    private val NATIONAL = Regex("^[1-9]\\d{9}$")

    /**
     * Accepts the ways people type Indian numbers: "+91 98450 12345", "098450-12345",
     * "9845012345", "0091 9845012345", "080 4123 4567". Numbers starting with "+" and another
     * country code are kept as international. Null when it can't be a valid number.
     */
    fun normalize(input: String): NormalizedPhone? {
        val raw = input.trim()
        if (raw.isEmpty()) return null
        val digits = raw.filter { it.isDigit() }
        if (raw.startsWith("+") && !digits.startsWith("91")) {
            if (digits.length !in 8..15) return null
            return NormalizedPhone("+$digits", digits.takeLast(10), isIndianMobile = false)
        }
        val national = when {
            digits.startsWith("0091") -> digits.drop(4)
            digits.length == 12 && digits.startsWith("91") -> digits.drop(2)
            digits.length == 11 && digits.startsWith("0") -> digits.drop(1)
            else -> digits
        }
        if (!NATIONAL.matches(national)) return null
        return NormalizedPhone("+91$national", national, isIndianMobile = national.first() in '6'..'9')
    }
}
