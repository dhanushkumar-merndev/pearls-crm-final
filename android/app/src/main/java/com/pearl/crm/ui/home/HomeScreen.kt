package com.pearl.crm.ui.home

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
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
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
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
import com.pearl.crm.core.ui.components.LocalOnline
import com.pearl.crm.core.data.auth.Session
import com.pearl.crm.core.model.StaffRole
import com.pearl.crm.core.ui.components.SyncBanner
import com.pearl.crm.core.ui.components.StatusTone
import com.pearl.crm.core.ui.theme.Spacing
import com.pearl.crm.feature.bdm.BdmDayScreen
import com.pearl.crm.feature.bdm.BdmLeadsScreen
import com.pearl.crm.feature.bdm.BdmVisitsScreen
import com.pearl.crm.feature.sales.AfterCallNotes
import com.pearl.crm.feature.sales.BookScreen
import com.pearl.crm.feature.sales.CallSetupScreen
import com.pearl.crm.feature.sales.LocalVoiceNotes
import com.pearl.crm.feature.sales.RecordingsOnPhoneScreen
import com.pearl.crm.feature.sales.StartedCall
import com.pearl.crm.feature.sales.VoiceNotes
import com.pearl.crm.feature.sales.CallsScreen
import com.pearl.crm.feature.sales.FollowupsScreen
import com.pearl.crm.feature.sales.LeadDetailScreen
import com.pearl.crm.feature.sales.LeadsScreen
import com.pearl.crm.feature.sales.MyDayScreen as SalesMyDayScreen
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
private const val LEAD = "lead/{id}"
private const val CALL_SETUP = "call-setup"
private const val PHONE_RECORDINGS = "phone-recordings"
private const val BOOK = "book/{id}"

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
    val voiceNotes = remember { VoiceNotes(container.voiceRecorder, container.recordings) }
    val isSales = role == StaffRole.SalesExecutive || role == StaffRole.SalesManager
    // Read once per sign-in: the tip shows on this visit to Leads, never after.
    val swipeHint = remember { !container.settings.swipeHintSeen }

    val online by container.network.online.collectAsStateWithLifecycle()
    CompositionLocalProvider(LocalVoiceNotes provides voiceNotes, LocalOnline provides online) {
        Scaffold(
            snackbarHost = { SnackbarHost(snackbar) },
            // Offline / unsent changes: one slim strip above every tab (Settings shows the details itself).
            topBar = {
                if (tabs.any { it.route == route } && route != HomeTab.Settings.route) {
                    HomeSyncBanner(container, onOpenSettings = {
                        nav.navigate(HomeTab.Settings.route) {
                            popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                            launchSingleTop = true
                            restoreState = true
                        }
                    })
                }
            },
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
            // The bars' space is used up here, so screens inside don't add the status/navigation bar again.
            NavHost(nav, startDestination = tabs.first().route, modifier = Modifier.padding(padding).consumeWindowInsets(padding)) {
                val sales = role == StaffRole.SalesExecutive || role == StaffRole.SalesManager
                val openLead: (String) -> Unit = { id -> nav.navigate("lead/$id") }
                // Pull-down on a list of phone data = sync with the server now.
                val sync: suspend () -> Unit = { container.syncRunner.runOnce() }
                tabs.forEach { tab ->
                    composable(tab.route) {
                        when {
                            tab == HomeTab.MyDay && sales -> SalesMyDayRoute(container, session, openLead)
                            tab == HomeTab.MyDay && role == StaffRole.Bdm -> BdmDayRoute(container, session)
                            tab == HomeTab.Visits -> BdmVisitsScreen(container.bdm, session.staffId)
                            tab == HomeTab.Leads && role == StaffRole.Bdm -> BdmLeadsScreen(container.sales, container.library, onRefresh = sync)
                            tab == HomeTab.MyDay -> MyDayScreen(container, session)
                            tab == HomeTab.Leads && sales -> LeadsScreen(
                                container.sales,
                                container.library,
                                openLead,
                                onRefresh = sync,
                                swipeHint = swipeHint,
                                onSwipeHintShown = { container.settings.swipeHintSeen = true },
                            )
                            tab == HomeTab.Followups -> FollowupsScreen(session.staffId, container.sales, container.library, openLead, onRefresh = sync)
                            tab == HomeTab.Calls -> CallsScreen(container.sales, openLead, onRefresh = sync)
                            tab == HomeTab.Settings -> SettingsRoute(
                                container,
                                session,
                                onChangePin = { nav.navigate(CHANGE_PIN) },
                                onCallSetup = if (isSales) ({ nav.navigate(CALL_SETUP) }) else null,
                                onRecordings = if (isSales) ({ nav.navigate(PHONE_RECORDINGS) }) else null,
                            )
                            else -> ComingSoonScreen(stringResource(tab.label))
                        }
                    }
                }
                composable(CALL_SETUP) {
                    CallSetupScreen(container.settings, onScanNow = { container.runRecordingScan() }, onBack = { nav.popBackStack() })
                }
                composable(PHONE_RECORDINGS) {
                    RecordingsOnPhoneScreen(
                        container.recordings,
                        onSyncRequested = { com.pearl.crm.core.sync.RecordingWorker.schedule(container.appContext) },
                        onBack = { nav.popBackStack() },
                    )
                }
                composable(LEAD) { entry ->
                    val id = entry.arguments?.getString("id").orEmpty()
                    LeadDetailScreen(id, container.sales, container.library, onBack = { nav.popBackStack() }, onBook = { nav.navigate("book/$it") })
                }
                composable(BOOK) { entry ->
                    val id = entry.arguments?.getString("id").orEmpty()
                    BookScreen(id, container.sales, container.library, onBack = { nav.popBackStack() }, onBooked = { text ->
                        nav.popBackStack()
                        scope.launch { snackbar.showSnackbar(text) }
                    })
                }
                composable(CHANGE_PIN) {
                    ChangePinRoute(container) { changed ->
                        nav.popBackStack()
                        if (changed) scope.launch { snackbar.showSnackbar(pinChanged) }
                    }
                }
            }
        }
        if (isSales) AfterCallFromPhone(container, snackbar)
    }
}

