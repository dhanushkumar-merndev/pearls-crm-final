package com.pearl.crm.core.model

/** Postgres enum `public.staff_role`. */
enum class StaffRole(val wire: String) {
    Receptionist("receptionist"),
    SalesExecutive("sales_executive"),
    SalesManager("sales_manager"),
    Bdm("bdm"),
    Admin("admin");

    /** Every role may log in: sales and field staff work here; reception and admin get alerts only. */
    val usesAndroidApp: Boolean
        get() = true

    /** Reception and admin work on the web; on the phone they only get alerts (push + a list). */
    val alertsOnly: Boolean
        get() = this == Receptionist || this == Admin

    /** Roles whose phone keeps a copy of their leads, follow-ups and bookings (sync pull). */
    val pullsData: Boolean
        get() = !alertsOnly

    companion object {
        fun fromWire(value: String?): StaffRole? = entries.firstOrNull { it.wire == value }
    }
}

/** What `me()` returns (the fields the app uses). */
data class StaffProfile(
    val id: String,
    val role: StaffRole?,
    val fullName: String,
    val username: String?,
)

enum class ThemeMode { Dark, Light, System }
