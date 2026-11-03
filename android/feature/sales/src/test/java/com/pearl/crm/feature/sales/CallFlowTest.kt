package com.pearl.crm.feature.sales

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith

/**
 * A call started from the app opens ONE notes sheet: when the phone's call watcher is on, it
 * claims the call (it has the real length) and the app's own sheet stays shut; when it is off or
 * doesn't know the number, the app's sheet opens as before.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(AndroidJUnit4::class)
class CallFlowTest {
    private class FakeWatcher(var on: Boolean) : AfterCallWatcher {
        override fun active() = on
        override val pendingLeadId = MutableStateFlow<String?>(null)
    }

    private val call = StartedCall("lead-1", "+919000000001", System.currentTimeMillis() - 30_000)
    private val scope = TestScope()

    private fun flow(watcher: AfterCallWatcher?) =
        CallFlow(ApplicationProvider.getApplicationContext(), scope, watcher).also { it.started = call }

    @Test
    fun withoutTheWatcherTheSheetOpensAtOnce() {
        val f = flow(null)
        f.onResume()
        assertEquals(call, f.needsNotes)
        assertNull("one call, one sheet: nothing left to resume", f.started)
    }

    @Test
    fun withTheWatcherSwitchedOffTheSheetOpensAtOnce() {
        val f = flow(FakeWatcher(on = false))
        f.onResume()
        assertEquals(call, f.needsNotes)
    }

    @Test
    fun whenTheWatcherClaimsTheCallTheAppsOwnSheetStaysShut() {
        val watcher = FakeWatcher(on = true)
        val f = flow(watcher)
        f.onResume()
        scope.advanceTimeBy(1_500)
        watcher.pendingLeadId.value = call.leadId // the watcher's sheet opens
        scope.advanceTimeBy(CallFlow.HANDOFF_MS)
        scope.runCurrent()
        assertNull(f.needsNotes)
    }

    @Test
    fun aWatcherSheetAlreadyOpenCountsAsTheClaim() {
        val watcher = FakeWatcher(on = true).apply { pendingLeadId.value = call.leadId }
        val f = flow(watcher)
        f.onResume()
        scope.advanceTimeBy(CallFlow.HANDOFF_MS + 1)
        scope.runCurrent()
        assertNull(f.needsNotes)
    }

    @Test
    fun whenTheWatcherDoesNotClaimItTheAppsSheetOpensAfterTheWait() {
        val watcher = FakeWatcher(on = true)
        val f = flow(watcher)
        f.onResume()
        scope.advanceTimeBy(CallFlow.HANDOFF_MS - 100)
        assertNull("still waiting for the watcher", f.needsNotes)
        watcher.pendingLeadId.value = "another-lead" // a different call doesn't count
        scope.advanceTimeBy(200)
        scope.runCurrent()
        assertEquals(call, f.needsNotes)
    }
}
