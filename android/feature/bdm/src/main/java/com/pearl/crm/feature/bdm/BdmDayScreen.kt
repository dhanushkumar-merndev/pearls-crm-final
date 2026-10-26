package com.pearl.crm.feature.bdm

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Business
import androidx.compose.material.icons.outlined.CameraAlt
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Coffee
import androidx.compose.material.icons.outlined.DirectionsCar
import androidx.compose.material.icons.outlined.Flag
import androidx.compose.material.icons.outlined.LocationOn
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material.icons.outlined.TaskAlt
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pearl.crm.core.data.BdmDashboard
import com.pearl.crm.core.data.BdmRepository
import com.pearl.crm.core.data.BdmState
import com.pearl.crm.core.data.NewLead
import com.pearl.crm.core.data.VisitResult
import com.pearl.crm.core.data.audio.VoiceRecorder
import com.pearl.crm.core.data.device.DeviceLocation
import com.pearl.crm.core.data.device.Photos
import com.pearl.crm.core.data.newClientId
import com.pearl.crm.core.model.LibraryItem
import com.pearl.crm.core.model.LibraryKind
import com.pearl.crm.core.model.LibrarySource
import com.pearl.crm.core.model.Phones
import com.pearl.crm.core.ui.components.ButtonKind
import com.pearl.crm.core.ui.components.PearlButton
import com.pearl.crm.core.ui.components.StatusLabel
import com.pearl.crm.core.ui.components.StatusTone
import com.pearl.crm.core.ui.components.failureMessage
import com.pearl.crm.core.ui.library.LibraryPicker
import com.pearl.crm.core.ui.theme.Pearl
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.File

@Composable
fun bdmStateLabel(state: String): String = stringResource(
    when (state) {
        BdmState.IN_OFFICE -> R.string.bdm_state_in_office
        BdmState.TRAVELLING -> R.string.bdm_state_travelling
        BdmState.AT_VISIT -> R.string.bdm_state_at_visit
        BdmState.ON_BREAK -> R.string.bdm_state_on_break
        else -> R.string.bdm_state_off_duty
    },
)

/** Field → message (string resource) for the travel form. */
fun validateTravel(destination: String): Map<String, Int> =
    if (destination.isBlank()) mapOf("destination" to R.string.bdm_destination_required) else emptyMap()

/** Field → message for the visit-complete form. Same rules as the server. */
fun validateVisit(outcome: String, contactPhone: String, createLead: Boolean, leadName: String, leadPhone: String): Map<String, Int> = buildMap {
    if (outcome.isBlank()) put("outcome", R.string.bdm_outcome_required)
    if (contactPhone.isNotBlank() && Phones.normalize(contactPhone) == null) put("contactPhone", R.string.bdm_phone_invalid)
    if (createLead) {
        if (leadName.isBlank()) put("leadName", R.string.bdm_lead_name_required)
        if (Phones.normalize(leadPhone) == null) put("leadPhone", R.string.bdm_phone_invalid)
    }
}

fun validateBreakMinutes(text: String): Int? = text.trim().toIntOrNull()?.takeIf { it in 5..180 }

/**
 * The BDM's home: start the day with a selfie at the office, then one big button for what
 * comes next (travel → reached → complete), with breaks and end of day. Everything after
 * the start works without signal.
 */
