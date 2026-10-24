package com.pearl.crm.core.data.db

import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Embedded
import androidx.room.Insert
import androidx.room.Query
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

/** A list row plus the name and number of the lead it belongs to (null when not on this phone). */
data class FollowupWithLead(
    @Embedded val task: FollowupEntity,
    @ColumnInfo(name = "lead_name") val leadName: String?,
    @ColumnInfo(name = "lead_phone") val leadPhone: String?,
)

data class CallWithLead(
    @Embedded val call: CallLogEntity,
    @ColumnInfo(name = "lead_name") val leadName: String?,
)

data class AppointmentWithLead(
    @Embedded val appointment: AppointmentEntity,
    @ColumnInfo(name = "lead_name") val leadName: String?,
    @ColumnInfo(name = "lead_phone") val leadPhone: String?,
)

@Dao
interface LeadDao {
    @Upsert
    suspend fun upsert(rows: List<LeadEntity>)

    @Query("DELETE FROM leads WHERE id IN (:ids)")
    suspend fun deleteByIds(ids: List<String>)

    @Query("SELECT * FROM leads WHERE id = :id")
    suspend fun get(id: String): LeadEntity?

    @Query("SELECT * FROM leads WHERE id = :id")
    fun observe(id: String): Flow<LeadEntity?>

    /**
     * The leads list: [stages] (empty = any), optionally only those due by [dueBy] (epoch ms),
     * matching [pattern] in the name or number ('' = all; LIKE wildcards already escaped).
     * Due follow-ups first (oldest first), then the most recently active.
     */
    @Query(
        """
        SELECT * FROM leads
        WHERE (:anyStage = 1 OR stage IN (:stages))
          AND (:dueBy IS NULL OR (next_followup_at IS NOT NULL AND next_followup_at <= :dueBy))
          AND (:pattern = '' OR name LIKE '%' || :pattern || '%' ESCAPE '\' OR phone_e164 LIKE '%' || :pattern || '%' ESCAPE '\')
        ORDER BY CASE WHEN next_followup_at IS NOT NULL AND next_followup_at <= :now THEN 0 ELSE 1 END,
                 CASE WHEN next_followup_at IS NOT NULL AND next_followup_at <= :now THEN next_followup_at END,
                 last_activity_at DESC, id
        LIMIT :limit
        """,
    )
    fun observeList(anyStage: Boolean, stages: List<String>, dueBy: Long?, pattern: String, now: Long, limit: Int): Flow<List<LeadEntity>>

    @Query("SELECT * FROM leads WHERE phone_last10 = :last10 OR (alt_phone_e164 IS NOT NULL AND substr(alt_phone_e164, -10) = :last10) LIMIT 1")
    suspend fun byPhone(last10: String): LeadEntity?

    @Query("UPDATE leads SET stage = :stage, lost_reason_id = :lostReasonId, pending = 1, last_activity_at = :now WHERE id = :id")
    suspend fun setStage(id: String, stage: String, lostReasonId: String?, now: Long)

    @Query("UPDATE leads SET next_followup_at = :at, pending = 1, last_activity_at = :now WHERE id = :id")
    suspend fun setNextFollowup(id: String, at: Long?, now: Long)

    @Query("UPDATE leads SET last_activity_at = :now, pending = 1 WHERE id = :id")
    suspend fun touch(id: String, now: Long)

    /** Leads made here that the server has taken (no longer queued) but didn't give back to us. */
    @Query("DELETE FROM leads WHERE local_only = 1 AND id NOT IN (SELECT id FROM outbox)")
    suspend fun dropSentLocalOnly(): Int

    @Query("SELECT COUNT(*) FROM leads WHERE next_followup_at IS NOT NULL AND next_followup_at <= :now AND stage NOT IN ('converted', 'lost', 'junk')")
    fun observeDueCount(now: Long): Flow<Int>
}

@Dao
interface FollowupDao {
    @Upsert
    suspend fun upsert(rows: List<FollowupEntity>)

    @Query("DELETE FROM followups WHERE id IN (:ids)")
    suspend fun deleteByIds(ids: List<String>)

    /** Open tasks for [staffId] up to [lastDay] (yyyy-MM-dd), oldest first. */
    @Query(
        """
        SELECT * FROM followups
        WHERE status = 'open' AND assigned_to = :staffId AND due_date <= :lastDay
        ORDER BY due_date, COALESCE(due_at, 0), id
        """,
    )
    fun observeOpen(staffId: String, lastDay: String): Flow<List<FollowupEntity>>

