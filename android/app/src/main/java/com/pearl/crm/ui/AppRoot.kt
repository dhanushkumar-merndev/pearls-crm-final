package com.pearl.crm.ui

import com.pearl.crm.ui.pin.BiometricLockScreen
import com.pearl.crm.ui.pin.BiometricSetupScreen
import com.pearl.crm.ui.pin.BiometricUnlock
import androidx.fragment.app.FragmentActivity
import androidx.compose.ui.platform.LocalContext
import androidx.compose.runtime.remember
import androidx.compose.runtime.key
import androidx.activity.compose.LocalActivity
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.pearl.crm.AppContainer
import com.pearl.crm.R
import com.pearl.crm.ui.home.HomeScreen
import com.pearl.crm.ui.login.LoginScreen
import com.pearl.crm.ui.login.LoginViewModel
import com.pearl.crm.ui.pin.PinSetupScreen
import com.pearl.crm.ui.pin.PinUnlockScreen
import com.pearl.crm.ui.pin.PinViewModel
import kotlinx.coroutines.launch

/**
 * What the app shows, in order: not set up → login → "use the web app" (reception/admin) →
 * set up the lock (fingerprint / face, or a PIN on phones without one) → the lock → the role's home.
 */
@Composable
fun AppRoot(container: AppContainer) {
    if (!container.config.isConfigured) {
        NotConfiguredScreen()
        return
    }
    val session by container.sessions.session.collectAsStateWithLifecycle()
    val hasPin by container.pins.hasPin.collectAsStateWithLifecycle()
    val locked by container.lock.locked.collectAsStateWithLifecycle()
    val bioLock by container.settings.biometricLock.collectAsStateWithLifecycle()
    val activity = LocalActivity.current as? FragmentActivity
    val context = LocalContext.current
    // Checked again each time the lock or setup screen shows (a fingerprint may have been added or removed).
    val canBiometric = remember(locked, hasPin, bioLock, session) { BiometricUnlock.available(context) }
    val promptTitle = stringResource(R.string.biometric_title)
    val promptSubtitle = stringResource(R.string.biometric_subtitle)
    val promptCancel = stringResource(R.string.biometric_cancel)
    val current = session
    when {
        current == null -> {
            val vm = viewModel { LoginViewModel(container.sessions) }
            val state by vm.state.collectAsStateWithLifecycle()
            val reason by container.sessions.lastSignOut.collectAsStateWithLifecycle()
            LoginScreen(state, reason, vm::submit)
        }
        current.staffRole?.usesAndroidApp != true ->
            UseWebAppScreen(current.staffRole) { container.scope.launch { container.signOutByChoice() } }
        !hasPin && !bioLock -> {
            val vm = viewModel(key = "pin") { PinViewModel(container.pins, container.lock, container.sessions) }
            val state by vm.state.collectAsStateWithLifecycle()
            // A phone with a fingerprint or face set up uses that instead of a PIN; others keep the PIN.
            if (activity != null && canBiometric) {
                BiometricSetupScreen(onTurnOn = {
                    BiometricUnlock.prompt(activity, promptTitle, promptSubtitle, promptCancel) {
                        container.settings.setBiometricLock(true)
                        vm.biometricOk()
                    }
                })
            } else {
                PinSetupScreen(busy = state.busy, onCreate = { vm.create(it) })
            }
        }
        locked -> {
            val vm = viewModel(key = "pin") { PinViewModel(container.pins, container.lock, container.sessions) }
            val state by vm.state.collectAsStateWithLifecycle()
            if (bioLock) {
                BiometricLockScreen(
                    onPrompt = if (activity != null && canBiometric) {
                        { BiometricUnlock.prompt(activity, promptTitle, promptSubtitle, promptCancel, vm::biometricOk) }
                    } else {
                        null
                    },
                    onLoginInstead = vm::loginInstead,
                )
            } else {
                PinUnlockScreen(
                    title = stringResource(R.string.pin_unlock_title),
                    triesLeft = state.triesLeft,
                    busy = state.busy,
                    onUnlock = { vm.check(it) },
                    onForgot = vm::forgot,
                )
            }
        }
        // Each person (and role) gets its own screen history: one kept from someone else holds screens
        // this menu does not have, and Android restoring it (rotation, dark mode, app reopened) crashes.
        else -> key(current.staffId, current.staffRole) { HomeScreen(container, current) }
    }
}