@Composable
fun BdmDayScreen(
    name: String,
    bdm: BdmRepository,
    library: LibrarySource,
    location: DeviceLocation,
    recorder: VoiceRecorder,
    photoAuthority: String,
    onTrackingNeeded: () -> Unit,
) {
    val context = LocalContext.current
    val day by bdm.day.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    val saved = stringResource(R.string.bdm_saved)
    var busy by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<Throwable?>(null) }
    var message by remember { mutableStateOf<Int?>(null) }
    var dialog by rememberSaveable { mutableStateOf<String?>(null) }
    var permitted by remember { mutableStateOf(location.permitted()) }
    var dashboard by remember { mutableStateOf<BdmDashboard?>(null) }
    var dashFailed by remember { mutableStateOf(false) }
    var reloadTiles by remember { mutableIntStateOf(0) }
    var meetingPath by rememberSaveable { mutableStateOf<String?>(null) }
    var meetingSeconds by rememberSaveable { mutableIntStateOf(0) }
    val dayClientId = rememberSaveable { newClientId() }

    val askLocation = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        permitted = location.permitted()
    }
    // The camera writes a full photo to our private cache; it is shrunk before upload.
    var shot by rememberSaveable { mutableStateOf<String?>(null) }
    var onShot by remember { mutableStateOf<(File) -> Unit>({}) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val raw = shot?.let(::File)
        if (ok && raw != null && raw.exists()) {
            scope.launch {
                val webp = Photos.toWebp(raw, File(raw.parentFile, raw.nameWithoutExtension + ".webp"))
                raw.delete()
                onShot(webp)
            }
        }
    }
    fun takePhoto(then: (File) -> Unit) {
        val dir = File(context.filesDir, "photos").apply { mkdirs() }
        val file = File(dir, "photo-${System.currentTimeMillis()}.jpg")
        shot = file.path
        onShot = then
        camera.launch(FileProvider.getUriForFile(context, photoAuthority, file))
    }
    fun act(block: suspend () -> Unit) {
        busy = true
        failure = null
        message = null
        scope.launch {
            try {
                block()
                snackbar.showSnackbar(saved)
            } catch (e: CancellationException) {
                throw e
            } catch (_: NoFix) {
                message = R.string.bdm_no_fix
            } catch (e: Exception) {
                failure = e
            } finally {
                busy = false
            }
        }
    }

    LaunchedEffect(reloadTiles, day.dayId, day.ended) {
        try {
            dashboard = bdm.dashboard()
            dashFailed = false
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            dashFailed = true
        }
    }
    LaunchedEffect(day.open, permitted) { if (day.open && permitted) onTrackingNeeded() }

    Scaffold(snackbarHost = { SnackbarHost(snackbar) }) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(stringResource(R.string.bdm_hello, name), style = MaterialTheme.typography.titleLarge)
            StatusLabel(bdmStateLabel(day.state), if (day.open) StatusTone.Good else StatusTone.Info)
            if (!permitted) {
                StatusLabel(stringResource(R.string.bdm_location_needed), StatusTone.Warning)
                PearlButton(stringResource(R.string.bdm_allow_location), Icons.Outlined.LocationOn, {
                    askLocation.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
                }, modifier = Modifier.testTag("bdm-allow-location"))
            }
            message?.let { StatusLabel(stringResource(it), StatusTone.Info) }
            failure?.let { StatusLabel(failureMessage(it), StatusTone.Critical, Modifier.testTag("bdm-failure")) }

            when {
                day.ended -> Text(stringResource(R.string.bdm_day_ended))
                !day.open -> Surface(shape = MaterialTheme.shapes.medium, tonalElevation = 1.dp) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(stringResource(R.string.bdm_start_title), style = MaterialTheme.typography.titleMedium)
                        Text(stringResource(R.string.bdm_start_body), color = Pearl.palette.textSecondary)
                        Text(stringResource(R.string.bdm_needs_internet), color = Pearl.palette.textSecondary)
                        PearlButton(stringResource(R.string.bdm_start), Icons.Outlined.CameraAlt, {
                            if (!permitted) {
                                askLocation.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
                                return@PearlButton
                            }
                            takePhoto { selfie ->
                                act {
                                    val fix = location.current() ?: throw NoFix()
                                    val r = bdm.startDay(selfie, fix, dayClientId)
                                    selfie.delete()
                                    message = if (r.inside == true) R.string.bdm_started_in_office else R.string.bdm_started_away
                                    onTrackingNeeded()
                                }
                            }
                        }, busy = busy, enabled = !busy, modifier = Modifier.testTag("bdm-start"))
                    }
                }
                else -> DayActions(
                    day.state, day.visitId != null, day.visitReached, day.breakOpen, day.visitDestination, busy,
                    onTravel = { dialog = "travel" },
                    onOffice = { act { bdm.atOffice(location.current(5_000)) } },
                    onReached = { dialog = "reached" },
                    onComplete = { dialog = "complete" },
                    onBreak = { dialog = "break" },
                    onEndBreak = { act { bdm.endBreak() } },
                    onEndDay = { dialog = "end" },
                )
            }
            if (day.open && day.visitReached) {
                MeetingRecorder(recorder, meetingPath, meetingSeconds) { path, secs ->
                    meetingPath = path
                    meetingSeconds = secs
                }
            }
            if (day.open) StatusLabel(stringResource(R.string.bdm_recording_route), StatusTone.Info)

            Tiles(dashboard, dashFailed) { reloadTiles++ }
        }
    }

    when (dialog) {
        "travel" -> TravelDialog(onDismiss = { dialog = null }) { dest, purpose ->
            dialog = null
            act { bdm.startTravel(dest, purpose, location.current(5_000)) }
        }
        "reached" -> ReachedDialog(day.visitDestination.orEmpty(), takePhoto = ::takePhoto, onDismiss = { dialog = null }) { photo ->
            dialog = null
            act { bdm.reached(location.current(5_000), photo) }
        }
        "complete" -> CompleteDialog(onDismiss = { dialog = null }) { result ->
            dialog = null
            val audio = meetingPath?.let(::File)?.takeIf { it.exists() }
            act {
                bdm.completeVisit(result, audio, meetingSeconds)
                meetingPath = null
                meetingSeconds = 0
            }
        }
        "break" -> BreakDialog(library, onDismiss = { dialog = null }) { type, minutes ->
            dialog = null
            act { bdm.startBreak(type?.id, minutes) }
        }
        "end" -> AlertDialog(
            onDismissRequest = { dialog = null },
            title = { Text(stringResource(R.string.bdm_end_title)) },
            text = { Text(stringResource(R.string.bdm_end_body)) },
            confirmButton = {
                PearlButton(stringResource(R.string.bdm_end_confirm), Icons.Outlined.Flag, {
                    dialog = null
                    act { bdm.endDay(location.current(5_000)) }
                }, kind = ButtonKind.Danger, modifier = Modifier.testTag("bdm-end-confirm"))
            },
            dismissButton = { PearlButton(stringResource(R.string.bdm_cancel), Icons.Outlined.Close, { dialog = null }, kind = ButtonKind.Quiet) },
        )
    }
}

