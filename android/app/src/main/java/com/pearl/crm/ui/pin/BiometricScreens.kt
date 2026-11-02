package com.pearl.crm.ui.pin

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Login
import androidx.compose.material.icons.outlined.Fingerprint
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import com.pearl.crm.R
import com.pearl.crm.core.ui.components.ButtonKind
import com.pearl.crm.core.ui.components.PearlButton
import com.pearl.crm.ui.AuthLayout

/** Right after login on a phone with a fingerprint or face set up: one tap turns it on (no PIN). */
@Composable
fun BiometricSetupScreen(onTurnOn: () -> Unit) {
    AuthLayout(stringResource(R.string.biometric_setup_title), stringResource(R.string.biometric_setup_body)) {
        PearlButton(stringResource(R.string.biometric_setup_button), Icons.Outlined.Fingerprint, onTurnOn, Modifier.fillMaxWidth().testTag("biometric-setup"))
    }
}

/**
 * The app lock on a fingerprint phone: just the logo and the phone's own prompt (asked straight
 * away). [onPrompt] is null when the phone no longer has a fingerprint or face set up; then only
 * "Log in with password" is left.
 */
@Composable
fun BiometricLockScreen(onPrompt: (() -> Unit)?, onLoginInstead: () -> Unit) {
    LaunchedEffect(onPrompt != null) { onPrompt?.invoke() }
    AuthLayout(
        stringResource(R.string.pin_unlock_title),
        if (onPrompt == null) stringResource(R.string.biometric_gone) else null,
    ) {
        onPrompt?.let {
            PearlButton(stringResource(R.string.biometric_unlock), Icons.Outlined.Fingerprint, it, Modifier.fillMaxWidth().testTag("biometric-unlock"))
        }
        PearlButton(
            stringResource(R.string.biometric_login_instead),
            Icons.AutoMirrored.Outlined.Login,
            onLoginInstead,
            Modifier.testTag("biometric-login"),
            kind = if (onPrompt == null) ButtonKind.Primary else ButtonKind.Quiet,
        )
    }
}
