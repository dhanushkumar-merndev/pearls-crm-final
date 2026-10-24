package com.pearl.crm.core.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface LookupValueDao {
    @Upsert
    suspend fun upsert(rows: List<LookupValueEntity>)

    @Query("DELETE FROM lookup_values WHERE id IN (:ids)")
    suspend fun deleteByIds(ids: List<String>)

    @Query("DELETE FROM lookup_values")
    suspend fun clear()

    @Query("SELECT * FROM lookup_values WHERE id = :id")
    suspend fun get(id: String): LookupValueEntity?

    /**
     * The offline picker: same order as `library_search` (prefix matches first, then most
     * used, then name). [pattern] must already have LIKE wildcards escaped with '\'.
     */
    @Query(
        """
        SELECT * FROM lookup_values
        WHERE kind = :kind AND active = 1 AND merged_into_id IS NULL
          AND (:pattern = '' OR label LIKE '%' || :pattern || '%' ESCAPE '\')
        ORDER BY CASE WHEN :pattern <> '' AND label LIKE :pattern || '%' ESCAPE '\' THEN 0 ELSE 1 END,
                 usage_count DESC, lower(label), id
        LIMIT :limit OFFSET :offset
        """,
    )
    suspend fun search(kind: String, pattern: String, limit: Int, offset: Int): List<LookupValueEntity>
}

@Dao
abstract class OutboxDao {
    @Query("SELECT COALESCE(MAX(seq), 0) FROM outbox")
    protected abstract suspend fun maxSeq(): Long

    @Insert
    protected abstract suspend fun insert(item: OutboxItem)

    /** Adds [item] after everything already queued. */
    @Transaction
    open suspend fun enqueue(item: OutboxItem) {
        insert(item.copy(seq = maxSeq() + 1))
    }

    /**
     * Items ready to send: pending, due, and first in line for their entity (nothing older for
     * the same entity is still waiting or failed). Cheap thanks to the (entity_key, seq) index.
     */
    @Query(
        """
        SELECT * FROM outbox AS o
        WHERE o.state = 'pending' AND o.next_attempt_at <= :now
          AND NOT EXISTS (SELECT 1 FROM outbox AS p WHERE p.entity_key = o.entity_key AND p.seq < o.seq)
        ORDER BY o.seq
        LIMIT :limit
        """,
    )
    abstract suspend fun dueHeads(now: Long, limit: Int): List<OutboxItem>

    @Query("SELECT * FROM outbox WHERE id = :id")
    abstract suspend fun get(id: String): OutboxItem?

    @Query("DELETE FROM outbox WHERE id = :id")
    abstract suspend fun delete(id: String)

    @Query("UPDATE outbox SET attempts = attempts + 1, next_attempt_at = :nextAttemptAt, last_error = :error WHERE id = :id")
    abstract suspend fun markRetry(id: String, nextAttemptAt: Long, error: String)

    @Query("UPDATE outbox SET state = 'failed', attempts = attempts + 1, last_error = :code WHERE id = :id")
    abstract suspend fun markFailed(id: String, code: String)

    /** "Try again" on a failed item. */
    @Query("UPDATE outbox SET state = 'pending', attempts = 0, next_attempt_at = :now, last_error = NULL WHERE id = :id AND state = 'failed'")
    abstract suspend fun retry(id: String, now: Long): Int

    /** When the next send is due: only first-in-line items count (the rest wait behind them). */
    @Query(
        """
        SELECT MIN(o.next_attempt_at) FROM outbox AS o
        WHERE o.state = 'pending'
          AND NOT EXISTS (SELECT 1 FROM outbox AS p WHERE p.entity_key = o.entity_key AND p.seq < o.seq)
        """,
    )
    abstract suspend fun earliestPending(): Long?

    @Query("SELECT COUNT(*) FROM outbox WHERE state = 'pending'")
    abstract suspend fun pendingCount(): Int

    /** What the person would lose by signing out now (crash reports don't count). */
    @Query("SELECT COUNT(*) FROM outbox WHERE kind = 'user'")
    abstract fun observeUnsentCount(): Flow<Int>

    @Query("SELECT COUNT(*) FROM outbox WHERE kind = 'user'")
    abstract suspend fun unsentCount(): Int

    @Query("SELECT * FROM outbox WHERE state = 'failed' AND kind = 'user' ORDER BY seq")
    abstract fun observeFailed(): Flow<List<OutboxItem>>
}

@Dao
interface SyncMarkerDao {
    @Query("SELECT marker FROM sync_markers WHERE entity = :entity")
    suspend fun marker(entity: String): String?

    @Upsert
    suspend fun set(marker: SyncMarker)

    @Query("SELECT MAX(pulled_at) FROM sync_markers")
    fun observeLastPull(): Flow<Long?>
}