/** No GPS reading: shown as its own message, not an error code. */
private class NoFix : Exception("no location fix")

@Composable
private fun DayActions(
    state: String,
    hasVisit: Boolean,
    reached: Boolean,
    breakOpen: Boolean,
    destination: String?,
    busy: Boolean,
    onTravel: () -> Unit,
    onOffice: () -> Unit,
    onReached: () -> Unit,
    onComplete: () -> Unit,
    onBreak: () -> Unit,
    onEndBreak: () -> Unit,
    onEndDay: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        when {
            breakOpen -> PearlButton(stringResource(R.string.bdm_end_break), Icons.Outlined.Coffee, onEndBreak, busy = busy, modifier = Modifier.testTag("bdm-end-break"))
            hasVisit && !reached -> {
                Text(stringResource(R.string.bdm_going_to, destination.orEmpty()), style = MaterialTheme.typography.titleMedium)
                PearlButton(stringResource(R.string.bdm_reached), Icons.Outlined.LocationOn, onReached, busy = busy, modifier = Modifier.testTag("bdm-reached"))
            }
            hasVisit -> {
                Text(stringResource(R.string.bdm_at, destination.orEmpty()), style = MaterialTheme.typography.titleMedium)
                PearlButton(stringResource(R.string.bdm_complete), Icons.Outlined.TaskAlt, onComplete, busy = busy, modifier = Modifier.testTag("bdm-complete"))
            }
            else -> PearlButton(stringResource(R.string.bdm_travel), Icons.Outlined.DirectionsCar, onTravel, busy = busy, modifier = Modifier.testTag("bdm-travel"))
        }
        if (!breakOpen) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (!hasVisit && state != BdmState.IN_OFFICE) {
                    PearlButton(stringResource(R.string.bdm_office), Icons.Outlined.Business, onOffice, kind = ButtonKind.Secondary, enabled = !busy)
                }
                if (!hasVisit || reached) {
                    PearlButton(stringResource(R.string.bdm_break), Icons.Outlined.Coffee, onBreak, kind = ButtonKind.Secondary, enabled = !busy, modifier = Modifier.testTag("bdm-break"))
                }
                if (!hasVisit) {
                    PearlButton(stringResource(R.string.bdm_end_day), Icons.Outlined.Flag, onEndDay, kind = ButtonKind.Secondary, enabled = !busy, modifier = Modifier.testTag("bdm-end-day"))
                }
            }
        }
    }
}