    @Query(
        """
        SELECT f.*, l.name AS lead_name, l.phone_e164 AS lead_phone FROM followups AS f
        LEFT JOIN leads AS l ON l.id = f.lead_id
        WHERE f.status = 'open' AND f.assigned_to = :staffId AND f.due_date <= :lastDay
        ORDER BY f.due_date, COALESCE(f.due_at, 0), f.id
        """,
    )
    fun observeOpenWithLead(staffId: String, lastDay: String): Flow<List<FollowupWithLead>>

    @Query("SELECT * FROM followups WHERE lead_id = :leadId ORDER BY due_date DESC, id")
    fun observeForLead(leadId: String): Flow<List<FollowupEntity>>

    @Query("UPDATE followups SET status = :status, outcome = :outcome, pending = 1 WHERE id = :id")
    suspend fun close(id: String, status: String, outcome: String?)

    @Query("SELECT * FROM followups WHERE id = :id")
    suspend fun get(id: String): FollowupEntity?

    /** A call that was the due follow-up closes it (same as `log_call` without a next date). */
    @Query(
        """
        UPDATE followups SET status = 'done', outcome = :outcome, pending = 1
        WHERE lead_id = :leadId AND kind = 'followup' AND status = 'open' AND due_at IS NOT NULL AND due_at <= :now
        """,
    )
    suspend fun closeDueForLead(leadId: String, outcome: String, now: Long)
}

@Dao
interface AppointmentDao {
    @Upsert
    suspend fun upsert(rows: List<AppointmentEntity>)

    @Query("DELETE FROM appointments WHERE id IN (:ids)")
    suspend fun deleteByIds(ids: List<String>)

    @Query("SELECT * FROM appointments WHERE lead_id = :leadId ORDER BY COALESCE(slot_start, 0) DESC")
    fun observeForLead(leadId: String): Flow<List<AppointmentEntity>>

    /** Upcoming bookings still waiting for the patient to confirm (needs-confirmation list). */
    @Query(
        """
        SELECT * FROM appointments
        WHERE status = 'pending_confirmation' AND slot_start > :now AND lead_id IS NOT NULL
        ORDER BY slot_start
        """,
    )
    fun observeNeedsConfirmation(now: Long): Flow<List<AppointmentEntity>>

    @Query(
        """
        SELECT a.*, l.name AS lead_name, l.phone_e164 AS lead_phone FROM appointments AS a
        JOIN leads AS l ON l.id = a.lead_id
        WHERE a.status = 'pending_confirmation' AND a.slot_start > :now
        ORDER BY a.slot_start
        """,
    )
    fun observeNeedsConfirmationWithLead(now: Long): Flow<List<AppointmentWithLead>>

    @Query("UPDATE appointments SET status = :status, pending = 1 WHERE id = :id")
    suspend fun setStatus(id: String, status: String)
}

@Dao
interface CallLogDao {
    @Upsert
    suspend fun upsert(rows: List<CallLogEntity>)

    @Query("DELETE FROM call_logs WHERE id IN (:ids)")
    suspend fun deleteByIds(ids: List<String>)

    @Query("SELECT * FROM call_logs WHERE id = :id")
    suspend fun get(id: String): CallLogEntity?

    @Query("SELECT * FROM call_logs WHERE lead_id = :leadId ORDER BY started_at DESC")
    fun observeForLead(leadId: String): Flow<List<CallLogEntity>>

    @Query("SELECT * FROM call_logs ORDER BY started_at DESC LIMIT :limit")
    fun observeRecent(limit: Int): Flow<List<CallLogEntity>>

    @Query(
        """
        SELECT c.*, l.name AS lead_name FROM call_logs AS c LEFT JOIN leads AS l ON l.id = c.lead_id
        ORDER BY c.started_at DESC LIMIT :limit
        """,
    )
    fun observeRecentWithLead(limit: Int): Flow<List<CallWithLead>>

    @Query("SELECT COUNT(*) FROM call_logs WHERE device_call_key = :key")
    suspend fun countByDeviceKey(key: String): Int

    /** Calls around a time, for matching recordings and imports (with the number's last 10 digits). */
    @Query("SELECT * FROM call_logs WHERE started_at BETWEEN :from AND :to ORDER BY started_at")
    suspend fun between(from: Long, to: Long): List<CallLogEntity>

    @Insert(onConflict = androidx.room.OnConflictStrategy.IGNORE)
    suspend fun insertIgnore(rows: List<CallLogEntity>)

    /** Calls made here that the server took but didn't send back (e.g. the lead moved to someone else). */
    @Query("DELETE FROM call_logs WHERE pending = 1 AND id NOT IN (SELECT id FROM outbox)")
    suspend fun dropSentPending(): Int
}
