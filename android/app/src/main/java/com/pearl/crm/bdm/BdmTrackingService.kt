package com.pearl.crm.bdm

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.pearl.crm.BuildConfig
import com.pearl.crm.MainActivity
import com.pearl.crm.PearlApplication
import com.pearl.crm.R
import com.pearl.crm.core.data.PhoneStatus
import com.pearl.crm.core.model.RpcFailure
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Keeps the BDM's route while the day is open: a reading every second, saved on the phone (the
 * track filter keeps a point every ~15 m, so the line follows the roads), uploaded every few
 * minutes (admin setting), a heartbeat for the live map, and "location switched off" reported
 * to the admin. Runs as a visible foreground service
 * ("Your day is being recorded") started from the app, so it needs no background permission.
 */
class BdmTrackingService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var stopTracking: (() -> Unit)? = null
    private var loops: Job? = null
    private var mockReported = false
    private var lastGpsOn: Boolean? = null

    private val providers = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val on = container.location.enabled()
            if (on == lastGpsOn) return
            lastGpsOn = on
            scope.launch { container.bdm.reportEvent(if (on) "gps_on" else "gps_off") }
        }
    }

    private val container get() = (application as PearlApplication).container

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!container.bdm.day.value.open || !container.location.permitted()) {
            stopSelf()
            return START_NOT_STICKY
        }
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        if (stopTracking == null) start()
        return START_STICKY
    }

    private fun start() {
        lastGpsOn = container.location.enabled()
        ContextCompat.registerReceiver(this, providers, IntentFilter(LocationManager.PROVIDERS_CHANGED_ACTION), ContextCompat.RECEIVER_NOT_EXPORTED)
        stopTracking = container.location.track(intervalMs = 1_000, minDistanceM = 0f) { p ->
            scope.launch {
                container.bdm.recordPoint(p)
                if (p.mock && !mockReported) {
                    mockReported = true
                    container.bdm.reportEvent("mock_location", p)
                }
            }
        }
        loops = scope.launch {
            launch {
                while (isActive) {
                    delay(container.bdm.uploadMinutes * 60_000L)
                    runCatching { container.bdm.flushTrack() }
                }
            }
            launch {
                while (isActive) {
                    heartbeat()
                    delay(container.bdm.heartbeatMinutes * 60_000L)
                }
            }
            // The day ended (button, or the server's auto-end seen at refresh): stop.
            container.bdm.day.first { !it.open }
            runCatching { container.bdm.flushTrack(force = true) }
            stopSelf()
        }
    }

    private suspend fun heartbeat() {
        val reply = try {
            container.bdm.heartbeat(status(fix = null))
        } catch (_: RpcFailure) {
            return
        }
        if (reply.locateNow) {
            val fix = container.location.current()
            runCatching { container.bdm.heartbeat(status(fix)) }
        }
    }

    private fun status(fix: com.pearl.crm.core.model.RawPoint?): PhoneStatus {
        val battery = getSystemService(BatteryManager::class.java)
        val net = getSystemService(ConnectivityManager::class.java)?.let { cm ->
            cm.getNetworkCapabilities(cm.activeNetwork)?.let {
                when {
                    it.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
                    it.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "mobile"
                    else -> "other"
                }
            } ?: "none"
        }
        return PhoneStatus(
            fix = fix,
            battery = battery?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY),
            charging = battery?.isCharging,
            gpsOn = container.location.enabled(),
            network = net,
            appVersion = BuildConfig.VERSION_NAME,
        )
    }

    private fun notification(): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        manager?.createNotificationChannel(NotificationChannel(CHANNEL, getString(R.string.tracking_channel), NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(getString(R.string.tracking_title))
            .setContentText(getString(R.string.tracking_body))
            .setOngoing(true)
            .setContentIntent(open)
            .build()
    }

    override fun onDestroy() {
        stopTracking?.invoke()
        stopTracking = null
        runCatching { unregisterReceiver(providers) }
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL = "tracking"
        private const val NOTIFICATION_ID = 4301
        private const val RESUME_ID = 4302

        /** From the app (in front): allowed to start location tracking. */
        fun start(context: Context) {
            runCatching { ContextCompat.startForegroundService(context, Intent(context, BdmTrackingService::class.java)) }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, BdmTrackingService::class.java))
        }

        /** After a phone restart Android doesn't let us start tracking unseen: ask the BDM to tap. */
        fun askToResume(context: Context) {
            val manager = context.getSystemService(NotificationManager::class.java) ?: return
            manager.createNotificationChannel(NotificationChannel(CHANNEL, context.getString(R.string.tracking_channel), NotificationManager.IMPORTANCE_LOW))
            val open = PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
            val n = NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(context.getString(R.string.tracking_resume_title))
                .setContentText(context.getString(R.string.tracking_resume_body))
                .setContentIntent(open)
                .setAutoCancel(true)
                .build()
            if (com.pearl.crm.push.Push.canNotify(context)) runCatching { manager.notify(RESUME_ID, n) }
        }
    }
}