@Composable
private fun MeetingRecorder(recorder: VoiceRecorder, path: String?, seconds: Int, onClip: (String?, Int) -> Unit) {
    val context = LocalContext.current
    var recording by remember { mutableStateOf(recorder.isRecording) }
    var elapsed by remember { mutableIntStateOf(0) }
    val start = {
        recording = runCatching { recorder.start(VoiceRecorder.VISIT_MAX_MS) }.isSuccess
        elapsed = 0
    }
    val mic = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { if (it) start() }
    LaunchedEffect(recording) {
        while (recording) {
            delay(1_000)
            elapsed++
        }
    }
    Surface(shape = MaterialTheme.shapes.medium, tonalElevation = 1.dp, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            when {
                recording -> Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    StatusLabel(stringResource(R.string.bdm_recording, elapsed / 60, elapsed % 60), StatusTone.Warning)
                    PearlButton(stringResource(R.string.bdm_stop_recording), Icons.Outlined.Stop, {
                        recording = false
                        val clip = recorder.stop()
                        onClip(clip?.first?.path, clip?.second ?: 0)
                    }, kind = ButtonKind.Secondary)
                }
                path != null -> StatusLabel(stringResource(R.string.bdm_meeting_ready, seconds / 60, seconds % 60), StatusTone.Good)
                else -> {
                    Text(stringResource(R.string.bdm_consent), color = Pearl.palette.textSecondary)
                    PearlButton(stringResource(R.string.bdm_record_meeting), Icons.Outlined.Mic, {
                        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) start()
                        else mic.launch(Manifest.permission.RECORD_AUDIO)
                    }, kind = ButtonKind.Secondary, modifier = Modifier.testTag("bdm-record"))
                }
            }
        }
    }
}

@Composable
private fun Tiles(d: BdmDashboard?, failed: Boolean, onRefresh: () -> Unit) {
    val today = d?.today
    if (today != null) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Tile(stringResource(R.string.bdm_tiles_visits), today.visits.toString())
            Tile(stringResource(R.string.bdm_tiles_km), "%.1f".format(today.distanceM / 1000.0))
            Tile(stringResource(R.string.bdm_tiles_km_est), "%.1f".format(today.estM / 1000.0))
            Tile(stringResource(R.string.bdm_tiles_leads), today.leads.toString())
            Tile(
                stringResource(R.string.bdm_tiles_break),
                stringResource(R.string.bdm_tiles_minutes, (today.breakS / 60).toInt(), (today.breakAllowedS / 60).toInt()),
            )
        }
        Text(
            stringResource(R.string.bdm_time_split, (today.travelS / 60).toInt(), (today.meetingS / 60).toInt(), (today.breakS / 60).toInt(), (today.officeS / 60).toInt()),
            color = Pearl.palette.textSecondary,
        )
    }
    d?.month?.let { m -> Text(stringResource(R.string.bdm_month, m.visits, m.leads, m.conversions, "%.1f".format(m.km)), color = Pearl.palette.textSecondary) }
    if (failed) Text(stringResource(R.string.bdm_numbers_offline), color = Pearl.palette.textSecondary)
    PearlButton(stringResource(R.string.bdm_refresh), Icons.Outlined.Refresh, onRefresh, kind = ButtonKind.Quiet)
}

