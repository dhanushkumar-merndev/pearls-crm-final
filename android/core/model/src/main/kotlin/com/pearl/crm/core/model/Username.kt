package com.pearl.crm.core.model

/**
 * Every staff member logs in with a USERNAME and password (owner's rule, 24/10/2026): no email
 * logins, codes or reset links. Supabase Auth still needs an email, so a username maps to
 * "<username>@staff.invalid". Mirrors packages/shared/src/auth.ts; keep the two in step.
 */
object Username {
    const val STAFF_EMAIL_DOMAIN = "staff.invalid"

    /** 3–32 characters: lower-case letters, digits, dot, underscore, hyphen. */
    private val PATTERN = Regex("^[a-z0-9._-]{3,32}$")

    fun normalize(input: String): String = input.trim().lowercase()

    fun isValid(input: String): Boolean = PATTERN.matches(normalize(input))

    /** The hidden Supabase Auth address for a username. */
    fun toLoginEmail(username: String): String = "${normalize(username)}@$STAFF_EMAIL_DOMAIN"
}
