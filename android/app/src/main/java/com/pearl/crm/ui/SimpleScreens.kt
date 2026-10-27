package com.pearl.crm.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.Computer
import androidx.compose.material.icons.outlined.Construction
import androidx.compose.material.icons.outlined.SettingsSuggest
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.pearl.crm.R
import com.pearl.crm.core.model.StaffRole
import com.pearl.crm.core.ui.components.ButtonKind
import com.pearl.crm.core.ui.components.PearlButton
import com.pearl.crm.core.ui.components.roleLabel
import com.pearl.crm.core.ui.theme.Pearl
import com.pearl.crm.core.ui.theme.Spacing

@Composable
private fun MessageScreen(icon: ImageVector, title: String, body: String, action: @Composable () -> Unit = {}) {
    Column(
        Modifier.fillMaxSize().safeDrawingPadding().padding(Spacing.xl),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Column(Modifier.widthIn(max = 480.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.l)) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(40.dp), tint = Pearl.palette.textSecondary)
            Text(title, style = MaterialTheme.typography.titleLarge)
            Text(body, color = Pearl.palette.textSecondary)
            action()
        }
    }
}

/** Built without the backend address (no root .env at build time). */
@Composable
fun NotConfiguredScreen() {
    MessageScreen(Icons.Outlined.SettingsSuggest, stringResource(R.string.not_configured_title), stringResource(R.string.not_configured_body))
}

/** Reception and admin work in the web app. */
@Composable
fun UseWebAppScreen(role: StaffRole?, onSignOut: () -> Unit) {
    MessageScreen(
        Icons.Outlined.Computer,
        stringResource(R.string.use_web_title),
        stringResource(R.string.use_web_body, role?.let { roleLabel(it) } ?: "—"),
    ) {
        PearlButton(stringResource(R.string.use_web_sign_out), Icons.AutoMirrored.Outlined.Logout, onSignOut, kind = ButtonKind.Secondary)
    }
}

/** A tab whose screen comes in a later stage of Phase 11. */
@Composable
fun ComingSoonScreen(title: String) {
    MessageScreen(Icons.Outlined.Construction, title, stringResource(R.string.coming_soon))
}