@Composable
private fun Tile(label: String, value: String) {
    Surface(shape = MaterialTheme.shapes.medium, tonalElevation = 1.dp, modifier = Modifier.widthIn(min = 140.dp)) {
        Column(Modifier.padding(12.dp)) {
            Text(label, color = Pearl.palette.textSecondary, style = MaterialTheme.typography.bodyMedium)
            Text(value, style = MaterialTheme.typography.headlineSmall)
        }
    }
}

@Composable
private fun TravelDialog(onDismiss: () -> Unit, onGo: (String, String?) -> Unit) {
    var destination by rememberSaveable { mutableStateOf("") }
    var purpose by rememberSaveable { mutableStateOf("") }
    var errors by remember { mutableStateOf<Map<String, Int>>(emptyMap()) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.bdm_travel_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = destination,
                    onValueChange = {
                        destination = it.take(200)
                        errors = errors - "destination"
                    },
                    label = { Text(stringResource(R.string.bdm_destination)) },
                    isError = "destination" in errors,
                    supportingText = errors["destination"]?.let { { Text(stringResource(it)) } },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth().testTag("bdm-destination"),
                )
                OutlinedTextField(
                    value = purpose,
                    onValueChange = { purpose = it.take(500) },
                    label = { Text(stringResource(R.string.bdm_purpose)) },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            PearlButton(stringResource(R.string.bdm_go), Icons.Outlined.DirectionsCar, {
                val found = validateTravel(destination)
                errors = found
                if (found.isEmpty()) onGo(destination, purpose)
            }, modifier = Modifier.testTag("bdm-go"))
        },
        dismissButton = { PearlButton(stringResource(R.string.bdm_cancel), Icons.Outlined.Close, onDismiss, kind = ButtonKind.Quiet) },
    )
}

@Composable
private fun ReachedDialog(destination: String, takePhoto: ((File) -> Unit) -> Unit, onDismiss: () -> Unit, onConfirm: (File?) -> Unit) {
    var photo by remember { mutableStateOf<File?>(null) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.bdm_reached_title, destination)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(stringResource(R.string.bdm_reached_body))
                if (photo != null) StatusLabel(stringResource(R.string.bdm_photo_ready), StatusTone.Good)
                else PearlButton(stringResource(R.string.bdm_take_photo), Icons.Outlined.CameraAlt, { takePhoto { photo = it } }, kind = ButtonKind.Secondary)
            }
        },
        confirmButton = {
            PearlButton(stringResource(R.string.bdm_confirm_reached), Icons.Outlined.Check, { onConfirm(photo) }, modifier = Modifier.testTag("bdm-confirm-reached"))
        },
        dismissButton = { PearlButton(stringResource(R.string.bdm_cancel), Icons.Outlined.Close, onDismiss, kind = ButtonKind.Quiet) },
    )
}

