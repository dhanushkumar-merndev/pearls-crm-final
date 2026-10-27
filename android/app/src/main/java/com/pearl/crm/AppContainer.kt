package com.pearl.crm

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import androidx.core.content.ContextCompat
import androidx.room.withTransaction
import com.pearl.crm.calls.AfterCallRequest
import com.pearl.crm.core.data.AccountRepository
import com.pearl.crm.core.data.BdmRepository
import com.pearl.crm.core.data.device.DeviceLocation
import com.pearl.crm.core.data.CallLogImporter
import com.pearl.crm.core.data.RecordingsRepository
import com.pearl.crm.core.data.audio.AacTranscoder
import com.pearl.crm.core.data.audio.VoiceRecorder
import com.pearl.crm.core.data.device.ContentCallLogSource
import com.pearl.crm.core.data.device.SafRecordingFolder
import com.pearl.crm.core.data.net.EdgeClient
import com.pearl.crm.core.data.net.SignedUploader
import com.pearl.crm.core.data.LibraryRepository
import com.pearl.crm.core.data.OutboxWriter
import com.pearl.crm.core.data.SalesRepository
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
import com.pearl.crm.core.model.StaffRole
import com.pearl.crm.core.sync.AppointmentsSync
import com.pearl.crm.core.sync.CallLogsSync
import com.pearl.crm.core.sync.CrmNumbersSync
import com.pearl.crm.core.sync.FollowupsSync
import com.pearl.crm.core.sync.LeadsSync
import com.pearl.crm.core.sync.LookupValuesSync
import com.pearl.crm.core.sync.OutboxProcessor
import com.pearl.crm.core.sync.PullEngine
import com.pearl.crm.core.sync.RecordingWorker
import com.pearl.crm.core.sync.SyncRunner
import com.pearl.crm.core.sync.SyncScheduler
import com.pearl.crm.push.Push
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
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
    val appContext: Context get() = context
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
    val sales = SalesRepository(rpc, db, outbox)
    private val edge = EdgeClient(config, http, sessions)
    val callLogSource = ContentCallLogSource(context)
    private val callLogImporter = CallLogImporter(callLogSource, db, outbox, settings, { sessions.session.value?.staffId })
    val recordings = RecordingsRepository(
        rpc, db, outbox, SignedUploader(edge, http), AacTranscoder(context, File(context.cacheDir, "recordings")), settings,
    )
    val voiceRecorder = VoiceRecorder(context, File(context.filesDir, "voice-notes"))
    val location = DeviceLocation(context)
    val bdm = BdmRepository(
        rpc, db, outbox, SignedUploader(edge, http), recordings, context.getSharedPreferences("pearl.bdm", Context.MODE_PRIVATE),
    )

    /** A finished CRM call waiting for its notes (set by the caller flow, shown by the home screen). */
    val pendingAfterCall = MutableStateFlow<AfterCallRequest?>(null)
    val pins = PinController(PinStore(securePrefs))
    val lock = AppLock(settings, pins)
    val scheduler = SyncScheduler(context)

    /** Live connection state for the offline strip; a sync runs as soon as signal returns. */
    val network = NetworkMonitor(context) { if (sessions.session.value != null) scheduler.syncSoon() }
    val crashes = CrashReporter(File(context.filesDir, "crash-reports"), appVersion)
    val syncRunner = SyncRunner(
        outbox = OutboxProcessor(db.outbox(), rpc),
        pull = PullEngine(
            transport = rpc,
            entities = listOf(
                LookupValuesSync(db.lookupValues()),
                LeadsSync(db.leads()),
                FollowupsSync(db.followups()),
                AppointmentsSync(db.appointments()),
                CallLogsSync(db.callLogs()),
                CrmNumbersSync(db.crmNumbers()),
            ),
            markers = db.syncMarkers(),
            inTransaction = { block -> db.withTransaction { block() } },
        ),
        isSignedIn = { sessions.session.value != null },
        afterPull = {
            sales.tidyAfterPull()
            RecordingWorker.schedule(context)
        },
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
            if (owner != null && owner != staffId) {
                db.clearAllTables()
                settings.callLogImportedUntil = 0
                bdm.clear()
                settings.profileName = null
            }
            settings.databaseOwner = staffId
        }
        // Greet by the remembered name straight away; me() below refreshes it.
        val session = sessions.session.value
        settings.profileName?.let { _profile.value = StaffProfile(staffId, session?.staffRole, it, session?.username) }
        crashes.flush(outbox)
        scheduler.startPeriodic()
        scheduler.syncSoon()
        scope.launch { refreshProfile() }
        if (sessions.session.value?.staffRole == StaffRole.Bdm) {
            // Today's day as the server knows it (e.g. after a reinstall or the auto-end).
            runCatching { bdm.refreshFromServer() }
        }
        Push.registerToken(context) { token -> scope.launch { account.registerPushToken(token, appVersion) } }
    }

    /** me(), retried a few times: a failed first try (no network yet) used to leave the username on screen. */
    private suspend fun refreshProfile() {
        for (wait in listOf(0L, 5_000L, 30_000L, 120_000L)) {
            delay(wait)
            if (sessions.session.value == null) return
            try {
                val profile = account.refreshProfile()
                _profile.value = profile
                settings.profileName = profile.fullName.takeIf { it.isNotBlank() }
                return
            } catch (_: RpcFailure) {
                // Offline: the role from the login token is used meanwhile.
            }
        }
    }

    private fun onSignedOut() {
        scheduler.stopAll()
        RecordingWorker.cancel(context)
        com.pearl.crm.bdm.BdmTrackingService.stop(context)
        _profile.value = null
        settings.profileName = null
        // A new login always sets a new PIN.
        pins.clear()
    }

    fun granted(permission: String): Boolean = ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    /**
     * Call log import, new recordings, the server's requests, uploads (RecordingWorker).
     * Returns true when an upload is still waiting for a connection.
     */
    suspend fun runRecordings(): Boolean {
        val role = sessions.session.value?.staffRole ?: return false
        if (role == StaffRole.Bdm) {
            // Punch photos taken without signal, then visit recordings.
            try {
                bdm.uploadPendingPhotos()
            } catch (_: RpcFailure.Transient) {
                return true
            } catch (_: RpcFailure) {
            }
            return recordings.uploadQueued().offline
        }
        if (role != StaffRole.SalesExecutive && role != StaffRole.SalesManager) return false
        if (granted(Manifest.permission.READ_CALL_LOG)) runCatching { callLogImporter.import() }
        settings.recordingFolder?.let { folder ->
            runCatching { recordings.scan(SafRecordingFolder(context, Uri.parse(folder))) }
        }
        try {
            recordings.applyServerTasks()
        } catch (_: RpcFailure.Transient) {
            return true
        } catch (_: RpcFailure) {
            // Signed out or refused: uploads below will say so.
        }
        return recordings.uploadQueued().offline
    }

    /** "Look for recordings now" in the setup screen: import calls, then scan the folder. */
    suspend fun runRecordingScan(): Int {
        if (granted(Manifest.permission.READ_CALL_LOG)) runCatching { callLogImporter.import() }
        val folder = settings.recordingFolder ?: return 0
        val found = recordings.scan(SafRecordingFolder(context, Uri.parse(folder)))
        if (found > 0) RecordingWorker.schedule(context)
        return found
    }

    /** "Sign out" in Settings: ends the session and removes this person's data from the phone. */
    suspend fun signOutByChoice() {
        scheduler.stopAll()
        sessions.signOut(SignOutReason.UserChoice)
        withContext(Dispatchers.IO) { db.clearAllTables() }
        bdm.clear()
        settings.databaseOwner = null
    }
}
