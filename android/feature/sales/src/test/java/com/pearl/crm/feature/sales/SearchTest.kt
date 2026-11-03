package com.pearl.crm.feature.sales

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SearchTest {
    @Test
    fun fastTypingOnlySearchesTheFinalTextAndClearingCancelsPendingText() = runTest {
        val input = MutableStateFlow("")
        val searched = mutableListOf<String>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            input.debouncedLeadSearch().collect { searched += it }
        }
        runCurrent()
        input.value = "a"
        runCurrent()
        advanceTimeBy(150)
        input.value = "ab"
        runCurrent()
        advanceTimeBy(299)
        runCurrent()
        assertEquals(listOf(""), searched)
        advanceTimeBy(1)
        runCurrent()
        assertEquals(listOf("", "ab"), searched)
        input.value = "abc"
        runCurrent()
        advanceTimeBy(100)
        input.value = ""
        runCurrent()
        assertEquals(listOf("", "ab", ""), searched)
        advanceTimeBy(500)
        runCurrent()
        assertEquals(listOf("", "ab", ""), searched)
    }
}