@Composable
fun CompleteDialog(onDismiss: () -> Unit, onSave: (VisitResult) -> Unit) {
    var outcome by rememberSaveable { mutableStateOf("") }
    var contactName by rememberSaveable { mutableStateOf("") }
    var contactPhone by rememberSaveable { mutableStateOf("") }
    var designation by rememberSaveable { mutableStateOf("") }
    var interest by rememberSaveable { mutableStateOf<String?>(null) }
    var createLead by rememberSaveable { mutableStateOf(false) }
    var leadName by rememberSaveable { mutableStateOf("") }
    var leadPhone by rememberSaveable { mutableStateOf("") }
    var leadTreatment by rememberSaveable { mutableStateOf("") }
    var errors by remember { mutableStateOf<Map<String, Int>>(emptyMap()) }
    @Composable
    fun field(key: String, value: String, label: Int, onChange: (String) -> Unit, phone: Boolean = false, lines: Int = 1) =
        OutlinedTextField(
            value = value,
            onValueChange = {
                onChange(it)
                errors = errors - key
            },
            label = { Text(stringResource(label)) },
            isError = key in errors,
            supportingText = errors[key]?.let { { Text(stringResource(it)) } },
            minLines = lines,
            singleLine = lines == 1,
            keyboardOptions = if (phone) KeyboardOptions(keyboardType = KeyboardType.Phone) else KeyboardOptions.Default,
            modifier = Modifier.fillMaxWidth().testTag("bdm-$key"),
        )
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.bdm_complete_title)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                field("outcome", outcome, R.string.bdm_outcome, { outcome = it.take(2000) }, lines = 3)
                field("contactName", contactName, R.string.bdm_contact_name, { contactName = it.take(120) })
                field("contactPhone", contactPhone, R.string.bdm_contact_phone, { contactPhone = it }, phone = true)
                field("designation", designation, R.string.bdm_contact_designation, { designation = it.take(120) })
                Text(stringResource(R.string.bdm_interest), style = MaterialTheme.typography.labelLarge)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("hot" to R.string.bdm_interest_hot, "warm" to R.string.bdm_interest_warm, "cold" to R.string.bdm_interest_cold, "none" to R.string.bdm_interest_none)
                        .forEach { (v, l) -> FilterChip(selected = interest == v, onClick = { interest = v }, label = { Text(stringResource(l)) }) }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = createLead, onCheckedChange = { createLead = it }, modifier = Modifier.testTag("bdm-create-lead"))
                    Text(stringResource(R.string.bdm_create_lead))
                }
                if (createLead) {
                    field("leadName", leadName, R.string.bdm_lead_name, { leadName = it.take(120) })
                    field("leadPhone", leadPhone, R.string.bdm_lead_phone, { leadPhone = it }, phone = true)
                    field("leadTreatment", leadTreatment, R.string.bdm_lead_treatment, { leadTreatment = it.take(200) })
                }
            }
        },
        confirmButton = {
            PearlButton(stringResource(R.string.bdm_save_visit), Icons.Outlined.Check, {
                val found = validateVisit(outcome, contactPhone, createLead, leadName, leadPhone)
                errors = found
                if (found.isEmpty()) {
                    onSave(
                        VisitResult(
                            outcome = outcome,
                            contactName = contactName,
                            contactPhone = Phones.normalize(contactPhone)?.e164,
                            contactDesignation = designation,
                            interest = interest,
                            lead = if (createLead) NewLead(leadName, Phones.normalize(leadPhone)!!.e164, leadTreatment) else null,
                        ),
                    )
                }
            }, modifier = Modifier.testTag("bdm-save-visit"))
        },
        dismissButton = { PearlButton(stringResource(R.string.bdm_cancel), Icons.Outlined.Close, onDismiss, kind = ButtonKind.Quiet) },
    )
}

@Composable
private fun BreakDialog(library: LibrarySource, onDismiss: () -> Unit, onStart: (LibraryItem?, Int) -> Unit) {
    var type by remember { mutableStateOf<LibraryItem?>(null) }
    var minutes by rememberSaveable { mutableStateOf("15") }
    var error by remember { mutableStateOf<Int?>(null) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.bdm_break_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                LibraryPicker(
                    kind = LibraryKind.BREAK_TYPE,
                    value = type,
                    onChange = {
                        type = it
                        // Lunch is longer than tea by default; the BDM can change it.
                        minutes = if (it?.label?.contains("lunch", ignoreCase = true) == true) "30" else "15"
                    },
                    source = library,
                    label = stringResource(R.string.bdm_break_type),
                )
                OutlinedTextField(
                    value = minutes,
                    onValueChange = {
                        minutes = it.filter(Char::isDigit).take(3)
                        error = null
                    },
                    label = { Text(stringResource(R.string.bdm_break_minutes)) },
                    isError = error != null,
                    supportingText = error?.let { { Text(stringResource(it)) } },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth().testTag("bdm-break-minutes"),
                )
            }
        },
        confirmButton = {
            PearlButton(stringResource(R.string.bdm_start_break), Icons.Outlined.Coffee, {
                val m = validateBreakMinutes(minutes)
                if (m == null) error = R.string.bdm_break_minutes_invalid else onStart(type, m)
            }, modifier = Modifier.testTag("bdm-start-break"))
        },
        dismissButton = { PearlButton(stringResource(R.string.bdm_cancel), Icons.Outlined.Close, onDismiss, kind = ButtonKind.Quiet) },
    )
}
