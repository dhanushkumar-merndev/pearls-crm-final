package com.pearl.crm.ui.home

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.pearl.crm.AppContainer
import com.pearl.crm.BuildConfig
import com.pearl.crm.R
import com.pearl.crm.core.data.auth.Session
import com.pearl.crm.core.ui.components.StatusLabel
import com.pearl.crm.core.ui.components.StatusTone
import com.pearl.crm.feature.settings.FailedChange
import com.pearl.crm.feature.settings.SettingsScreen
import com.pearl.crm.feature.settings.SettingsUiState
import com.pearl.crm.push.Push
import com.pearl.crm.ui.ComingSoonScreen
import com.pearl.crm.ui.pin.PinSetupScreen
import com.pearl.crm.ui.pin.PinUnlockScreen
import com.pearl.crm.ui.pin.PinViewModel
import kotlinx.coroutines.launch

private const val CHANGE_PIN = "change-pin"

@Composable
fun HomeScreen(container: AppContainer, session: Session) {
    val role = session.staffRole ?: return
    val tabs = remember(role) { HomeTab.forRole(role) }
    val nav = rememberNavController()
    val backStack by nav.currentBackStackEntryAsState()
    val route = backStack?.destination?.route
    val snackbar = remember { SnackbarHostState() }
    val pinChanged = stringResource(R.string.pin_changed)
    val scope = rememberCoroutineScope()
    AskForNotifications()

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = {
            if (tabs.any { it.route == route }) {
                NavigationBar {
                    tabs.forEach { tab ->
                        NavigationBarItem(
                            selected = route == tab.route,
                            onClick = {
                                nav.navigate(tab.route) {
                                    popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
                            icon = { Icon(tab.icon, contentDescription = null) },
                            label = { Text(stringResource(tab.label)) },
                        )
                    }
                }
            }
        },
    ) { padding ->
        NavHost(nav, startDestination = tabs.first().route, modifier = Modifier.padding(padding)) {
            tabs.forEach { tab ->
                composable(tab.route) {
                    when (tab) {
                        HomeTab.MyDay -> MyDayScreen(container, session)
                        HomeTab.Settings -> SettingsRoute(container, session) { nav.navigate(CHANGE_PIN) }
                        else -> ComingSoonScreen(stringResource(tab.label))
                    }
                }
            }
            composable(CHANGE_PIN) {
                ChangePinRoute(container) { changed ->
                    nav.popBackStack()
                    if (changed) scope.launch { snackbar.showSnackbar(pinChanged) }
                }
            }
        }
    }
}

/** Android 13+: ask once for notification permission when push is set up. */
@Composable
private fun AskForNotifications() {
    val context = LocalContext.current
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && Push.isAvailable(context) && !Push.canNotify(context)) {
            launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}

@Composable
private fun MyDayScreen(container: AppContainer, session: Session) {
    val profile by container.profile.collectAsStateWithLifecycle()
    val status by container.syncRunner.status.collectAsStateWithLifecycle()
    val failed by remember { container.db.outbox().observeFailed() }.collectAsStateWithLifecycle(emptyList())
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(
            stringResource(R.string.home_greeting, profile?.fullName?.takeIf { it.isNotBlank() } ?: session.username),
            style = MaterialTheme.typography.titleLarge,
        )
        if (failed.isNotEmpty()) StatusLabel(stringResource(R.string.home_unsent_failed), StatusTone.Critical)
        if (status.offline) StatusLabel(stringResource(R.string.home_offline), StatusTone.Offline)
        Text(stringResource(R.string.coming_soon), color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun SettingsRoute(container: AppContainer, session: Session, onChangePin: () -> Unit) {
    val profile by container.profile.collectAsStateWithLifecycle()
    val theme by container.settings.theme.collectAsStateWithLifecycle()
    val status by container.syncRunner.status.collectAsStateWithLifecycle()
    val outbox = container.db.outbox()
    val unsent by remember { outbox.observeUnsentCount() }.collectAsStateWithLifecycle(0)
    val failed by remember { outbox.observeFailed() }.collectAsStateWithLifecycle(emptyList())
    val lastPull by remember { container.db.syncMarkers().observeLastPull() }.collectAsStateWithLifecycle(null)
    val scope = container.scope
    SettingsScreen(
        state = SettingsUiState(
            fullName = profile?.fullName,
            username = session.username,
            role = session.staffRole,
            theme = theme,
            unsentCount = unsent,
            failed = failed.map { FailedChange(it.id, it.lastError ?: "unknown", it.createdAt) },
            lastSyncAt = listOfNotNull(status.lastSuccessAt, lastPull).maxOrNull(),
            offline = status.offline,
            syncing = status.running,
            appVersion = "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})",
        ),
        onThemeChange = container.settings::setTheme,
        onChangePin = onChangePin,
        onSyncNow = { scope.launch { container.syncRunner.runOnce() } },
        onRetry = { id ->
            scope.launch {
                outbox.retry(id, System.currentTimeMillis())
                container.scheduler.syncSoon()
            }
        },
        onDiscard = { id -> scope.launch { outbox.delete(id) } },
        onSignOut = { scope.launch { container.signOutByChoice() } },
    )
}

/** Current PIN first, then the new one twice. */
@Composable
private fun ChangePinRoute(container: AppContainer, onDone: (changed: Boolean) -> Unit) {
    val vm = viewModel(key = "change-pin") { PinViewModel(container.pins, container.lock, container.sessions) }
    val state by vm.state.collectAsStateWithLifecycle()
    var step by rememberSaveable { mutableIntStateOf(1) }
    if (step == 1) {
        PinUnlockScreen(
            title = stringResource(R.string.pin_current_title),
            triesLeft = state.triesLeft,
            busy = state.busy,
            onUnlock = { pin -> vm.check(pin) { step = 2 } },
            onCancel = { onDone(false) },
        )
    } else {
        PinSetupScreen(busy = state.busy, onCreate = { pin -> vm.create(pin) { onDone(true) } }, onCancel = { onDone(false) })
    }
}
