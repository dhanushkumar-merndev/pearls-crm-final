package com.pearl.crm.ui.pin

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.automirrored.outlined.Backspace
import androidx.compose.material.icons.automirrored.outlined.HelpOutline
import androidx.compose.material.icons.automirrored.outlined.Login
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.material.icons.outlined.Save
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.pearl.crm.R
import com.pearl.crm.core.data.security.PinStore
import com.pearl.crm.core.ui.components.ButtonKind
import com.pearl.crm.core.ui.components.PearlButton
import com.pearl.crm.core.ui.components.StatusLabel
import com.pearl.crm.core.ui.components.StatusTone
import com.pearl.crm.core.ui.theme.Pearl
import com.pearl.crm.core.ui.theme.Spacing
import com.pearl.crm.ui.AuthLayout

/** PIN dots: one per digit typed, never fewer than the shortest PIN. The digits are never shown. */
@Composable
private fun PinDots(length: Int) {
    val label = pluralStringResource(R.plurals.pin_entered, length, length)
    Row(
        Modifier.padding(vertical = Spacing.m).semantics { contentDescription = label },
        horizontalArrangement = Arrangement.spacedBy(Spacing.l),
    ) {
        repeat(maxOf(PinStore.MIN_LENGTH, length)) { i ->
            val filled = i < length
            val colour = if (filled) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline
            Box(
                Modifier
                    .size(14.dp)
                    .clip(CircleShape)
                    .background(if (filled) colour else Color.Transparent)
                    .border(1.5.dp, colour, CircleShape),
            )
        }
    }
}

private val KEY = 68.dp

/** Phone-style number pad, so the screen doesn't jump around under the system keyboard. Digits only, at most 6. */
@Composable
private fun PinPad(value: String, onValueChange: (String) -> Unit, enabled: Boolean) {
    fun type(d: Char) {
        if (value.length < PinStore.MAX_LENGTH) onValueChange(value + d)
    }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.m), horizontalAlignment = Alignment.CenterHorizontally) {
        listOf("123", "456", "789").forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xl)) {
                row.forEach { d -> PinKey(d, enabled) { type(d) } }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xl), verticalAlignment = Alignment.CenterVertically) {
            Spacer(Modifier.size(KEY))
            PinKey('0', enabled) { type('0') }
            IconButton(
                onClick = { onValueChange(value.dropLast(1)) },
                enabled = enabled && value.isNotEmpty(),
                modifier = Modifier.size(KEY).testTag("pin-delete"),
            ) {
                Icon(Icons.AutoMirrored.Outlined.Backspace, contentDescription = stringResource(R.string.pin_delete))
            }
        }
    }
}

@Composable
private fun PinKey(digit: Char, enabled: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = CircleShape,
        color = Pearl.palette.raised,
        modifier = Modifier.size(KEY).testTag("pin-key-$digit"),
    ) {
        Box(contentAlignment = Alignment.Center) {
            Text(digit.toString(), style = MaterialTheme.typography.headlineSmall)
        }
    }
}

/** Choose a PIN, then type it again. A mismatch starts over. */
@Composable
fun PinSetupScreen(busy: Boolean, onCreate: (String) -> Unit, onCancel: (() -> Unit)? = null) {
    var step by rememberSaveable { mutableIntStateOf(1) }
    var first by remember { mutableStateOf("") }
    var entry by remember { mutableStateOf("") }
    var mismatch by rememberSaveable { mutableStateOf(false) }
    val valid = PinStore.isValidPin(entry)

    fun next() {
        if (!valid || busy) return
        if (step == 1) {
            first = entry
            entry = ""
            mismatch = false
            step = 2
        } else if (entry == first) {
            onCreate(entry)
        } else {
            first = ""
            entry = ""
            mismatch = true
            step = 1
        }
    }

    AuthLayout(
        stringResource(if (step == 1) R.string.pin_create_title else R.string.pin_confirm_title),
        stringResource(R.string.pin_create_body),
    ) {
        PinDots(entry.length)
        if (mismatch) StatusLabel(stringResource(R.string.pin_mismatch), StatusTone.Critical)
        PinPad(entry, { entry = it; mismatch = false }, enabled = !busy)
        if (step == 1) {
            PearlButton(stringResource(R.string.pin_next), Icons.AutoMirrored.Outlined.ArrowForward, ::next, Modifier.fillMaxWidth(), enabled = valid)
        } else {
            PearlButton(stringResource(R.string.pin_save), Icons.Outlined.Save, ::next, Modifier.fillMaxWidth(), enabled = valid, busy = busy)
        }
        onCancel?.let { PearlButton(stringResource(R.string.pin_cancel), Icons.Outlined.Close, it, kind = ButtonKind.Quiet) }
    }
}

/**
 * Enter the PIN. [triesLeft] is shown after a wrong try. "Forgot PIN?" (when given) asks
 * first, then logs out so the person can log in with the password.
 */
@Composable
fun PinUnlockScreen(
    title: String,
    triesLeft: Int?,
    busy: Boolean,
    onUnlock: (String) -> Unit,
    onForgot: (() -> Unit)? = null,
    onCancel: (() -> Unit)? = null,
) {
    var entry by remember { mutableStateOf("") }
    var forgotOpen by rememberSaveable { mutableStateOf(false) }
    val valid = PinStore.isValidPin(entry)

    fun submit() {
        if (!valid || busy) return
        onUnlock(entry)
        entry = ""
    }

    AuthLayout(title) {
        PinDots(entry.length)
        triesLeft?.let { StatusLabel(pluralStringResource(R.plurals.pin_wrong, it, it), StatusTone.Critical) }
        PinPad(entry, { entry = it }, enabled = !busy)
        PearlButton(stringResource(R.string.pin_unlock), Icons.Outlined.LockOpen, ::submit, Modifier.fillMaxWidth(), enabled = valid, busy = busy)
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
            onForgot?.let {
                PearlButton(stringResource(R.string.pin_forgot), Icons.AutoMirrored.Outlined.HelpOutline, { forgotOpen = true }, kind = ButtonKind.Quiet)
            }
            onCancel?.let { PearlButton(stringResource(R.string.pin_cancel), Icons.Outlined.Close, it, kind = ButtonKind.Quiet) }
        }
    }

    if (forgotOpen && onForgot != null) {
        AlertDialog(
            onDismissRequest = { forgotOpen = false },
            title = { Text(stringResource(R.string.pin_forgot_title)) },
            text = { Text(stringResource(R.string.pin_forgot_body)) },
            confirmButton = {
                PearlButton(
                    stringResource(R.string.pin_forgot_confirm),
                    Icons.AutoMirrored.Outlined.Login,
                    {
                        forgotOpen = false
                        onForgot()
                    },
                )
            },
            dismissButton = {
                PearlButton(stringResource(R.string.pin_cancel), Icons.Outlined.Close, { forgotOpen = false }, kind = ButtonKind.Quiet)
            },
        )
    }
}
