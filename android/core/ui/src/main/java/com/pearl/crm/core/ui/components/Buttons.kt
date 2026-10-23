package com.pearl.crm.core.ui.components

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp

enum class ButtonKind { Primary, Secondary, Danger, Quiet }

/** Minimum touch target for everything tappable (PLAN.md B5: big targets). */
val MinTouchTarget = 48.dp

/**
 * The app's button: always an icon and a text, at least 48 dp tall. One [ButtonKind.Primary]
 * per screen. [busy] shows a spinner instead of the icon and blocks taps.
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
) {
    val content: @Composable () -> Unit = {
        if (busy) {
            CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
        } else {
            Icon(icon, contentDescription = null, modifier = Modifier.size(22.dp))
        }
        Spacer(Modifier.width(10.dp))
        Text(text, style = MaterialTheme.typography.labelLarge)
    }
    val sized = modifier.heightIn(min = MinTouchTarget)
    val padding = PaddingValues(horizontal = 20.dp, vertical = 12.dp)
    when (kind) {
        ButtonKind.Primary -> Button(onClick, sized, enabled && !busy, contentPadding = padding) { content() }
        ButtonKind.Danger -> Button(
            onClick,
            sized,
            enabled && !busy,
            colors = ButtonDefaults.buttonColors(
                containerColor = MaterialTheme.colorScheme.error,
                contentColor = MaterialTheme.colorScheme.onError,
            ),
            contentPadding = padding,
        ) { content() }
        ButtonKind.Secondary -> OutlinedButton(onClick, sized, enabled && !busy, contentPadding = padding) { content() }
        ButtonKind.Quiet -> TextButton(onClick, sized, enabled && !busy, contentPadding = padding) { content() }
    }
}
