package com.pearl.crm.core.ui.components

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.pearl.crm.core.ui.theme.Spacing

/** [Tonal] is the quiet filled look for secondary actions in a row (Log call, Note, Done…). */
enum class ButtonKind { Primary, Secondary, Tonal, Danger, Quiet }

/**
 * Minimum height of everything tappable we draw ourselves (compact size, owner 26/10/2026:
 * still at least 40 dp). Material's own buttons keep their 48 dp touch area around this.
 */
val MinTouchTarget = 40.dp

/** Icon size in buttons and list rows. */
val IconSize = 20.dp

/**
 * The app's button: always an icon and a text, 40 dp tall ([small]: 36 dp, for a row of
 * secondary actions). One [ButtonKind.Primary] per screen. [busy] shows a spinner instead of
 * the icon and blocks taps.
 */
@Composable
fun PearlButton(
    text: String,
    icon: ImageVector,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    kind: ButtonKind = ButtonKind.Primary,
    enabled: Boolean = true,
    busy: Boolean = false,
    small: Boolean = false,
) {
    val iconSize = if (small) 18.dp else IconSize
    val content: @Composable () -> Unit = {
        if (busy) {
            CircularProgressIndicator(modifier = Modifier.size(iconSize - 2.dp), strokeWidth = 2.dp)
        } else {
            Icon(icon, contentDescription = null, modifier = Modifier.size(iconSize))
        }
        Spacer(Modifier.width(Spacing.s))
        Text(text, style = if (small) MaterialTheme.typography.labelMedium else MaterialTheme.typography.labelLarge)
    }
    val sized = modifier.heightIn(min = if (small) 36.dp else MinTouchTarget)
    val padding = if (small) PaddingValues(horizontal = Spacing.m, vertical = Spacing.xs) else PaddingValues(horizontal = Spacing.l, vertical = Spacing.s)
    val on = enabled && !busy
    when (kind) {
        ButtonKind.Primary -> Button(onClick, sized, on, contentPadding = padding) { content() }
        ButtonKind.Danger -> Button(
            onClick,
            sized,
            on,
            colors = ButtonDefaults.buttonColors(
                containerColor = MaterialTheme.colorScheme.error,
                contentColor = MaterialTheme.colorScheme.onError,
            ),
            contentPadding = padding,
        ) { content() }
        ButtonKind.Secondary -> OutlinedButton(onClick, sized, on, contentPadding = padding) { content() }
        ButtonKind.Tonal -> FilledTonalButton(onClick, sized, on, contentPadding = padding) { content() }
        ButtonKind.Quiet -> TextButton(onClick, sized, on, contentPadding = padding) { content() }
    }
}
