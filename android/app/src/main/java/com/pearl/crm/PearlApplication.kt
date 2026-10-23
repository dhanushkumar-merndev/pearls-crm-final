package com.pearl.crm

import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.pearl.crm.core.sync.SyncHost
import com.pearl.crm.core.sync.SyncRunner
import com.pearl.crm.push.Push

class PearlApplication : Application(), SyncHost {
    lateinit var container: AppContainer
        private set

    override val syncRunner: SyncRunner
        get() = container.syncRunner

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        container.crashes.install()
        Push.createChannels(this)
        ProcessLifecycleOwner.get().lifecycle.addObserver(
            object : DefaultLifecycleObserver {
                override fun onStart(owner: LifecycleOwner) {
                    container.lock.onForeground()
                    if (container.sessions.session.value != null) container.scheduler.syncSoon()
                }

                override fun onStop(owner: LifecycleOwner) {
                    container.lock.onBackground()
                }
            },
        )
    }

    /** The session already ended inside the RPC client; the screens follow the session state. */
    override fun onSyncSignedOut() = Unit
}
