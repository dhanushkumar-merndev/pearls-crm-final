package com.pearl.crm.core.model

/** The call in progress, as far as the phone-state broadcasts have told us. */
data class TrackedCall(
    /** Null until a broadcast carries the number (it comes in a second broadcast, with READ_CALL_LOG). */
    val number: String?,
    val startedAt: Long,
    val incoming: Boolean,
    val answered: Boolean,
)

sealed interface CallEvent {
    /** Show the caller bubble for [number]. */
    data class Show(val number: String) : CallEvent

    /** The call is over: hide the bubble, ask for notes. */
    data class Ended(val call: TrackedCall, val endedAt: Long) : CallEvent

    data object Nothing : CallEvent
}

/**
 * Turns Android's phone-state broadcasts (IDLE / RINGING / OFFHOOK, each often sent twice:
 * once without and once with the number) into "show the bubble" and "the call ended".
 * Pure, so the receiver can keep the state in preferences between broadcasts.
 */
object CallTracker {
    const val IDLE = "IDLE"
    const val RINGING = "RINGING"
    const val OFFHOOK = "OFFHOOK"

    fun next(current: TrackedCall?, state: String, number: String?, now: Long): Pair<TrackedCall?, CallEvent> {
        val num = number?.takeIf { it.isNotBlank() }
        return when (state) {
            RINGING -> when {
                current == null -> TrackedCall(num, now, incoming = true, answered = false) to (num?.let { CallEvent.Show(it) } ?: CallEvent.Nothing)
                current.number == null && num != null -> current.copy(number = num) to CallEvent.Show(num)
                else -> current to CallEvent.Nothing
            }
            OFFHOOK -> when {
                current == null -> TrackedCall(num, now, incoming = false, answered = true) to (num?.let { CallEvent.Show(it) } ?: CallEvent.Nothing)
                current.number == null && num != null -> current.copy(number = num, answered = true) to CallEvent.Show(num)
                else -> current.copy(answered = true) to CallEvent.Nothing
            }
            IDLE -> if (current == null) null to CallEvent.Nothing else null to CallEvent.Ended(current, now)
            else -> current to CallEvent.Nothing
        }
    }
}
