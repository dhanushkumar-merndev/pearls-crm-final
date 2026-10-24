package com.pearl.crm.core.data.db

import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonObject

/**
 * A number the CRM knows (a lead this person may work on), from `sync_pull` "crm_numbers".
 * Only calls with these numbers are imported or recorded; every other call stays private.
 */
@Entity(
    tableName = "crm_numbers",
    indices = [Index(value = ["phone_last10"]), Index(value = ["alt_phone_last10"])],
)
data class CrmNumberEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "lead_id") val leadId: String,
    @ColumnInfo(name = "phone_last10") val phoneLast10: String,
    @ColumnInfo(name = "alt_phone_last10") val altPhoneLast10: String?,
    @ColumnInfo(name = "patient_id") val patientId: String?,
    @ColumnInfo(name = "updated_at") val updatedAt: String,
) {
    companion object {
        fun fromRow(row: JsonObject) = CrmNumberEntity(
            id = row.str("id") ?: throw IllegalArgumentException("crm_numbers row without id"),
            leadId = row.str("lead_id") ?: row.str("id")!!,
            phoneLast10 = row.str("phone_last10") ?: throw IllegalArgumentException("crm_numbers row without number"),
            altPhoneLast10 = row.str("alt_phone_last10"),
            patientId = row.str("patient_id"),
            updatedAt = row.str("updated_at").orEmpty(),
        )
    }
}

/** What the caller pop-up shows for a number. */
data class CallerCard(
    @ColumnInfo(name = "lead_id") val leadId: String,
    val name: String?,
    val stage: String?,
    @ColumnInfo(name = "next_followup_at") val nextFollowupAt: Long?,
    @ColumnInfo(name = "last_note") val lastNote: String?,
)

@Dao
interface CrmNumberDao {
    @Upsert
    suspend fun upsert(rows: List<CrmNumberEntity>)

    @Query("DELETE FROM crm_numbers WHERE id IN (:ids)")
    suspend fun deleteByIds(ids: List<String>)

    @Query("SELECT phone_last10 FROM crm_numbers UNION SELECT alt_phone_last10 FROM crm_numbers WHERE alt_phone_last10 IS NOT NULL")
    suspend fun allLast10(): List<String>

    /** The lead for a number, with what the pop-up shows (the lead row may not be on the phone for a manager's number). */
    @Query(
        """
        SELECT n.lead_id AS lead_id, l.name AS name, l.stage AS stage, l.next_followup_at AS next_followup_at,
               (SELECT c.notes FROM call_logs c WHERE c.lead_id = n.lead_id AND c.notes IS NOT NULL ORDER BY c.started_at DESC LIMIT 1) AS last_note
        FROM crm_numbers n LEFT JOIN leads l ON l.id = n.lead_id
        WHERE n.phone_last10 = :last10 OR n.alt_phone_last10 = :last10
        ORDER BY l.last_activity_at DESC
        LIMIT 1
        """,
    )
    suspend fun card(last10: String): CallerCard?
}

/**
 * A dialer recording matched to a CRM call (or a voice note made in the app). The file stays
 * where it is ([uri]); only a trimmed, compressed copy is uploaded.
 * status: on_phone → queued → uploading → synced | failed.
 */
@Entity(
    tableName = "recordings",
    indices = [Index(value = ["status"]), Index(value = ["uri"], unique = true), Index(value = ["lead_id"])],
)
data class RecordingEntity(
    @PrimaryKey val id: String,
    val kind: String,
    val uri: String,
    @ColumnInfo(name = "file_name") val fileName: String,
    @ColumnInfo(name = "size_bytes") val sizeBytes: Long,
    @ColumnInfo(name = "recorded_at") val recordedAt: Long,
    @ColumnInfo(name = "duration_s") val durationS: Int,
    @ColumnInfo(name = "call_log_id") val callLogId: String?,
    @ColumnInfo(name = "lead_id") val leadId: String?,
    val confidence: Double?,
    @ColumnInfo(name = "needs_review") val needsReview: Boolean,
    val status: String,
    @ColumnInfo(name = "file_id") val fileId: String?,
    @ColumnInfo(name = "uploaded_s") val uploadedS: Int?,
    val trimmed: Boolean,
    val error: String?,
    val attempts: Int,
    @ColumnInfo(name = "lost_note") val lostNote: Boolean,
    @ColumnInfo(name = "created_at") val createdAt: Long,
)

/** A row of the "On phone" list. */
data class RecordingWithLead(
    @androidx.room.Embedded val recording: RecordingEntity,
    @ColumnInfo(name = "lead_name") val leadName: String?,
)

@Dao
interface RecordingDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(row: RecordingEntity): Long

    @Query("SELECT * FROM recordings WHERE id = :id")
    suspend fun get(id: String): RecordingEntity?

    @Query("SELECT uri FROM recordings")
    suspend fun knownUris(): List<String>

    @Query("SELECT r.*, l.name AS lead_name FROM recordings r LEFT JOIN leads l ON l.id = r.lead_id ORDER BY r.recorded_at DESC LIMIT :limit")
    fun observeAll(limit: Int): Flow<List<RecordingWithLead>>

    @Query("SELECT * FROM recordings WHERE status = 'queued' AND attempts < :maxAttempts ORDER BY recorded_at")
    suspend fun queued(maxAttempts: Int): List<RecordingEntity>

    @Query("SELECT COUNT(*) FROM recordings WHERE status IN ('queued', 'uploading')")
    fun observeWaitingCount(): Flow<Int>

    /** Queue for upload (a manager asked, the person tapped Sync, or the mode uploads every call). */
    @Query("UPDATE recordings SET status = 'queued', attempts = 0, error = NULL WHERE id IN (:ids) AND status IN ('on_phone', 'failed')")
    suspend fun queue(ids: List<String>): Int

    @Query("UPDATE recordings SET status = :status, error = :error, attempts = attempts + :addAttempt WHERE id = :id")
    suspend fun setStatus(id: String, status: String, error: String?, addAttempt: Int = 0)

    @Query("UPDATE recordings SET status = 'synced', file_id = :fileId, uploaded_s = :uploadedS, trimmed = :trimmed, error = NULL WHERE id = :id")
    suspend fun markSynced(id: String, fileId: String, uploadedS: Int, trimmed: Boolean)

    /** An upload cut short by the app being stopped goes back in the queue. */
    @Query("UPDATE recordings SET status = 'queued' WHERE status = 'uploading'")
    suspend fun requeueInterrupted(): Int
}
