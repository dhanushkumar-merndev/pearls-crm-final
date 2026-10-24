package com.pearl.crm.feature.sales

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.DocumentsContract
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.BatteryChargingFull
import androidx.compose.material.icons.outlined.CloudUpload
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Layers
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pearl.crm.core.data.RecordingStatus
import com.pearl.crm.core.data.RecordingsRepository
import com.pearl.crm.core.data.SettingsStore
import com.pearl.crm.core.data.db.RecordingWithLead
import com.pearl.crm.core.model.IstDates
import com.pearl.crm.core.ui.components.ButtonKind
import com.pearl.crm.core.ui.components.PearlButton
import com.pearl.crm.core.ui.components.StatusLabel
import com.pearl.crm.core.ui.components.StatusTone
import com.pearl.crm.core.ui.components.errorMessage
import com.pearl.crm.core.ui.theme.Pearl
import kotlinx.coroutines.launch

@Composable
private fun recordingStatusLabel(status: String): String = stringResource(
    when (status) {
        RecordingStatus.QUEUED -> R.string.rec_status_queued
        RecordingStatus.UPLOADING -> R.string.rec_status_uploading
        RecordingStatus.SYNCED -> R.string.rec_status_synced
        RecordingStatus.FAILED -> R.string.rec_status_failed
        else -> R.string.rec_status_on_phone
    },
)

