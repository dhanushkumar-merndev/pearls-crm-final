package com.pearl.crm.core.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.pearl.crm.core.model.ErrorCodes
import com.pearl.crm.core.model.RpcFailure
import com.pearl.crm.core.ui.R
import com.pearl.crm.core.ui.errors.ERROR_STRINGS
import com.pearl.crm.core.ui.theme.Pearl
import com.pearl.crm.core.ui.theme.Spacing

enum class StatusTone { Good, Info, Warning, Critical, Offline }

/** Status is never colour alone: always an icon and a label (PLAN.md B5). */
@Composable
fun StatusLabel(text: String, tone: StatusTone, modifier: Modifier = Modifier) {
    val palette = Pearl.palette
    val (icon, color) = when (tone) {
        StatusTone.Good -> Icons.Outlined.CheckCircle to palette.goodText
        StatusTone.Info -> Icons.Outlined.Info to palette.textSecondary
        StatusTone.Warning -> Icons.Outlined.WarningAmber to palette.warning
        StatusTone.Critical -> Icons.Outlined.ErrorOutline to palette.badText
        StatusTone.Offline -> Icons.Outlined.CloudOff to palette.textSecondary
    }
    StatusRow(text, icon, color, modifier)
}

@Composable
private fun StatusRow(text: String, icon: ImageVector, color: Color, modifier: Modifier) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(Spacing.s), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(18.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
    }
}

/** The translated message for a stable RPC error code (unknown codes get the general one). */
@Composable
fun errorMessage(code: String): String =
    stringResource(ERROR_STRINGS[code] ?: ERROR_STRINGS.getValue(ErrorCodes.UNKNOWN))

/** The message for any failure: offline, or the server's code. */
@Composable
fun failureMessage(failure: Throwable): String = when (failure) {
    is RpcFailure.Transient -> stringResource(R.string.common_offline)
    is RpcFailure.Permanent -> errorMessage(failure.code)
    is RpcFailure.SignedOut -> errorMessage(failure.code)
    else -> errorMessage(ErrorCodes.UNKNOWN)
}
