package com.pearl.crm.ui.pin

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.automirrored.outlined.HelpOutline
import androidx.compose.material.icons.automirrored.outlined.Login
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.material.icons.outlined.Save
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pearl.crm.R
import com.pearl.crm.core.data.security.PinStore
import com.pearl.crm.core.ui.components.ButtonKind
import com.pearl.crm.core.ui.components.PearlButton
import com.pearl.crm.core.ui.components.StatusLabel
import com.pearl.crm.core.ui.components.StatusTone
import com.pearl.crm.core.ui.theme.Pearl

/** Digits only, at most 6, never shown. Kept out of saved state on purpose. */
@Composable
fun PinField(value: String, onValueChange: (String) -> Unit, onDone: () -> Unit, modifier: Modifier = Modifier) {
    OutlinedTextField(
        value = value,
        onValueChange = { onValueChange(it.filter(Char::isDigit).take(PinStore.MAX_LENGTH)) },
        label = { Text(stringResource(R.string.pin_label)) },
        singleLine = true,
        visualTransformation = PasswordVisualTransformation(),
        textStyle = MaterialTheme.typography.titleLarge.copy(letterSpacing = 6.sp),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { onDone() }),
        modifier = modifier.fillMaxWidth(),
    )
}

@Composable
private fun PinLayout(content: @Composable () -> Unit) {
    Column(
        Modifier
            .fillMaxSize()
            .safeDrawingPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Column(Modifier.widthIn(max = 480.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(16.dp)) { content() }
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

    PinLayout {
        Text(stringResource(if (step == 1) R.string.pin_create_title else R.string.pin_confirm_title), style = MaterialTheme.typography.titleLarge)
        Text(stringResource(R.string.pin_create_body), color = Pearl.palette.textSecondary)
        if (mismatch) StatusLabel(stringResource(R.string.pin_mismatch), StatusTone.Critical)
        PinField(entry, { entry = it }, ::next)
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

    PinLayout {
        Text(title, style = MaterialTheme.typography.titleLarge)
        PinField(entry, { entry = it }, ::submit)
        triesLeft?.let { StatusLabel(pluralStringResource(R.plurals.pin_wrong, it, it), StatusTone.Critical) }
        PearlButton(stringResource(R.string.pin_unlock), Icons.Outlined.LockOpen, ::submit, Modifier.fillMaxWidth(), enabled = valid, busy = busy)
        onForgot?.let {
            PearlButton(stringResource(R.string.pin_forgot), Icons.AutoMirrored.Outlined.HelpOutline, { forgotOpen = true }, kind = ButtonKind.Quiet)
        }
        onCancel?.let { PearlButton(stringResource(R.string.pin_cancel), Icons.Outlined.Close, it, kind = ButtonKind.Quiet) }
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
