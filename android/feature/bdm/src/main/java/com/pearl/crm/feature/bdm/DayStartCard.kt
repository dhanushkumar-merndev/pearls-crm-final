package com.pearl.crm.feature.bdm

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.Business
import androidx.compose.material.icons.outlined.CameraAlt
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Flag
import androidx.compose.material.icons.outlined.LocationOn
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.WbSunny
import androidx.compose.material.icons.outlined.Wifi
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pearl.crm.core.data.BdmRepository
import com.pearl.crm.core.data.StartDayResult
import com.pearl.crm.core.data.StartRequest
import com.pearl.crm.core.data.device.DeviceLocation
import com.pearl.crm.core.data.device.Photos
import com.pearl.crm.core.data.newClientId
import com.pearl.crm.core.model.RpcFailure
import com.pearl.crm.core.ui.components.ButtonKind
import com.pearl.crm.core.ui.components.Muted
import com.pearl.crm.core.ui.components.PearlButton
import com.pearl.crm.core.ui.components.Accent
import com.pearl.crm.core.ui.components.HeroCard
import com.pearl.crm.core.ui.components.InfoLine
import com.pearl.crm.core.ui.components.PearlCard
import com.pearl.crm.core.ui.components.PhotoPreview
import com.pearl.crm.core.ui.components.accentColor
import com.pearl.crm.core.ui.components.loadPhoto
import com.pearl.crm.core.ui.components.StatusLabel
import com.pearl.crm.core.ui.components.StatusTone
import com.pearl.crm.core.ui.components.failureMessage
import com.pearl.crm.core.ui.theme.Spacing
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.File
import java.util.Locale

/** The reason box when asking the admin: same rule as the server (1–500 letters). */
fun validateStartReason(text: String): Int? = when {
    text.isBlank() -> R.string.day_ask_reason_required
    text.trim().length > 500 -> R.string.day_ask_reason_too_long
    else -> null
}

/** "350 m" or "2.3 km". */
fun distanceText(m: Int): String = if (m >= 1000) String.format(Locale.ROOT, "%.1f km", m / 1000.0) else "$m m"

/** No GPS reading: its own message, not an error code. */
internal class NoLocationFix : Exception("no location fix")

/**
 * Start the day (BDMs and sales executives): selfie + location at the office. Away from the
 * office the server says no; then "Ask admin to start here" sends the place and a reason, the
 * card waits for the answer (checks every 30 s), and once approved the same Start button works.
 */
