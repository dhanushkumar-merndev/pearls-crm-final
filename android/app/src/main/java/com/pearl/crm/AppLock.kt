package com.pearl.crm

import com.pearl.crm.core.data.SettingsStore
import com.pearl.crm.core.data.security.PinController
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Asks for the PIN when the app opens after 5 minutes or more in the background (or after a
 * fresh start with no record of when it left). The time is kept on disk, so a phone that
 * killed the app in the background still asks.
 */
class AppLock(
    private val settings: SettingsStore,
    private val pins: PinController,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val _locked = MutableStateFlow(shouldLock())
    val locked: StateFlow<Boolean> = _locked.asStateFlow()

    fun onBackground() {
        settings.lastBackgroundAt = clock()
    }

    fun onForeground() {
        if (shouldLock()) _locked.value = true
    }

    fun unlock() {
        _locked.value = false
    }

    private fun shouldLock(): Boolean {
        if (!pins.hasPin.value) return false
        val leftAt = settings.lastBackgroundAt ?: return true
        return clock() - leftAt >= LOCK_AFTER_MS
    }

    companion object {
        const val LOCK_AFTER_MS = 5 * 60_000L
    }
}
