package com.pearl.crm.push

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.pearl.crm.PearlApplication
import kotlinx.coroutines.launch

/** Receives push messages and new tokens (only active when push is configured). */
class PearlMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        val container = (application as PearlApplication).container
        if (container.sessions.session.value == null) return
        container.scope.launch { container.account.registerPushToken(token, container.appVersion) }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val title = message.notification?.title ?: message.data["title"] ?: return
        val body = message.notification?.body ?: message.data["body"].orEmpty()
        Push.show(this, message.messageId?.hashCode() ?: title.hashCode(), title, body)
        // The message may mean "something changed for you": pull it now.
        (application as PearlApplication).container.scheduler.syncSoon()
    }
}