/** "Recordings on this phone": what was found, what's uploaded, and Sync for the rest. */
@Composable
fun RecordingsOnPhoneScreen(recordings: RecordingsRepository, onSyncRequested: () -> Unit, onBack: () -> Unit) {
    val rows by remember { recordings.observe() }.collectAsStateWithLifecycle(null)
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 8.dp)) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, stringResource(R.string.back)) }
            Text(stringResource(R.string.rec_title), style = MaterialTheme.typography.titleLarge)
        }
        Muted(stringResource(R.string.rec_hint))
        val list = rows
        val waiting = list.orEmpty().filter { it.recording.status == RecordingStatus.ON_PHONE || it.recording.status == RecordingStatus.FAILED }
        if (waiting.isNotEmpty()) {
            PearlButton(stringResource(R.string.rec_sync_all, waiting.size), Icons.Outlined.CloudUpload, {
                scope.launch {
                    recordings.syncNow(waiting.map { it.recording.id })
                    onSyncRequested()
                }
            }, modifier = Modifier.testTag("rec-sync-all"))
        }
        if (list != null && list.isEmpty()) Muted(stringResource(R.string.rec_empty))
        if (!list.isNullOrEmpty()) {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.weight(1f)) {
                items(list, key = { it.recording.id }) { row ->
                    RecordingRow(row) {
                        scope.launch {
                            recordings.syncNow(listOf(row.recording.id))
                            onSyncRequested()
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun RecordingRow(row: RecordingWithLead, onSync: () -> Unit) {
    val r = row.recording
    Surface(shape = MaterialTheme.shapes.medium, tonalElevation = 1.dp, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    row.leadName ?: stringResource(if (r.kind == "voice_note") R.string.rec_voice_note else R.string.rec_call),
                    style = MaterialTheme.typography.titleMedium,
                )
                Text(
                    "${IstDates.formatDateTime(r.recordedAt)} · ${r.durationS / 60}:${"%02d".format(r.durationS % 60)}",
                    color = Pearl.palette.textSecondary,
                )
                val tone = when (r.status) {
                    RecordingStatus.SYNCED -> StatusTone.Good
                    RecordingStatus.FAILED -> StatusTone.Critical
                    else -> StatusTone.Info
                }
                StatusLabel(recordingStatusLabel(r.status), tone)
                if (r.trimmed && r.uploadedS != null) Muted(pluralStringResource(R.plurals.rec_trimmed, r.uploadedS!! / 60, r.uploadedS!! / 60))
                if (r.needsReview) Muted(stringResource(R.string.rec_check_match))
                if (r.status == RecordingStatus.FAILED && r.error != null) Muted(errorMessage(r.error!!))
            }
            if (r.status == RecordingStatus.ON_PHONE || r.status == RecordingStatus.FAILED) {
                PearlButton(stringResource(R.string.rec_sync), Icons.Outlined.CloudUpload, onSync, kind = ButtonKind.Secondary)
            }
        }
    }
}

/** Where each brand's dialer keeps recordings, for the folder step. */
fun recordingFolderHint(manufacturer: String = Build.MANUFACTURER): Int = when (manufacturer.lowercase()) {
    "samsung" -> R.string.setup_folder_samsung
    "xiaomi", "redmi", "poco" -> R.string.setup_folder_xiaomi
    "oneplus", "oppo", "realme" -> R.string.setup_folder_coloros
    "vivo", "iqoo" -> R.string.setup_folder_vivo
    else -> R.string.setup_folder_other
}

/** How to stop each brand from killing the app in the background. */
fun batteryGuide(manufacturer: String = Build.MANUFACTURER): Int = when (manufacturer.lowercase()) {
    "samsung" -> R.string.setup_battery_samsung
    "xiaomi", "redmi", "poco" -> R.string.setup_battery_xiaomi
    "oneplus", "oppo", "realme" -> R.string.setup_battery_coloros
    "vivo", "iqoo" -> R.string.setup_battery_vivo
    else -> R.string.setup_battery_other
}

private fun granted(context: Context, vararg permissions: String) =
    permissions.all { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }

/**
 * One-time setup for calls and recordings, each step with its own button and a tick when done.
 * Checked again every time the screen comes back (the person may change things in Settings).
 */
@Composable
fun CallSetupScreen(settings: SettingsStore, onScanNow: suspend () -> Int, onBack: () -> Unit) {
    val context = LocalContext.current
    var refresh by remember { mutableIntStateOf(0) }
    LifecycleResumeEffect(Unit) {
        refresh++
        onPauseOrDispose { }
    }
    val phoneOk = remember(refresh) { granted(context, Manifest.permission.READ_PHONE_STATE, Manifest.permission.READ_CALL_LOG) }
    val overlayOk = remember(refresh) { Settings.canDrawOverlays(context) }
    val notifyOk = remember(refresh) { Build.VERSION.SDK_INT < 33 || granted(context, Manifest.permission.POST_NOTIFICATIONS) }
    val micOk = remember(refresh) { granted(context, Manifest.permission.RECORD_AUDIO) }
    val batteryOk = remember(refresh) { context.getSystemService(PowerManager::class.java)?.isIgnoringBatteryOptimizations(context.packageName) == true }
    var folder by remember { mutableStateOf(settings.recordingFolder) }
    var popup by remember { mutableStateOf(settings.callerPopup) }
    var found by remember { mutableStateOf<Int?>(null) }
    var scanning by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    val phonePerms = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { refresh++ }
    val single = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { refresh++ }
    val pickFolder = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        if (uri != null) {
            context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            settings.recordingFolder = uri.toString()
            folder = uri.toString()
        }
    }
    val open = { intent: Intent -> runCatching { context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, stringResource(R.string.back)) }
            Text(stringResource(R.string.setup_title), style = MaterialTheme.typography.titleLarge)
        }
        Muted(stringResource(R.string.setup_intro))

        Step(stringResource(R.string.setup_phone), stringResource(R.string.setup_phone_why), phoneOk, Icons.Outlined.Phone, "setup-phone") {
            phonePerms.launch(arrayOf(Manifest.permission.READ_PHONE_STATE, Manifest.permission.READ_CALL_LOG))
        }
        Step(stringResource(R.string.setup_overlay), stringResource(R.string.setup_overlay_why), overlayOk, Icons.Outlined.Layers, "setup-overlay") {
            open(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}")))
        }
        Step(stringResource(R.string.setup_notify), stringResource(R.string.setup_notify_why), notifyOk, Icons.Outlined.Notifications, "setup-notify") {
            if (Build.VERSION.SDK_INT >= 33) single.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        Step(stringResource(R.string.setup_battery), stringResource(batteryGuide()), batteryOk, Icons.Outlined.BatteryChargingFull, "setup-battery") {
            @Suppress("BatteryLife") // installed directly for staff phones; the brief requires calls to be caught reliably
            open(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}")))
        }
        Step(stringResource(R.string.setup_mic), stringResource(R.string.setup_mic_why), micOk, Icons.Outlined.Mic, "setup-mic") {
            single.launch(Manifest.permission.RECORD_AUDIO)
        }
        Step(
            stringResource(R.string.setup_folder),
            folder?.let { stringResource(R.string.setup_folder_chosen, folderName(it)) } ?: stringResource(recordingFolderHint()),
            folder != null,
            Icons.Outlined.Folder,
            "setup-folder",
            actionLabel = if (folder != null) stringResource(R.string.setup_change) else null,
        ) { pickFolder.launch(null) }

        HorizontalDivider()
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.setup_popup), style = MaterialTheme.typography.titleMedium)
                Muted(stringResource(R.string.setup_popup_why))
            }
            Switch(checked = popup, onCheckedChange = {
                popup = it
                settings.callerPopup = it
            }, modifier = Modifier.testTag("setup-popup"))
        }
        PearlButton(stringResource(R.string.setup_check), Icons.Outlined.Search, {
            scanning = true
            scope.launch {
                found = runCatching { onScanNow() }.getOrNull() ?: 0
                scanning = false
            }
        }, kind = ButtonKind.Secondary, busy = scanning, enabled = folder != null)
        found?.let { Muted(pluralStringResource(R.plurals.setup_found_plural, it, it)) }
    }
}

private fun folderName(uri: String): String =
    runCatching { DocumentsContract.getTreeDocumentId(Uri.parse(uri)).substringAfter(':').ifBlank { uri } }.getOrDefault(uri)

@Composable
private fun Step(
    title: String,
    why: String,
    done: Boolean,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    tag: String,
    actionLabel: String? = null,
    onFix: () -> Unit,
) {
    Surface(shape = MaterialTheme.shapes.medium, tonalElevation = 1.dp, modifier = Modifier.fillMaxWidth().testTag(tag)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Muted(why)
            if (done) StatusLabel(stringResource(R.string.setup_done), StatusTone.Good)
            if (!done || actionLabel != null) {
                PearlButton(actionLabel ?: stringResource(R.string.setup_fix), icon, onFix, kind = if (done) ButtonKind.Quiet else ButtonKind.Secondary)
            }
        }
    }
}
