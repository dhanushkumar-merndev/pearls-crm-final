package com.pearl.crm.core.data.security

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext

/** [PinStore] for screens: hashing runs off the main thread, and "has a PIN" is observable. */
class PinController(private val store: PinStore) {
    private val _hasPin = MutableStateFlow(store.hasPin())
    val hasPin: StateFlow<Boolean> = _hasPin.asStateFlow()

    suspend fun set(pin: String) {
        withContext(Dispatchers.Default) { store.setPin(pin) }
        _hasPin.value = true
    }

    suspend fun verify(pin: String): PinCheck {
        val result = withContext(Dispatchers.Default) { store.verify(pin) }
        if (result is PinCheck.LockedOut || result is PinCheck.NoPin) _hasPin.value = false
        return result
    }

    fun clear() {
        store.clear()
        _hasPin.value = false
    }
}