@Composable
fun DayStartCard(
    bdm: BdmRepository,
    location: DeviceLocation,
    photoAuthority: String,
    body: Int,
    onStarted: (StartDayResult, approvedAway: Boolean) -> Unit,
) {
    val context = LocalContext.current
    val day by bdm.day.collectAsStateWithLifecycle()
    val request = day.startRequest
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<Throwable?>(null) }
    var message by remember { mutableStateOf<Int?>(null) }
    var refused by rememberSaveable { mutableStateOf(false) }
    var asking by rememberSaveable { mutableStateOf(false) }
    var permitted by remember { mutableStateOf(location.permitted()) }
    val dayClientId = rememberSaveable { newClientId() }
    var requestClientId by rememberSaveable { mutableStateOf(newClientId()) }

    val askLocation = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        permitted = location.permitted()
    }
    var shot by rememberSaveable { mutableStateOf<String?>(null) }
    // While the day starts: the selfie (with a loader until it is read) and which step is running.
    var selfiePreview by remember { mutableStateOf<ImageBitmap?>(null) }
    var step by remember { mutableStateOf<Int?>(null) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val raw = shot?.let(::File)
        if (ok && raw != null && raw.exists()) {
            busy = true
            failure = null
            message = null
            selfiePreview = null
            step = R.string.day_step_photo
            scope.launch {
                try {
                    val selfie = Photos.toWebp(raw, File(raw.parentFile, raw.nameWithoutExtension + ".webp"))
                    raw.delete()
                    selfiePreview = loadPhoto(selfie, maxPx = 480)
                    step = R.string.day_step_location
                    val fix = location.current() ?: throw NoLocationFix()
                    step = R.string.day_step_upload
                    val approved = bdm.day.value.startRequest?.status == StartRequest.APPROVED
                    val r = bdm.startDay(selfie, fix, dayClientId)
                    selfie.delete()
                    onStarted(r, approved && r.inside != true)
                } catch (e: CancellationException) {
                    throw e
                } catch (_: NoLocationFix) {
                    message = R.string.bdm_no_fix
                } catch (e: Exception) {
                    failure = e
                    if (e is RpcFailure.Permanent && e.code == "outside_office") refused = true
                } finally {
                    busy = false
                    step = null
                    selfiePreview = null
                }
            }
        }
    }
    fun start() {
        val dir = File(context.filesDir, "photos").apply { mkdirs() }
        val file = File(dir, "selfie-${System.currentTimeMillis()}.jpg")
        shot = file.path
        camera.launch(FileProvider.getUriForFile(context, photoAuthority, file))
    }
    fun check() {
        scope.launch {
            busy = true
            try {
                bdm.refreshFromServer()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failure = e
            } finally {
                busy = false
            }
        }
    }

    // Waiting for the admin: look again every 30 seconds (and on pull-down).
    LaunchedEffect(request?.status) {
        while (request?.status == StartRequest.PENDING) {
            delay(30_000)
            runCatching { bdm.refreshFromServer() }
        }
    }

    HeroCard(
        title = stringResource(R.string.bdm_start_title),
        icon = Icons.Outlined.WbSunny,
        accent = accentColor(Accent.Orange),
        subtitle = stringResource(body),
    ) {
        InfoLine(Icons.Outlined.Wifi, stringResource(R.string.bdm_needs_internet))
        // The selfie being sent, with a loader over it and the step in words.
        step?.let { s ->
            PhotoPreview(
                bitmap = selfiePreview,
                contentDescription = stringResource(R.string.day_selfie_alt),
                busy = true,
                busyText = stringResource(s),
                height = 200.dp,
                modifier = Modifier.testTag("day-start-selfie"),
            )
        }
        message?.let { StatusLabel(stringResource(it), StatusTone.Info) }
        failure?.let { StatusLabel(failureMessage(it), StatusTone.Critical, Modifier.testTag("day-start-failure")) }
        if (!permitted) {
            StatusLabel(stringResource(R.string.day_location_needed), StatusTone.Warning)
            PearlButton(stringResource(R.string.bdm_allow_location), Icons.Outlined.LocationOn, {
                askLocation.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
            }, modifier = Modifier.fillMaxWidth().testTag("bdm-allow-location"))
            return@HeroCard
        }
        when (request?.status) {
            StartRequest.PENDING -> {
                StatusLabel(stringResource(R.string.day_waiting), StatusTone.Info, Modifier.testTag("day-request-waiting"))
                Muted(request.reason)
                request.distanceM?.let { m ->
                    Muted(request.office?.let { stringResource(R.string.day_from_office, distanceText(m), it) } ?: distanceText(m))
                }
                PearlButton(stringResource(R.string.day_check_again), Icons.Outlined.Refresh, ::check, kind = ButtonKind.Tonal, busy = busy, enabled = !busy)
            }
            StartRequest.APPROVED -> StatusLabel(stringResource(R.string.day_approved), StatusTone.Good, Modifier.testTag("day-request-approved"))
            StartRequest.DECLINED -> StatusLabel(
                stringResource(R.string.day_declined, request.declineNote.orEmpty()),
                StatusTone.Critical,
                Modifier.testTag("day-request-declined"),
            )
        }
        // Always there: reached the office while waiting? Starting there needs no answer.
        PearlButton(stringResource(R.string.bdm_start), Icons.Outlined.CameraAlt, ::start, busy = busy, enabled = !busy, modifier = Modifier.fillMaxWidth().testTag("bdm-start"))
        // Refused for being away from the office (or the admin said no): ask the admin.
        if ((refused || request?.status == StartRequest.DECLINED) && request?.status != StartRequest.PENDING && request?.status != StartRequest.APPROVED) {
            PearlButton(
                stringResource(R.string.day_ask_admin),
                Icons.AutoMirrored.Outlined.Send,
                { asking = true },
                kind = ButtonKind.Tonal,
                enabled = !busy,
                modifier = Modifier.testTag("day-ask-admin"),
            )
        }
    }

    if (asking) {
        AskAdminDialog(onDismiss = { asking = false }) { reason ->
            asking = false
            busy = true
            failure = null
            message = null
            scope.launch {
                try {
                    val fix = location.current() ?: throw NoLocationFix()
                    bdm.requestStart(fix, reason, requestClientId)
                    requestClientId = newClientId()
                    refused = false
                    message = R.string.day_request_sent
                } catch (e: CancellationException) {
                    throw e
                } catch (_: NoLocationFix) {
                    message = R.string.bdm_no_fix
                } catch (e: Exception) {
                    failure = e
                } finally {
                    busy = false
                }
            }
        }
    }
}