/** A CRM call just ended (caller flow): the notes sheet with the call's real length. */
@Composable
private fun AfterCallFromPhone(container: AppContainer, snackbar: SnackbarHostState) {
    val request by container.pendingAfterCall.collectAsStateWithLifecycle()
    val call = request ?: return
    val lead by remember(call.leadId) { container.sales.observeLead(call.leadId) }.collectAsStateWithLifecycle(null)
    val scope = rememberCoroutineScope()
    val savedText = stringResource(com.pearl.crm.feature.sales.R.string.saved_offline)
    AfterCallNotes(
        sales = container.sales,
        library = container.library,
        call = StartedCall(call.leadId, call.phone, call.startedAt),
        leadName = lead?.name ?: call.phone,
        durationS = call.durationS,
        direction = call.direction,
        deviceCallKey = call.deviceCallKey,
        onDone = { saved ->
            container.pendingAfterCall.value = null
            if (saved) scope.launch { snackbar.showSnackbar(savedText) }
        },
    )
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

/** Offline, or changes the server refused: the strip shown above every tab. */
@Composable
private fun HomeSyncBanner(container: AppContainer, onOpenSettings: () -> Unit) {
    val status by container.syncRunner.status.collectAsStateWithLifecycle()
    val failed by remember { container.db.outbox().observeFailed() }.collectAsStateWithLifecycle(emptyList())
    val unsent by remember { container.db.outbox().observeUnsentCount() }.collectAsStateWithLifecycle(0)
    val online by container.network.online.collectAsStateWithLifecycle()
    // Below the status bar: this sits in the top bar slot, which doesn't pad itself.
    val inset = Modifier.windowInsetsPadding(WindowInsets.statusBars)
    when {
        failed.isNotEmpty() -> SyncBanner(
            stringResource(R.string.home_unsent_failed),
            StatusTone.Critical,
            inset,
            actionLabel = stringResource(R.string.home_open_settings),
            onAction = onOpenSettings,
        )
        status.offline || !online -> SyncBanner(
            if (unsent > 0) pluralStringResource(R.plurals.home_offline_unsent, unsent, unsent) else stringResource(R.string.home_offline),
            StatusTone.Offline,
            inset,
        )
    }
}

@Composable
private fun MyDayScreen(container: AppContainer, session: Session) {
    val profile by container.profile.collectAsStateWithLifecycle()
    Column(Modifier.fillMaxSize().padding(Spacing.screen), verticalArrangement = Arrangement.spacedBy(Spacing.section)) {
        Text(
            stringResource(R.string.home_greeting, profile?.fullName?.takeIf { it.isNotBlank() } ?: session.username),
            style = MaterialTheme.typography.titleLarge,
        )
        Text(stringResource(R.string.coming_soon), color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun BdmDayRoute(container: AppContainer, session: Session) {
    val profile by container.profile.collectAsStateWithLifecycle()
    BdmDayScreen(
        name = profile?.fullName?.takeIf { it.isNotBlank() } ?: session.username,
        bdm = container.bdm,
        library = container.library,
        location = container.location,
        recorder = container.voiceRecorder,
        photoAuthority = "${BuildConfig.APPLICATION_ID}.files",
        onTrackingNeeded = { com.pearl.crm.bdm.BdmTrackingService.start(container.appContext) },
    )
}

@Composable
private fun SalesMyDayRoute(container: AppContainer, session: Session, openLead: (String) -> Unit) {
    val profile by container.profile.collectAsStateWithLifecycle()
    SalesMyDayScreen(
        name = profile?.fullName?.takeIf { it.isNotBlank() } ?: session.username,
        sales = container.sales,
        onOpenLead = openLead,
    )
}

@Composable
private fun SettingsRoute(
    container: AppContainer,
    session: Session,
    onChangePin: () -> Unit,
    onCallSetup: (() -> Unit)?,
    onRecordings: (() -> Unit)?,
) {
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
            failed = failed.map { FailedChange(it.id, it.lastError ?: "unknown", it.createdAt, it.rpc) },
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
        onCallSetup = onCallSetup,
        onRecordings = onRecordings,
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
