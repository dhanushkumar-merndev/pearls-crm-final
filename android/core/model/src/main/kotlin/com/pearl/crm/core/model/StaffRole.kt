package com.pearl.crm.core.model

/** Postgres enum `public.staff_role`. */
enum class StaffRole(val wire: String) {
    Receptionist("receptionist"),
    SalesExecutive("sales_executive"),
    SalesManager("sales_manager"),
    Bdm("bdm"),
    Admin("admin");

    /** Sales and field staff work in this app; reception and admin use the web app. */
    val usesAndroidApp: Boolean
        get() = this == SalesExecutive || this == SalesManager || this == Bdm

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
