package com.pearl.crm.core.data.db

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import java.time.LocalDate
import java.time.OffsetDateTime

/** A Postgres timestamptz from `sync_pull` ("2026-10-24T06:50:00.225+00:00") → epoch ms. */
internal fun isoMs(text: String?): Long? =
    text?.let { runCatching { OffsetDateTime.parse(it).toInstant().toEpochMilli() }.getOrNull() }

internal fun JsonObject.str(key: String): String? = this[key]?.jsonPrimitive?.contentOrNull

internal fun JsonObject.long(key: String): Long? = this[key]?.jsonPrimitive?.longOrNull

internal fun JsonObject.int(key: String): Int? = this[key]?.jsonPrimitive?.intOrNull

private fun JsonObject.need(key: String, table: String): String =
    str(key) ?: throw IllegalArgumentException("$table row without $key")

/**
 * The phone's copy of a lead this person works on (all leads for a manager). [localOnly] =
 * made on this phone and not yet confirmed by the server; [pending] = changed here, waiting to send.
 */
@Entity(
    tableName = "leads",
    indices = [Index(value = ["stage"]), Index(value = ["next_followup_at"]), Index(value = ["phone_last10"])],
)
data class LeadEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "sl_no") val slNo: Long?,
    val name: String,
    @ColumnInfo(name = "phone_e164") val phoneE164: String,
    @ColumnInfo(name = "phone_last10") val phoneLast10: String,
    @ColumnInfo(name = "alt_phone_e164") val altPhoneE164: String?,
    val email: String?,
    @ColumnInfo(name = "treatment_text") val treatmentText: String?,
    @ColumnInfo(name = "source_id") val sourceId: String?,
    val stage: String,
    @ColumnInfo(name = "lead_date") val leadDate: String?,
    @ColumnInfo(name = "next_followup_at") val nextFollowupAt: Long?,
    @ColumnInfo(name = "amount_quoted_paise") val amountQuotedPaise: Long?,
    @ColumnInfo(name = "amount_finalised_paise") val amountFinalisedPaise: Long?,
    val comments1: String?,
    val comments2: String?,
    @ColumnInfo(name = "assigned_to") val assignedTo: String?,
    @ColumnInfo(name = "patient_id") val patientId: String?,
    @ColumnInfo(name = "lost_reason_id") val lostReasonId: String?,
    @ColumnInfo(name = "last_activity_at") val lastActivityAt: Long,
    @ColumnInfo(name = "updated_at") val updatedAt: String,
    @ColumnInfo(name = "local_only") val localOnly: Boolean = false,
    val pending: Boolean = false,
) {
    companion object {
        fun fromRow(row: JsonObject): LeadEntity {
            val phone = row.need("phone_e164", "leads")
            return LeadEntity(
                id = row.need("id", "leads"),
                slNo = row.long("sl_no"),
                name = row.str("name").orEmpty(),
                phoneE164 = phone,
                phoneLast10 = phone.takeLast(10),
                altPhoneE164 = row.str("alt_phone_e164"),
                email = row.str("email"),
                treatmentText = row.str("treatment_text"),
                sourceId = row.str("source_id"),
                stage = row.str("stage") ?: "new",
                leadDate = row.str("lead_date"),
                nextFollowupAt = isoMs(row.str("next_followup_at")),
                amountQuotedPaise = row.long("amount_quoted_paise"),
                amountFinalisedPaise = row.long("amount_finalised_paise"),
                comments1 = row.str("comments1"),
                comments2 = row.str("comments2"),
                assignedTo = row.str("assigned_to"),
                patientId = row.str("patient_id"),
                lostReasonId = row.str("lost_reason_id"),
                lastActivityAt = isoMs(row.str("last_activity_at")) ?: isoMs(row.str("created_at")) ?: 0L,
                updatedAt = row.str("updated_at").orEmpty(),
            )
        }
    }
}

