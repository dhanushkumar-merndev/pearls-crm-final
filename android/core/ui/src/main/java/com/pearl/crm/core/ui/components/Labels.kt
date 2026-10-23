package com.pearl.crm.core.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import com.pearl.crm.core.model.StaffRole
import com.pearl.crm.core.ui.R

@Composable
fun roleLabel(role: StaffRole): String = stringResource(
    when (role) {
        StaffRole.Receptionist -> R.string.role_receptionist
        StaffRole.SalesExecutive -> R.string.role_sales_executive
        StaffRole.SalesManager -> R.string.role_sales_manager
        StaffRole.Bdm -> R.string.role_bdm
        StaffRole.Admin -> R.string.role_admin
    },
)
