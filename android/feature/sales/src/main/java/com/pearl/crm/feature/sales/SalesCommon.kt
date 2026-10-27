package com.pearl.crm.feature.sales

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import com.pearl.crm.core.model.CallOutcome
import com.pearl.crm.core.model.IstDates
import com.pearl.crm.core.model.LeadStage
import java.time.LocalDate

@Composable
fun stageLabel(stage: String): String = stringResource(
    when (stage) {
        LeadStage.NEW -> R.string.stage_new
        LeadStage.CONTACTED -> R.string.stage_contacted
        LeadStage.INTERESTED -> R.string.stage_interested
        LeadStage.CONSULTATION_BOOKED -> R.string.stage_consultation_booked
        LeadStage.CONSULTED -> R.string.stage_consulted
        LeadStage.SURGERY_SCHEDULED -> R.string.stage_surgery_scheduled
        LeadStage.CONVERTED -> R.string.stage_converted
        LeadStage.LOST -> R.string.stage_lost
        LeadStage.JUNK -> R.string.stage_junk
        else -> R.string.stage_not_reachable
    },
)

@Composable
fun outcomeLabel(outcome: String): String = stringResource(
    when (outcome) {
        CallOutcome.CONNECTED -> R.string.outcome_connected
        CallOutcome.NO_ANSWER -> R.string.outcome_no_answer
        CallOutcome.BUSY -> R.string.outcome_busy
        CallOutcome.SWITCHED_OFF -> R.string.outcome_switched_off
        CallOutcome.WRONG_NUMBER -> R.string.outcome_wrong_number
        else -> R.string.outcome_call_back
    },
)

@Composable
fun apptStatusLabel(status: String): String = stringResource(
    when (status) {
        "confirmed" -> R.string.appt_confirmed
        "arrived" -> R.string.appt_arrived
        "with_doctor" -> R.string.appt_with_doctor
        "done" -> R.string.appt_done
        "no_show" -> R.string.appt_no_show
        "cancelled" -> R.string.appt_cancelled
        "rescheduled" -> R.string.appt_rescheduled
        else -> R.string.appt_pending_confirmation
    },
)

@Composable
fun taskStatusLabel(status: String): String = stringResource(
    when (status) {
        "done" -> R.string.task_done
        "cancelled" -> R.string.task_cancelled
        else -> R.string.task_open
    },
)

/** Today in the clinic's time zone. */
fun istToday(): LocalDate = LocalDate.now(IstDates.ZONE)

/** Opens the phone's dialer with [phone] filled in (the person presses call). */
fun dial(context: Context, phone: String): Boolean = try {
    context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$phone")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    true
} catch (_: ActivityNotFoundException) {
    Toast.makeText(context, R.string.no_dialer, Toast.LENGTH_LONG).show()
    false
}

/** Opens a WhatsApp chat with [phone] (E.164). */
fun openWhatsApp(context: Context, phone: String) {
    try {
        context.startActivity(
            Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/${phone.filter(Char::isDigit)}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    } catch (_: ActivityNotFoundException) {
        Toast.makeText(context, R.string.no_whatsapp, Toast.LENGTH_LONG).show()
    }
}

/** A call started from the app, waiting for its notes. */
data class StartedCall(val leadId: String, val phone: String, val startedAt: Long)

/**
 * Call → dialer → back in the app → the notes sheet opens for that lead. (Phase 12 reads the
 * real call from the phone's call log; until then the time away is the call's length.)
 */
class CallFlow(private val context: Context) {
    var started by mutableStateOf<StartedCall?>(null)
    var needsNotes by mutableStateOf<StartedCall?>(null)
    var awayMs by mutableStateOf(0L)

    fun call(leadId: String, phone: String) {
        if (dial(context, phone)) started = StartedCall(leadId, phone, System.currentTimeMillis())
    }

    fun onResume() {
        val call = started ?: return
        started = null
        awayMs = System.currentTimeMillis() - call.startedAt
        needsNotes = call
    }
}

@Composable
fun rememberCallFlow(context: Context): CallFlow {
    val flow = androidx.compose.runtime.remember { CallFlow(context) }
    var saved by rememberSaveable { mutableStateOf<String?>(null) }
    // Survive the activity being recreated while the dialer is open.
    if (flow.started == null && saved != null) {
        val (leadId, phone, at) = saved!!.split('|')
        flow.started = StartedCall(leadId, phone, at.toLong())
    }
    saved = flow.started?.let { "${it.leadId}|${it.phone}|${it.startedAt}" }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { flow.onResume() }
    return flow
}

/** "Call back 24/10/2026 11:00 AM", or overdue. */
@Composable
fun dueText(atMs: Long, now: Long = System.currentTimeMillis()): String =
    if (atMs <= now) stringResource(R.string.overdue_since, IstDates.formatDateTime(atMs))
    else stringResource(R.string.due_at, IstDates.formatDateTime(atMs))