@Composable
private fun AskAdminDialog(onDismiss: () -> Unit, onSend: (String) -> Unit) {
    var reason by rememberSaveable { mutableStateOf("") }
    var error by remember { mutableStateOf<Int?>(null) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.day_ask_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
                Text(stringResource(R.string.day_ask_body))
                OutlinedTextField(
                    value = reason,
                    onValueChange = {
                        reason = it.take(600)
                        error = null
                    },
                    label = { Text(stringResource(R.string.day_ask_reason)) },
                    placeholder = { Text(stringResource(R.string.day_ask_reason_hint)) },
                    isError = error != null,
                    supportingText = error?.let { { Text(stringResource(it)) } },
                    minLines = 2,
                    modifier = Modifier.fillMaxWidth().testTag("day-ask-reason"),
                )
            }
        },
        confirmButton = {
            PearlButton(stringResource(R.string.day_ask_send), Icons.AutoMirrored.Outlined.Send, {
                val found = validateStartReason(reason)
                error = found
                if (found == null) onSend(reason.trim())
            }, modifier = Modifier.testTag("day-ask-send"))
        },
        dismissButton = { PearlButton(stringResource(R.string.bdm_cancel), Icons.Outlined.Close, onDismiss, kind = ButtonKind.Quiet) },
    )
}

/**
 * A sales executive's day on My Day (owner, 02/11/2026): start at the office (or where the admin
 * allowed), and end it. No route is recorded.
 */
@Composable
fun SalesDayCard(bdm: BdmRepository, location: DeviceLocation, photoAuthority: String) {
    val day by bdm.day.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var started by remember { mutableStateOf<Int?>(null) }
    var ending by rememberSaveable { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<Throwable?>(null) }
    LaunchedEffect(Unit) { runCatching { bdm.refreshFromServer() } }

    when {
        day.ended -> HeroCard(
            title = stringResource(R.string.bdm_day_ended),
            icon = Icons.Outlined.Flag,
            accent = accentColor(Accent.Violet),
            modifier = Modifier.testTag("sales-day-ended"),
        )
        day.open -> HeroCard(
            title = stringResource(started ?: R.string.day_started),
            icon = Icons.Outlined.Business,
            accent = accentColor(Accent.Teal),
            subtitle = if (day.startedInOffice == false && started == null) stringResource(R.string.day_started_away_note) else null,
            modifier = Modifier.testTag("sales-day-open"),
            trailing = {
                PearlButton(stringResource(R.string.bdm_end_day), Icons.Outlined.Flag, { ending = true }, kind = ButtonKind.Tonal, busy = busy, enabled = !busy, small = true, modifier = Modifier.testTag("sales-end-day"))
            },
        ) {
            failure?.let { StatusLabel(failureMessage(it), StatusTone.Critical) }
        }
        else -> DayStartCard(bdm, location, photoAuthority, R.string.day_start_body_sales) { r, approvedAway ->
            started = when {
                r.inside == true -> R.string.bdm_started_in_office
                approvedAway -> R.string.day_started_away_ok
                else -> R.string.day_started
            }
        }
    }
    if (ending) {
        AlertDialog(
            onDismissRequest = { ending = false },
            title = { Text(stringResource(R.string.bdm_end_title)) },
            text = { Text(stringResource(R.string.day_end_body_sales)) },
            confirmButton = {
                PearlButton(stringResource(R.string.bdm_end_confirm), Icons.Outlined.Flag, {
                    ending = false
                    busy = true
                    failure = null
                    scope.launch {
                        try {
                            bdm.endDay(location.current(5_000))
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            failure = e
                        } finally {
                            busy = false
                        }
                    }
                }, kind = ButtonKind.Danger, modifier = Modifier.testTag("sales-end-confirm"))
            },
            dismissButton = { PearlButton(stringResource(R.string.bdm_cancel), Icons.Outlined.Close, { ending = false }, kind = ButtonKind.Quiet) },
        )
    }
}
