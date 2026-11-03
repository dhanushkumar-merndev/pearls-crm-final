package com.pearl.crm.core.data

import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TimedMemoryCacheTest {
    @Test
    fun evictsTheLeastRecentlyUsedEntryAtCapacity() {
        val cache = TimedMemoryCache<String, Int>(2, clock = { 0L })
        val version = cache.version()
        cache.put("a", 1, version)
        cache.put("b", 2, version)
        assertEquals(1, cache.get("a"))
        cache.put("c", 3, version)
        assertNull(cache.get("b"))
        assertEquals(1, cache.get("a"))
        assertEquals(3, cache.get("c"))
    }

    @Test
    fun expiresAndRejectsLateResultsAfterClearing() {
        var time = 0L
        val cache = TimedMemoryCache<String, Int>(2, clock = { time })
        val version = cache.version()
        cache.put("a", 1, version)
        time = 29_999
        assertEquals(1, cache.get("a"))
        time = 30_000
        assertNull(cache.get("a"))
        cache.clear()
        cache.put("a", 2, version)
        assertNull(cache.get("a"))
        cache.put("a", 3, cache.version())
        assertEquals(3, cache.get("a"))
    }

    @Test
    fun trackingAlwaysReturnsTheCurrentAuthoritativeValue() = runTest {
        val cache = TimedMemoryCache<String, Int>(2, clock = { 0L })
        assertEquals(1, cache.track("a", flowOf(1)).first())
        assertEquals(1, cache.get("a"))
        assertEquals(2, cache.track("a", flowOf(2)).first())
        assertEquals(2, cache.get("a"))
    }

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    @Test
    fun activeReadRewarmsAfterInvalidation() = runTest {
        val cache = TimedMemoryCache<String, Int>(2, clock = { 0L })
        val source = MutableStateFlow(1)
        backgroundScope.launch { cache.track("a", source).collect {} }
        runCurrent()
        assertEquals(1, cache.get("a"))
        cache.clear()
        runCurrent()
        assertEquals(1, cache.get("a"))
        source.value = 2
        runCurrent()
        assertEquals(2, cache.get("a"))
    }
}
