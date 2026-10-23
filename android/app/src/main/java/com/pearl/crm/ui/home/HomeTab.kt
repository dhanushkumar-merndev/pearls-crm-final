package com.pearl.crm.ui.home

import androidx.annotation.StringRes
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.EventRepeat
import androidx.compose.material.icons.outlined.People
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Today
import androidx.compose.ui.graphics.vector.ImageVector
import com.pearl.crm.R
import com.pearl.crm.core.model.StaffRole

/** Bottom-bar destinations. Each role sees its own set (PLAN.md B6 / E3 row 11). */
enum class HomeTab(val route: String, @param:StringRes val label: Int, val icon: ImageVector) {
    MyDay("my-day", R.string.tab_my_day, Icons.Outlined.Today),
    Leads("leads", R.string.tab_leads, Icons.Outlined.People),
    Followups("followups", R.string.tab_followups, Icons.Outlined.EventRepeat),
    Calls("calls", R.string.tab_calls, Icons.Outlined.Call),
    Visits("visits", R.string.tab_visits, Icons.Outlined.Place),
    Settings("settings", R.string.tab_settings, Icons.Outlined.Settings);

    companion object {
        fun forRole(role: StaffRole): List<HomeTab> = when (role) {
            StaffRole.SalesExecutive, StaffRole.SalesManager -> listOf(MyDay, Leads, Followups, Calls, Settings)
            StaffRole.Bdm -> listOf(MyDay, Visits, Leads, Settings)
            StaffRole.Receptionist, StaffRole.Admin -> listOf(Settings)
        }
    }
}
