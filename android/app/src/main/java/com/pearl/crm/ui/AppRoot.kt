package com.pearl.crm.ui

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
 * choose a PIN → PIN lock → the role's home.
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
        !hasPin -> {
            val vm = viewModel(key = "pin") { PinViewModel(container.pins, container.lock, container.sessions) }
            val state by vm.state.collectAsStateWithLifecycle()
            PinSetupScreen(busy = state.busy, onCreate = { vm.create(it) })
        }
        locked -> {
            val vm = viewModel(key = "pin") { PinViewModel(container.pins, container.lock, container.sessions) }
            val state by vm.state.collectAsStateWithLifecycle()
            PinUnlockScreen(
                title = stringResource(R.string.pin_unlock_title),
                triesLeft = state.triesLeft,
                busy = state.busy,
                onUnlock = { vm.check(it) },
                onForgot = vm::forgot,
            )
        }
        else -> HomeScreen(container, current)
    }
}