/** An open or closed task: call this lead back, confirm a booking, … (`public.followups`). */
@Entity(
    tableName = "followups",
    indices = [Index(value = ["status", "due_date"]), Index(value = ["lead_id"])],
)
data class FollowupEntity(
    @PrimaryKey val id: String,
    val kind: String,
    @ColumnInfo(name = "lead_id") val leadId: String?,
    @ColumnInfo(name = "patient_id") val patientId: String?,
    /** IST day, yyyy-MM-dd. */
    @ColumnInfo(name = "due_date") val dueDate: String,
    @ColumnInfo(name = "due_at") val dueAt: Long?,
    val reason: String,
    val status: String,
    val outcome: String?,
    @ColumnInfo(name = "assigned_to") val assignedTo: String?,
    @ColumnInfo(name = "updated_at") val updatedAt: String,
    val pending: Boolean = false,
) {
    companion object {
        fun fromRow(row: JsonObject) = FollowupEntity(
            id = row.need("id", "followups"),
            kind = row.str("kind") ?: "followup",
            leadId = row.str("lead_id"),
            patientId = row.str("patient_id"),
            dueDate = row.str("due_date") ?: LocalDate.now().toString(),
            dueAt = isoMs(row.str("due_at")),
            reason = row.str("reason").orEmpty(),
            status = row.str("status") ?: "open",
            outcome = row.str("outcome"),
            assignedTo = row.str("assigned_to"),
            updatedAt = row.str("updated_at").orEmpty(),
        )
    }
}

/** A booking for one of this person's leads (or booked by them), last 60 days and later. */
@Entity(
    tableName = "appointments",
    indices = [Index(value = ["lead_id"]), Index(value = ["status", "slot_start"])],
)
data class AppointmentEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "lead_id") val leadId: String?,
    @ColumnInfo(name = "patient_id") val patientId: String?,
    @ColumnInfo(name = "doctor_id") val doctorId: String?,
    val doctor: String?,
    @ColumnInfo(name = "appt_date") val apptDate: String,
    @ColumnInfo(name = "slot_start") val slotStart: Long?,
    val status: String,
    val mode: String?,
    val version: Int,
    @ColumnInfo(name = "updated_at") val updatedAt: String,
    val pending: Boolean = false,
) {
    companion object {
        fun fromRow(row: JsonObject) = AppointmentEntity(
            id = row.need("id", "appointments"),
            leadId = row.str("lead_id"),
            patientId = row.str("patient_id"),
            doctorId = row.str("doctor_id"),
            doctor = row.str("doctor"),
            apptDate = row.str("appt_date").orEmpty(),
            slotStart = isoMs(row.str("slot_start")),
            status = row.str("status") ?: "pending_confirmation",
            mode = row.str("mode"),
            version = row.int("version") ?: 1,
            updatedAt = row.str("updated_at").orEmpty(),
        )
    }
}

/** A call this person made or got (last 60 days). The id is made on the phone (`client_id`). */
@Entity(
    tableName = "call_logs",
    indices = [Index(value = ["lead_id", "started_at"]), Index(value = ["started_at"])],
)
data class CallLogEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "lead_id") val leadId: String?,
    @ColumnInfo(name = "phone_e164") val phoneE164: String?,
    val direction: String,
    @ColumnInfo(name = "started_at") val startedAt: Long,
    @ColumnInfo(name = "duration_s") val durationS: Int,
    val outcome: String?,
    val notes: String?,
    @ColumnInfo(name = "updated_at") val updatedAt: String,
    val pending: Boolean = false,
    /** The phone's own call log id for this call (imports and notes for the same call meet on it). */
    @ColumnInfo(name = "device_call_key") val deviceCallKey: String? = null,
) {
    companion object {
        fun fromRow(row: JsonObject) = CallLogEntity(
            id = row.need("id", "call_logs"),
            leadId = row.str("lead_id"),
            phoneE164 = row.str("phone_e164"),
            direction = row.str("direction") ?: "outgoing",
            startedAt = isoMs(row.str("started_at")) ?: 0L,
            durationS = row.int("duration_s") ?: 0,
            outcome = row.str("outcome"),
            notes = row.str("notes"),
            updatedAt = row.str("updated_at").orEmpty(),
            deviceCallKey = row.str("device_call_key"),
        )
    }
}
