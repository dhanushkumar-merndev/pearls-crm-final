package com.pearl.crm.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CallTrackerTest {
    private fun run(vararg steps: Triple<String, String?, Long>): List<CallEvent> {
        var state: TrackedCall? = null
        return steps.map { (s, n, t) ->
            val (next, event) = CallTracker.next(state, s, n, t)
            state = next
            event
        }
    }

    @Test
    fun incomingAnsweredCall() {
        val events = run(
            Triple("RINGING", null, 1000),
            Triple("RINGING", "+919845012345", 1001),
            Triple("OFFHOOK", null, 5000),
            Triple("OFFHOOK", "+919845012345", 5001),
            Triple("IDLE", null, 65000),
            Triple("IDLE", "+919845012345", 65001),
        )
        assertEquals(CallEvent.Nothing, events[0])
        assertEquals(CallEvent.Show("+919845012345"), events[1])
        assertEquals(CallEvent.Nothing, events[2])
        assertEquals(CallEvent.Nothing, events[3])
        assertEquals(CallEvent.Ended(TrackedCall("+919845012345", 1000, incoming = true, answered = true), 65000), events[4])
        assertEquals(CallEvent.Nothing, events[5]) // the second IDLE broadcast changes nothing
    }

    @Test
    fun outgoingCall() {
        val events = run(Triple("OFFHOOK", "9845012345", 1000), Triple("IDLE", null, 31000))
        assertEquals(CallEvent.Show("9845012345"), events[0])
        val ended = events[1] as CallEvent.Ended
        assertEquals(false, ended.call.incoming)
        assertEquals(30000L, ended.endedAt - ended.call.startedAt)
    }

    @Test
    fun missedCallEndsUnanswered() {
        val ended = run(Triple("RINGING", "9845012345", 0), Triple("IDLE", null, 20000))[1] as CallEvent.Ended
        assertEquals(false, ended.call.answered)
    }

    @Test
    fun idleWithoutACallIsNothing() {
        val (state, event) = CallTracker.next(null, "IDLE", null, 0)
        assertNull(state)
        assertEquals(CallEvent.Nothing, event)
    }
}
