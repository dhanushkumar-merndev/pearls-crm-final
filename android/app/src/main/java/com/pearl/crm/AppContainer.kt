package com.pearl.crm

import android.content.Context
import androidx.room.withTransaction
import com.pearl.crm.core.data.AccountRepository
import com.pearl.crm.core.data.LibraryRepository
import com.pearl.crm.core.data.OutboxWriter
import com.pearl.crm.core.data.SettingsStore
import com.pearl.crm.core.data.auth.AuthApi
import com.pearl.crm.core.data.auth.SessionManager
import com.pearl.crm.core.data.auth.SessionStore
import com.pearl.crm.core.data.auth.SignOutReason
import com.pearl.crm.core.data.db.AppDatabase
import com.pearl.crm.core.data.net.RpcClient
import com.pearl.crm.core.data.net.SupabaseConfig
import com.pearl.crm.core.data.net.defaultHttpClient
import com.pearl.crm.core.data.security.KeystoreSecretBox
import com.pearl.crm.core.data.security.PinController
import com.pearl.crm.core.data.security.PinStore
import com.pearl.crm.core.data.security.SecurePrefs
import com.pearl.crm.core.model.LibrarySource
import com.pearl.crm.core.model.RpcFailure
import com.pearl.crm.core.model.StaffProfile
import com.pearl.crm.core.sync.LookupValuesSync
import com.pearl.crm.core.sync.OutboxProcessor
import com.pearl.crm.core.sync.PullEngine
import com.pearl.crm.core.sync.SyncRunner
import com.pearl.crm.core.sync.SyncScheduler
import com.pearl.crm.push.Push
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/** Everything the app needs, made once per process (simple manual wiring; no DI framework). */
class AppContainer(private val context: Context) {
    val config = SupabaseConfig(BuildConfig.SUPABASE_URL, BuildConfig.SUPABASE_ANON_KEY)
    val appVersion: String = BuildConfig.VERSION_NAME
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    private val http = defaultHttpClient()
    private val securePrefs = SecurePrefs(context.getSharedPreferences("pearl.secure", Context.MODE_PRIVATE), KeystoreSecretBox())
    val settings = SettingsStore(context.getSharedPreferences("pearl.settings", Context.MODE_PRIVATE))
    val sessions = SessionManager(AuthApi(config, http), SessionStore(securePrefs))
    private val rpc = RpcClient(config, http, sessions)
    val db = AppDatabase.build(context)
    val outbox = OutboxWriter(db.outbox())
    val library: LibrarySource = LibraryRepository(rpc, db.lookupValues())
    val account = AccountRepository(rpc, sessions, outbox)
    val pins = PinController(PinStore(securePrefs))
    val lock = AppLock(settings, pins)
    val scheduler = SyncScheduler(context)
    val crashes = CrashReporter(File(context.filesDir, "crash-reports"), appVersion)
    val syncRunner = SyncRunner(
        outbox = OutboxProcessor(db.outbox(), rpc),
        pull = PullEngine(
            transport = rpc,
            entities = listOf(LookupValuesSync(db.lookupValues())),
            markers = db.syncMarkers(),
            inTransaction = { block -> db.withTransaction { block() } },
        ),
        isSignedIn = { sessions.session.value != null },
    )

    private val _profile = MutableStateFlow<StaffProfile?>(null)

    /** From `me()` after login (name for the screens); null until loaded. */
    val profile: StateFlow<StaffProfile?> = _profile.asStateFlow()

    init {
        outbox.onEnqueued = { if (sessions.session.value != null) scheduler.syncSoon() }
        scope.launch {
            sessions.session.map { it?.staffId }.distinctUntilChanged().collect { staffId ->
                if (staffId != null) onSignedIn(staffId) else onSignedOut()
            }
        }
    }

    private suspend fun onSignedIn(staffId: String) {
        // The phone keeps one person's data: someone else logging in starts from empty.
        withContext(Dispatchers.IO) {
            val owner = settings.databaseOwner
            if (owner != null && owner != staffId) db.clearAllTables()
            settings.databaseOwner = staffId
        }
        crashes.flush(outbox)
        scheduler.startPeriodic()
        scheduler.syncSoon()
        try {
            _profile.value = account.refreshProfile()
        } catch (_: RpcFailure) {
            // Offline: the role from the login token is used until the next start.
        }
        Push.registerToken(context) { token -> scope.launch { account.registerPushToken(token, appVersion) } }
    }

    private fun onSignedOut() {
        scheduler.stopAll()
        _profile.value = null
        // A new login always sets a new PIN.
        pins.clear()
    }

    /** "Sign out" in Settings: ends the session and removes this person's data from the phone. */
    suspend fun signOutByChoice() {
        scheduler.stopAll()
        sessions.signOut(SignOutReason.UserChoice)
        withContext(Dispatchers.IO) { db.clearAllTables() }
        settings.databaseOwner = null
    }
}
