package com.pearl.crm.ui.pin

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.pearl.crm.AppLock
import com.pearl.crm.core.data.auth.SessionManager
import com.pearl.crm.core.data.auth.SignOutReason
import com.pearl.crm.core.data.security.PinCheck
import com.pearl.crm.core.data.security.PinController
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class PinUiState(val busy: Boolean = false, val triesLeft: Int? = null)

/** Creating, checking and changing the PIN. Five wrong tries in a row sign the person out. */
class PinViewModel(
    private val pins: PinController,
    private val lock: AppLock,
    private val sessions: SessionManager,
) : ViewModel() {
    private val _state = MutableStateFlow(PinUiState())
    val state: StateFlow<PinUiState> = _state.asStateFlow()

    fun create(pin: String, onDone: () -> Unit = {}) {
        _state.value = PinUiState(busy = true)
        viewModelScope.launch {
            pins.set(pin)
            lock.unlock()
            _state.value = PinUiState()
            onDone()
        }
    }

    /** Unlock the app, or (with [onOk]) confirm the current PIN before changing it. */
    fun check(pin: String, onOk: () -> Unit = lock::unlock) {
        _state.value = _state.value.copy(busy = true)
        viewModelScope.launch {
            when (val result = pins.verify(pin)) {
                PinCheck.Ok -> {
                    _state.value = PinUiState()
                    onOk()
                }
                is PinCheck.Wrong -> _state.value = PinUiState(triesLeft = result.triesLeft)
                PinCheck.LockedOut -> {
                    _state.value = PinUiState()
                    sessions.signOut(SignOutReason.PinLockout)
                }
                PinCheck.NoPin -> {
                    _state.value = PinUiState()
                    lock.unlock()
                }
            }
        }
    }

    fun forgot() {
        viewModelScope.launch {
            pins.clear()
            sessions.signOut(SignOutReason.ForgotPin)
        }
    }

    fun reset() {
        _state.value = PinUiState()
    }
}
