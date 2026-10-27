package com.pearl.crm.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.material.icons.outlined.GraphicEq
import androidx.compose.material.icons.outlined.Phone
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
import com.pearl.crm.core.ui.components.ListRow
import com.pearl.crm.core.ui.components.PearlCard
import com.pearl.crm.core.ui.components.Section
import com.pearl.crm.core.ui.components.MinTouchTarget
import com.pearl.crm.core.ui.components.PearlButton
import com.pearl.crm.core.ui.components.StatusLabel
import com.pearl.crm.core.ui.components.StatusTone
import com.pearl.crm.core.ui.components.errorMessage
import com.pearl.crm.core.ui.components.roleLabel
import com.pearl.crm.core.ui.theme.Pearl
import com.pearl.crm.core.ui.theme.Spacing

/** A queued change the server refused; the person decides to try again or discard it. */
data class FailedChange(val id: String, val code: String, val createdAt: Long, val rpc: String = "")

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
    /** Sales roles only: calls and recordings setup, and the phone's recordings. */
    onCallSetup: (() -> Unit)? = null,
    onRecordings: (() -> Unit)? = null,
) {
    var confirmSignOut by rememberSaveable { mutableStateOf(false) }
    var discarding by rememberSaveable { mutableStateOf<String?>(null) }

    Column(
        modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(Spacing.screen),
        verticalArrangement = Arrangement.spacedBy(Spacing.section),
    ) {
        Text(stringResource(R.string.settings_title), style = MaterialTheme.typography.titleLarge)
        PearlCard(verticalSpacing = 2.dp) {
            Text(state.fullName?.takeIf { it.isNotBlank() } ?: state.username, style = MaterialTheme.typography.titleSmall)
            val role = state.role?.let { roleLabel(it) }
            Text(
                listOfNotNull(state.username, role).joinToString(" · "),
                style = MaterialTheme.typography.bodySmall,
                color = Pearl.palette.textSecondary,
            )
        }

        Section(stringResource(R.string.settings_sync)) {
            PearlCard {
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
                    kind = ButtonKind.Tonal,
                    small = true,
                    busy = state.syncing,
                )
                state.failed.forEach { change ->
                    HorizontalDivider()
                    Text(stringResource(changeLabel(change.rpc)), style = MaterialTheme.typography.titleSmall)
                    StatusLabel(errorMessage(change.code), StatusTone.Critical)
                    Text(
                        stringResource(R.string.settings_failed_made, IstDates.formatDateTime(change.createdAt)),
                        style = MaterialTheme.typography.bodySmall,
                        color = Pearl.palette.textSecondary,
                    )
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
                        PearlButton(stringResource(R.string.settings_retry), Icons.Outlined.Refresh, { onRetry(change.id) }, kind = ButtonKind.Tonal, small = true)
                        PearlButton(stringResource(R.string.settings_discard), Icons.Outlined.Delete, { discarding = change.id }, kind = ButtonKind.Quiet, small = true)
                    }
                }
            }
        }

        Section(stringResource(R.string.settings_theme)) {
            PearlCard(contentPadding = PaddingValues(vertical = Spacing.xs), verticalSpacing = 0.dp) {
                Column(Modifier.selectableGroup()) {
                    ThemeOption(stringResource(R.string.settings_theme_dark), state.theme == ThemeMode.Dark) { onThemeChange(ThemeMode.Dark) }
                    ThemeOption(stringResource(R.string.settings_theme_light), state.theme == ThemeMode.Light) { onThemeChange(ThemeMode.Light) }
                    ThemeOption(stringResource(R.string.settings_theme_system), state.theme == ThemeMode.System) { onThemeChange(ThemeMode.System) }
                }
            }
        }

        if (onCallSetup != null || onRecordings != null) {
            Section(stringResource(R.string.settings_calls)) {
                PearlCard(contentPadding = PaddingValues(0.dp), verticalSpacing = 0.dp) {
                    onCallSetup?.let { ListRow(stringResource(R.string.settings_call_setup), icon = Icons.Outlined.Phone, onClick = it, chevron = true) }
                    if (onCallSetup != null && onRecordings != null) HorizontalDivider()
                    onRecordings?.let { ListRow(stringResource(R.string.settings_recordings), icon = Icons.Outlined.GraphicEq, onClick = it, chevron = true) }
                }
            }
        }

        Section(stringResource(R.string.settings_security)) {
            PearlCard(contentPadding = PaddingValues(0.dp), verticalSpacing = 0.dp) {
                ListRow(stringResource(R.string.settings_change_pin), icon = Icons.Outlined.Pin, onClick = onChangePin, chevron = true)
                HorizontalDivider()
                // Same row style as Change PIN; the red text says it is the one to be careful with (it asks first).
                ListRow(
                    stringResource(R.string.settings_sign_out),
                    icon = Icons.AutoMirrored.Outlined.Logout,
                    iconTint = Pearl.palette.badText,
                    titleColor = Pearl.palette.badText,
                    onClick = { confirmSignOut = true },
                )
            }
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
private fun ThemeOption(label: String, selected: Boolean, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = MinTouchTarget)
            .selectable(selected = selected, role = Role.RadioButton, onClick = onClick)
            // Lines the radio up with the icons of the list rows below (same left edge).
            .padding(horizontal = Spacing.m),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadioButton(selected = selected, onClick = null)
        Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(start = Spacing.m))
    }
}

/** What a queued change was, in the person's words, so they can decide to retry or discard it. */
private fun changeLabel(rpc: String): Int = when {
    rpc == "create_lead" -> R.string.change_create_lead
    rpc == "log_call" -> R.string.change_log_call
    rpc == "add_lead_note" -> R.string.change_add_lead_note
    rpc == "set_lead_stage" -> R.string.change_set_lead_stage
    rpc == "book_appointment" -> R.string.change_book_appointment
    rpc == "set_appointment_status" -> R.string.change_set_appointment_status
    rpc == "complete_followup" -> R.string.change_complete_followup
    rpc.startsWith("bdm_") -> R.string.change_bdm
    else -> R.string.change_other
}
