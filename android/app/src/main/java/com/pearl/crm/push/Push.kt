package com.pearl.crm.push

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import com.pearl.crm.BuildConfig
import com.pearl.crm.R

/**
 * Push notifications through Firebase Cloud Messaging. Works only when the owner's
 * google-services.json was present at build time (BuildConfig.PUSH_ENABLED); otherwise every
 * call here does nothing.
 */
object Push {
    const val CHANNEL_GENERAL = "general"

    fun isAvailable(context: Context): Boolean =
        BuildConfig.PUSH_ENABLED && FirebaseApp.getApps(context).isNotEmpty()

    /** Asks Firebase for this phone's token (also delivered later via onNewToken). */
    fun registerToken(context: Context, onToken: (String) -> Unit) {
        if (!isAvailable(context)) return
        FirebaseMessaging.getInstance().token.addOnSuccessListener { token -> if (!token.isNullOrBlank()) onToken(token) }
    }

    fun createChannels(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_GENERAL, context.getString(R.string.notification_channel_general), NotificationManager.IMPORTANCE_DEFAULT),
        )
    }

    /** Android 13+ asks the person; older versions allow notifications by default. */
    fun canNotify(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    @SuppressLint("MissingPermission") // checked by canNotify() just below
    fun show(context: Context, id: Int, title: String, body: String) {
        if (!canNotify(context)) return
        val notification = NotificationCompat.Builder(context, CHANNEL_GENERAL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .build()
        NotificationManagerCompat.from(context).notify(id, notification)
    }
}
