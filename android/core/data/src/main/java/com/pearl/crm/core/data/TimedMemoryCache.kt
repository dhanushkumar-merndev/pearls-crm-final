package com.pearl.crm.core.data

import java.util.LinkedHashMap
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.onEach

/** Small, expiring read snapshots. Clearing also rejects results from older in-flight reads. */
internal class TimedMemoryCache<K, V>(
    private val capacity: Int,
    private val ttlMillis: Long = 30_000,
    private val clock: () -> Long,
) {
    private data class Entry<V>(val value: V, val at: Long)
    private val entries = LinkedHashMap<K, Entry<V>>(capacity, 0.75f, true)
    private var generation = 0L
    private val versions = MutableStateFlow(0L)

    @Synchronized
    fun version(): Long = generation

    @Synchronized
    fun get(key: K): V? {
        val entry = entries[key] ?: return null
        if (clock() - entry.at !in 0 until ttlMillis) {
            entries.remove(key)
            return null
        }
        return entry.value
    }

    @Synchronized
    fun put(key: K, value: V, version: Long) {
        if (version != generation) return
        entries[key] = Entry(value, clock())
        while (entries.size > capacity) entries.remove(entries.keys.first())
    }

    @Synchronized
    fun clear() {
        generation++
        entries.clear()
        versions.value = generation
    }

    /** Always collect the authoritative source; snapshots are only used for initial UI. */
    @OptIn(ExperimentalCoroutinesApi::class)
    fun track(key: K, source: Flow<V>): Flow<V> =
        versions.flatMapLatest { version ->
            source.onEach { value -> put(key, value, version) }
        }
}
