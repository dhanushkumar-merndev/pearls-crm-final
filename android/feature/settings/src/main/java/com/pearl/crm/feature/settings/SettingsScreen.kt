package com.pearl.crm.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Pin
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.pearl.crm.core.model.IstDates
import com.pearl.crm.core.model.StaffRole
import com.pearl.crm.core.model.ThemeMode
import com.pearl.crm.core.ui.components.ButtonKind
import com.pearl.crm.core.ui.components.MinTouchTarget
import com.pearl.crm.core.ui.components.PearlButton
import com.pearl.crm.core.ui.components.StatusLabel
import com.pearl.crm.core.ui.components.StatusTone
import com.pearl.crm.core.ui.components.errorMessage
import com.pearl.crm.core.ui.components.roleLabel
import com.pearl.crm.core.ui.theme.Pearl

/** A queued change the server refused; the person decides to try again or discard it. */
data class FailedChange(val id: String, val code: String, val createdAt: Long)

data class SettingsUiState(
    val fullName: String?,
    val username: String,
    val role: StaffRole?,
    val theme: ThemeMode,
    /** Changes not yet on the server (waiting + failed). */
    val unsentCount: Int,
    val failed: List<FailedChange>,
    val lastSyncAt: Long?,
    val offline: Boolean,
    val syncing: Boolean,
    val appVersion: String,
)

@Composable
fun SettingsScreen(
    state: SettingsUiState,
    onThemeChange: (ThemeMode) -> Unit,
    onChangePin: () -> Unit,
    onSyncNow: () -> Unit,
    onRetry: (String) -> Unit,
    onDiscard: (String) -> Unit,
    onSignOut: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var confirmSignOut by rememberSaveable { mutableStateOf(false) }
    var discarding by rememberSaveable { mutableStateOf<String?>(null) }

    Column(
        modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        Text(stringResource(R.string.settings_title), style = MaterialTheme.typography.titleLarge)
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(state.fullName?.takeIf { it.isNotBlank() } ?: state.username, style = MaterialTheme.typography.titleMedium)
            val role = state.role?.let { roleLabel(it) }
            Text(
                listOfNotNull(state.username, role).joinToString(" · "),
                color = Pearl.palette.textSecondary,
            )
        }

        Section(stringResource(R.string.settings_sync)) {
            when {
                state.syncing -> StatusLabel(stringResource(R.string.settings_syncing), StatusTone.Info)
                state.offline -> StatusLabel(stringResource(R.string.settings_offline), StatusTone.Offline)
                state.lastSyncAt != null -> StatusLabel(
                    stringResource(R.string.settings_last_sync, IstDates.formatDateTime(state.lastSyncAt)),
                    StatusTone.Good,
                )
                else -> StatusLabel(stringResource(R.string.settings_never_synced), StatusTone.Info)
            }
            if (state.unsentCount > 0) {
                StatusLabel(
                    pluralStringResource(R.plurals.settings_unsent, state.unsentCount, state.unsentCount),
                    StatusTone.Warning,
                )
            }
            PearlButton(
                stringResource(R.string.settings_sync_now),
                Icons.Outlined.Sync,
                onSyncNow,
                kind = ButtonKind.Secondary,
                busy = state.syncing,
            )
            state.failed.forEach { change ->
                HorizontalDivider()
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    StatusLabel(errorMessage(change.code), StatusTone.Critical)
                    Text(
                        stringResource(R.string.settings_failed_made, IstDates.formatDateTime(change.createdAt)),
                        style = MaterialTheme.typography.bodySmall,
                        color = Pearl.palette.textSecondary,
                    )
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        PearlButton(stringResource(R.string.settings_retry), Icons.Outlined.Refresh, { onRetry(change.id) }, kind = ButtonKind.Secondary)
                        PearlButton(stringResource(R.string.settings_discard), Icons.Outlined.Delete, { discarding = change.id }, kind = ButtonKind.Quiet)
                    }
                }
            }
        }

        Section(stringResource(R.string.settings_theme)) {
            Column(Modifier.selectableGroup()) {
                ThemeOption(stringResource(R.string.settings_theme_dark), state.theme == ThemeMode.Dark) { onThemeChange(ThemeMode.Dark) }
                ThemeOption(stringResource(R.string.settings_theme_light), state.theme == ThemeMode.Light) { onThemeChange(ThemeMode.Light) }
                ThemeOption(stringResource(R.string.settings_theme_system), state.theme == ThemeMode.System) { onThemeChange(ThemeMode.System) }
            }
        }

        Section(stringResource(R.string.settings_security)) {
            PearlButton(stringResource(R.string.settings_change_pin), Icons.Outlined.Pin, onChangePin, kind = ButtonKind.Secondary)
            PearlButton(
                stringResource(R.string.settings_sign_out),
                Icons.AutoMirrored.Outlined.Logout,
                { confirmSignOut = true },
                kind = ButtonKind.Danger,
            )
        }

        Text(
            stringResource(R.string.settings_version, state.appVersion),
            style = MaterialTheme.typography.bodySmall,
            color = Pearl.palette.textSecondary,
        )
    }

    if (confirmSignOut) {
        AlertDialog(
            onDismissRequest = { confirmSignOut = false },
            title = { Text(stringResource(R.string.settings_sign_out_title)) },
            text = {
                Text(
                    if (state.unsentCount > 0) {
                        pluralStringResource(R.plurals.settings_sign_out_unsent, state.unsentCount, state.unsentCount)
                    } else {
                        stringResource(R.string.settings_sign_out_body)
                    },
                )
            },
            confirmButton = {
                PearlButton(
                    stringResource(if (state.unsentCount > 0) R.string.settings_sign_out_anyway else R.string.settings_sign_out),
                    Icons.AutoMirrored.Outlined.Logout,
                    {
                        confirmSignOut = false
                        onSignOut()
                    },
                    kind = ButtonKind.Danger,
                )
            },
            dismissButton = {
                PearlButton(stringResource(R.string.settings_stay), Icons.Outlined.Close, { confirmSignOut = false }, kind = ButtonKind.Quiet)
            },
        )
    }

    discarding?.let { id ->
        AlertDialog(
            onDismissRequest = { discarding = null },
            title = { Text(stringResource(R.string.settings_discard_title)) },
            text = { Text(stringResource(R.string.settings_discard_body)) },
            confirmButton = {
                PearlButton(
                    stringResource(R.string.settings_discard),
                    Icons.Outlined.Delete,
                    {
                        discarding = null
                        onDiscard(id)
                    },
                    kind = ButtonKind.Danger,
                )
            },
            dismissButton = {
                PearlButton(stringResource(R.string.settings_keep), Icons.Outlined.Close, { discarding = null }, kind = ButtonKind.Quiet)
            },
        )
    }
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(title, style = MaterialTheme.typography.titleSmall, color = Pearl.palette.textSecondary)
        content()
    }
}

@Composable
private fun ThemeOption(label: String, selected: Boolean, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = MinTouchTarget)
            .selectable(selected = selected, role = Role.RadioButton, onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadioButton(selected = selected, onClick = null)
        Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(start = 12.dp))
    }
}
