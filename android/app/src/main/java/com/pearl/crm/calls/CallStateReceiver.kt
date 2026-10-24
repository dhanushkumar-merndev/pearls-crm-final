package com.pearl.crm.calls

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.telephony.TelephonyManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.pearl.crm.MainActivity
import com.pearl.crm.PearlApplication
import com.pearl.crm.R
import com.pearl.crm.core.model.CallEvent
import com.pearl.crm.core.model.CallTracker
import com.pearl.crm.core.model.LeadStage
import com.pearl.crm.core.model.Phones
import com.pearl.crm.core.model.StaffRole
import com.pearl.crm.core.model.TrackedCall
import com.pearl.crm.core.sync.RecordingWorker
import com.pearl.crm.push.Push
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import com.pearl.crm.feature.sales.R as SalesR

/** A finished CRM call waiting for its notes (opened by the caller flow). */
data class AfterCallRequest(
    val leadId: String,
    val phone: String,
    val startedAt: Long,
    val durationS: Int,
    val direction: String,
    val deviceCallKey: String?,
) {
    fun toIntent(context: Context): Intent = Intent(context, MainActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        .putExtra(EXTRA_LEAD, leadId).putExtra(EXTRA_PHONE, phone).putExtra(EXTRA_STARTED, startedAt)
        .putExtra(EXTRA_DURATION, durationS).putExtra(EXTRA_DIRECTION, direction).putExtra(EXTRA_KEY, deviceCallKey)

    companion object {
        private const val EXTRA_LEAD = "after_call_lead"
        private const val EXTRA_PHONE = "after_call_phone"
        private const val EXTRA_STARTED = "after_call_started"
        private const val EXTRA_DURATION = "after_call_duration"
        private const val EXTRA_DIRECTION = "after_call_direction"
        private const val EXTRA_KEY = "after_call_key"

        fun from(intent: Intent?): AfterCallRequest? {
            val lead = intent?.getStringExtra(EXTRA_LEAD) ?: return null
            return AfterCallRequest(
                lead, intent.getStringExtra(EXTRA_PHONE).orEmpty(), intent.getLongExtra(EXTRA_STARTED, 0),
                intent.getIntExtra(EXTRA_DURATION, 0), intent.getStringExtra(EXTRA_DIRECTION) ?: "outgoing", intent.getStringExtra(EXTRA_KEY),
            )
        }
    }
}

/**
 * Phone-state broadcasts → the caller bubble during a CRM call and the notes sheet after it.
 * Calls with numbers the CRM doesn't know are ignored completely. Uses READ_PHONE_STATE +
 * READ_CALL_LOG (not the call-screening role, which Truecaller usually holds).
 */
class CallStateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) return
        val app = context.applicationContext as? PearlApplication ?: return
        val container = app.container
        val role = container.sessions.session.value?.staffRole
        if (role != StaffRole.SalesExecutive && role != StaffRole.SalesManager) return
        val state = intent.getStringExtra(TelephonyManager.EXTRA_STATE) ?: return
        @Suppress("DEPRECATION")
        val number = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER)
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val (next, event) = CallTracker.next(load(prefs), state, number, System.currentTimeMillis())
        save(prefs, next)
        if (event == CallEvent.Nothing) return

        val pending = goAsync()
        container.scope.launch {
            try {
                when (event) {
                    is CallEvent.Show -> {
                        val last10 = Phones.normalize(event.number)?.last10 ?: return@launch
                        val card = container.db.crmNumbers().card(last10) ?: return@launch
                        if (container.settings.callerPopup) {
                            val stage = card.stage?.let { STAGES[it] }?.let(context::getString)
                            ContextCompat.getMainExecutor(context).execute { CallerOverlay.show(context, card, stage) }
                        }
                    }
                    is CallEvent.Ended -> {
                        ContextCompat.getMainExecutor(context).execute { CallerOverlay.hide(context) }
                        afterCall(context, event.call, event.endedAt)
                        // The dialer finishes writing its recording a few seconds after the call.
                        RecordingWorker.schedule(context, delayMs = 20_000)
                    }
                    CallEvent.Nothing -> Unit
                }
            } finally {
                pending.finish()
            }
        }
    }

    private suspend fun afterCall(context: Context, call: TrackedCall, endedAt: Long) {
        val container = (context.applicationContext as PearlApplication).container
        val dialled = call.number?.let { Phones.normalize(it) } ?: return
        val last10 = dialled.last10
        val card = container.db.crmNumbers().card(last10) ?: return
        if (!container.settings.callerPopup) return
        // The call log is written a moment after the call ends: its length and key are the real ones.
        delay(1_500)
        val logged = runCatching { container.callLogSource.latestFor(last10, call.startedAt - 60_000) }.getOrNull()
        val request = AfterCallRequest(
            leadId = card.leadId,
            phone = logged?.number?.let { Phones.normalize(it)?.e164 } ?: dialled.e164,
            startedAt = logged?.startedAt ?: call.startedAt,
            durationS = logged?.durationS ?: if (call.answered) ((endedAt - call.startedAt) / 1000).toInt() else 0,
            direction = logged?.direction ?: if (!call.incoming) "outgoing" else if (call.answered) "incoming" else "missed",
            deviceCallKey = logged?.key,
        )
        container.pendingAfterCall.value = request
        if (CallerOverlay.canShow(context)) {
            // Allowed from the background because the app may draw over other apps.
            runCatching { context.startActivity(request.toIntent(context)) }
        } else {
            notifyForNotes(context, request, card.name)
        }
    }

    @SuppressLint("MissingPermission") // Push.canNotify checks it
    private fun notifyForNotes(context: Context, request: AfterCallRequest, name: String?) {
        if (!Push.canNotify(context)) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, context.getString(R.string.calls_channel), NotificationManager.IMPORTANCE_HIGH),
        )
        val tap = PendingIntent.getActivity(
            context, request.startedAt.toInt(), request.toIntent(context),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val n = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(context.getString(R.string.calls_notes_title))
            .setContentText(name ?: request.phone)
            .setContentIntent(tap)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()
        NotificationManagerCompat.from(context).notify(NOTES_ID, n)
    }

    companion object {
        private const val PREFS = "pearl.calls"
        private const val CHANNEL = "calls"
        private const val NOTES_ID = 4201

        private val STAGES = mapOf(
            LeadStage.NEW to SalesR.string.stage_new, LeadStage.CONTACTED to SalesR.string.stage_contacted,
            LeadStage.INTERESTED to SalesR.string.stage_interested, LeadStage.CONSULTATION_BOOKED to SalesR.string.stage_consultation_booked,
            LeadStage.CONSULTED to SalesR.string.stage_consulted, LeadStage.SURGERY_SCHEDULED to SalesR.string.stage_surgery_scheduled,
            LeadStage.CONVERTED to SalesR.string.stage_converted, LeadStage.LOST to SalesR.string.stage_lost,
            LeadStage.NOT_REACHABLE to SalesR.string.stage_not_reachable, LeadStage.JUNK to SalesR.string.stage_junk,
        )

        /** Both phone permissions are needed to know who is calling. */
        fun hasPermissions(context: Context): Boolean = listOf(Manifest.permission.READ_PHONE_STATE, Manifest.permission.READ_CALL_LOG)
            .all { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }

        private fun load(prefs: android.content.SharedPreferences): TrackedCall? {
            if (!prefs.contains("started")) return null
            return TrackedCall(prefs.getString("number", null), prefs.getLong("started", 0), prefs.getBoolean("incoming", false), prefs.getBoolean("answered", false))
        }

        private fun save(prefs: android.content.SharedPreferences, call: TrackedCall?) {
            prefs.edit().apply {
                if (call == null) clear()
                else putString("number", call.number).putLong("started", call.startedAt).putBoolean("incoming", call.incoming).putBoolean("answered", call.answered)
            }.apply()
        }
    }
}

/** Restart on boot: sync and recordings carry on; the call-state receiver needs nothing started. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val container = (context.applicationContext as? PearlApplication)?.container ?: return
        if (container.sessions.session.value == null) return
        container.scheduler.startPeriodic()
        container.scheduler.syncSoon()
        RecordingWorker.schedule(context)
    }
}
