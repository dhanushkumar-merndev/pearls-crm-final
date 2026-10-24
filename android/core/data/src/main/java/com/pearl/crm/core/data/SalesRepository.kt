package com.pearl.crm.core.data

import androidx.room.withTransaction
import com.pearl.crm.core.data.db.AppDatabase
import com.pearl.crm.core.data.db.AppointmentEntity
import com.pearl.crm.core.data.db.CallLogEntity
import com.pearl.crm.core.data.db.LeadEntity
import com.pearl.crm.core.data.net.PearlJson
import com.pearl.crm.core.model.CallDirection
import com.pearl.crm.core.model.CallOutcome
import com.pearl.crm.core.model.FreeSlot
import com.pearl.crm.core.model.LeadStage
import com.pearl.crm.core.model.Phones
import com.pearl.crm.core.model.RpcFailure
import com.pearl.crm.core.model.RpcTransport
import com.pearl.crm.core.model.SalesDashboard
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import java.time.Instant
import java.time.LocalDate

/** What happens to the lead's follow-up after a call. */
sealed interface NextStep {
    /** This call was the follow-up: close the one that was due (leave later ones). */
    data object CloseDue : NextStep

    /** No more follow-ups for this lead. */
    data object NoMore : NextStep

    /** Call again at [atMs]. */
    data class CallAgain(val atMs: Long) : NextStep
}

/** The after-call notes sheet, ready to save. */
data class CallDraft(
    val leadId: String?,
    val phoneE164: String?,
    val outcome: String,
    val notes: String?,
    val next: NextStep,
    val direction: String = CallDirection.OUTGOING,
    val startedAt: Long,
    val durationS: Int = 0,
    /** A new stage chosen in the sheet (null = leave it). */
    val stage: String? = null,
    val lostReasonId: String? = null,
)

/** The "new lead" form, ready to save. [phone] is what was typed; it is normalised here. */
data class LeadDraft(
    val name: String,
    val phone: String,
    val treatment: String?,
    val sourceId: String?,
    val comments: String?,
)

/** Leads list filter chips. */
enum class LeadFilter { Due, All, New, Interested, Booked }

/**
 * The sales screens' data. Everything a salesperson does on the phone is saved here first and
 * queued for the server (works with no signal); free slots, booking and the dashboard need
 * the connection because the server decides them.
 */
class SalesRepository(
    private val rpc: RpcTransport,
    private val db: AppDatabase,
    private val outbox: OutboxWriter,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val leads = db.leads()
    private val followups = db.followups()
    private val appointments = db.appointments()
    private val calls = db.callLogs()

    fun observeLeads(filter: LeadFilter, query: String, limit: Int = 200): Flow<List<LeadEntity>> {
        val now = clock()
        val stages = when (filter) {
            LeadFilter.New -> listOf(LeadStage.NEW, LeadStage.NOT_REACHABLE)
            LeadFilter.Interested -> listOf(LeadStage.CONTACTED, LeadStage.INTERESTED)
            LeadFilter.Booked -> listOf(LeadStage.CONSULTATION_BOOKED, LeadStage.CONSULTED, LeadStage.SURGERY_SCHEDULED)
            LeadFilter.Due, LeadFilter.All -> emptyList()
        }
        val dueBy = if (filter == LeadFilter.Due) now else null
        // "98450 12345" finds +919845012345: a typed number is searched by its digits.
        val text = query.trim().let { q -> if (q.isNotEmpty() && q.all { it.isDigit() || it in " +-()" }) q.filter(Char::isDigit) else q }
        return leads.observeList(stages.isEmpty(), stages, dueBy, escapeLike(text), now, limit)
    }

    fun observeLead(id: String) = leads.observe(id)

    fun observeLeadFollowups(leadId: String) = followups.observeForLead(leadId)

    fun observeLeadAppointments(leadId: String) = appointments.observeForLead(leadId)

    fun observeLeadCalls(leadId: String) = calls.observeForLead(leadId)

    fun observeRecentCalls(limit: Int = 100) = calls.observeRecentWithLead(limit)

    /** Open tasks up to [lastDay] (yyyy-MM-dd, IST), oldest first. */
    fun observeOpenFollowups(staffId: String, lastDay: String) = followups.observeOpenWithLead(staffId, lastDay)

    fun observeNeedsConfirmation() = appointments.observeNeedsConfirmationWithLead(clock())

    fun observeDueCount() = leads.observeDueCount(clock())

    /** A lead already on this phone with that number (either number), for the duplicate warning. */
    suspend fun findByPhone(phone: String): LeadEntity? =
        Phones.normalize(phone)?.let { leads.byPhone(it.last10) }

    /** Saves the call and its notes on the phone and queues `log_call`. Returns the call id. */
    suspend fun logCall(draft: CallDraft): String {
        require(draft.outcome in CallOutcome.ALL) { "unknown outcome" }
        require(draft.stage != LeadStage.LOST || draft.lostReasonId != null) { "lost needs a reason" }
        val id = newClientId()
        val now = clock()
        val notes = draft.notes?.trim()?.takeIf { it.isNotEmpty() }?.take(MAX_NOTES)
        val args = buildJsonObject {
            put(
                "p_call",
                buildJsonObject {
                    put("client_id", id)
                    put("lead_id", draft.leadId)
                    put("phone", draft.phoneE164)
                    put("direction", draft.direction)
                    put("started_at", iso(draft.startedAt))
                    put("duration_s", draft.durationS)
                    put("outcome", draft.outcome)
                    put("notes", notes)
                    when (val next = draft.next) {
                        NextStep.CloseDue -> Unit
                        NextStep.NoMore -> put("next_followup_at", JsonNull)
                        is NextStep.CallAgain -> put("next_followup_at", iso(next.atMs))
                    }
                    draft.stage?.let { put("stage", it) }
                    draft.lostReasonId?.let { put("lost_reason_id", it) }
                },
            )
        }
        db.withTransaction {
            calls.upsert(
                listOf(
                    CallLogEntity(
                        id = id, leadId = draft.leadId, phoneE164 = draft.phoneE164, direction = draft.direction,
                        startedAt = draft.startedAt, durationS = draft.durationS, outcome = draft.outcome, notes = notes,
                        updatedAt = "", pending = true,
                    ),
                ),
            )
            val lead = draft.leadId?.let { leads.get(it) }
            if (lead != null) {
                leads.touch(lead.id, now)
                val stage = draft.stage
                    ?: if (draft.outcome == CallOutcome.CONNECTED && lead.stage in LeadStage.BEFORE_CONTACT) LeadStage.CONTACTED else null
                if (stage != null) leads.setStage(lead.id, stage, draft.lostReasonId.takeIf { stage == LeadStage.LOST }, now)
                when (val next = draft.next) {
                    NextStep.CloseDue -> {
                        followups.closeDueForLead(lead.id, draft.outcome, now)
                        if (lead.nextFollowupAt != null && lead.nextFollowupAt <= now) leads.setNextFollowup(lead.id, null, now)
                    }
                    NextStep.NoMore -> leads.setNextFollowup(lead.id, null, now)
                    is NextStep.CallAgain -> leads.setNextFollowup(lead.id, next.atMs, now)
                }
                if (stage in LeadStage.CLOSED) leads.setNextFollowup(lead.id, null, now)
            }
            outbox.enqueue("log_call", args, entityKey(draft.leadId, "call", id), clientId = id)
        }
        return id
    }

    suspend fun addNote(leadId: String, body: String): String {
        val text = body.trim().take(MAX_NOTES)
        require(text.isNotEmpty()) { "empty note" }
        val id = newClientId()
        db.withTransaction {
            leads.touch(leadId, clock())
            outbox.enqueue(
                "add_lead_note",
                buildJsonObject {
                    put("p_id", leadId)
                    put("p_body", text)
                    put("p_client_id", id)
                },
                "lead:$leadId",
                clientId = id,
            )
        }
        return id
    }

    suspend fun setStage(leadId: String, stage: String, lostReasonId: String?, note: String? = null) {
        require(stage in LeadStage.ALL) { "unknown stage" }
        require(stage != LeadStage.LOST || lostReasonId != null) { "lost needs a reason" }
        val now = clock()
        db.withTransaction {
            leads.setStage(leadId, stage, lostReasonId.takeIf { stage == LeadStage.LOST }, now)
            if (stage in LeadStage.CLOSED) leads.setNextFollowup(leadId, null, now)
            outbox.enqueue(
                "set_lead_stage",
                buildJsonObject {
                    put("p_id", leadId)
                    put("p_stage", stage)
                    put("p_lost_reason_id", lostReasonId.takeIf { stage == LeadStage.LOST })
                    put("p_note", note?.trim()?.takeIf { it.isNotEmpty() })
                },
                "lead:$leadId",
            )
        }
    }

    /** "Done" on a task (or [cancel] it). */
    suspend fun completeFollowup(id: String, outcome: String?, cancel: Boolean = false) {
        val task = followups.get(id) ?: return
        val now = clock()
        db.withTransaction {
            followups.close(id, if (cancel) "cancelled" else "done", outcome)
            val leadId = task.leadId
            if (leadId != null) {
                val lead = leads.get(leadId)
                if (lead != null && task.dueAt != null && lead.nextFollowupAt == task.dueAt) leads.setNextFollowup(leadId, null, now)
            }
            outbox.enqueue(
                "complete_followup",
                buildJsonObject {
                    put("p_id", id)
                    put("p_outcome", outcome?.trim()?.takeIf { it.isNotEmpty() })
                    put("p_cancel", cancel)
                },
                entityKey(leadId, "followup", id),
            )
        }
    }

    /**
     * Saves a new lead on the phone (shown at once, marked "not sent yet") and queues
     * `create_lead`. The phone has already warned about duplicates, so the server is told to
     * save it anyway (it links the new lead to the older one). Returns the new lead's id.
     */
    suspend fun createLead(draft: LeadDraft): String {
        val phone = Phones.normalize(draft.phone) ?: throw RpcFailure.Permanent("invalid_input", "phone")
        val name = draft.name.trim()
        require(name.isNotEmpty()) { "empty name" }
        val id = newClientId()
        val now = clock()
        val treatment = draft.treatment?.trim()?.takeIf { it.isNotEmpty() }
        val comments = draft.comments?.trim()?.takeIf { it.isNotEmpty() }
        db.withTransaction {
            leads.upsert(
                listOf(
                    LeadEntity(
                        id = id, slNo = null, name = name, phoneE164 = phone.e164, phoneLast10 = phone.last10,
                        altPhoneE164 = null, email = null, treatmentText = treatment, sourceId = draft.sourceId,
                        stage = LeadStage.NEW, leadDate = null, nextFollowupAt = now, amountQuotedPaise = null,
                        amountFinalisedPaise = null, comments1 = comments, comments2 = null, assignedTo = null,
                        patientId = null, lostReasonId = null, lastActivityAt = now, updatedAt = "",
                        localOnly = true, pending = true,
                    ),
                ),
            )
            outbox.enqueue(
                "create_lead",
                buildJsonObject {
                    put(
                        "p_lead",
                        buildJsonObject {
                            put("name", name)
                            put("phone", phone.e164)
                            put("treatment_text", treatment)
                            put("source_id", draft.sourceId)
                            put("comments1", comments)
                            put("force", true)
                            put("via", "android")
                        },
                    )
                    put("p_client_id", id)
                },
                "lead:$id",
                clientId = id,
            )
        }
        return id
    }

    /** The patient said yes on the phone: mark the booking confirmed. */
    suspend fun confirmAppointment(id: String) {
        db.withTransaction {
            appointments.setStatus(id, "confirmed")
            outbox.enqueue(
                "set_appointment_status",
                buildJsonObject {
                    put("p_id", id)
                    put("p_status", "confirmed")
                },
                "appointment:$id",
            )
        }
    }

    /** Online only. */
    suspend fun freeSlots(doctorId: String, date: LocalDate): List<FreeSlot> {
        val result = rpc.call(
            "get_free_slots",
            buildJsonObject {
                put("p_doctor_id", doctorId)
                put("p_date", date.toString())
            },
        )
        return PearlJson.decodeFromJsonElement(ListSerializer(FreeSlot.serializer()), result)
    }

    /**
     * Online only: the server checks the slot is still free. [clientId] stays the same while
     * the person retries one booking, so a lost answer never books twice.
     */
    suspend fun book(
        clientId: String,
        leadId: String,
        doctorId: String,
        doctorName: String?,
        slot: FreeSlot,
        online: Boolean,
        confirmed: Boolean,
    ): AppointmentEntity {
        val result = rpc.call(
            "book_appointment",
            buildJsonObject {
                put(
                    "p_booking",
                    buildJsonObject {
                        put("lead_id", leadId)
                        put("doctor_id", doctorId)
                        put("slot_start", slot.start)
                        put("mode", if (online) "online" else "offline")
                        put("confirm", confirmed)
                        put("booked_from", "android")
                    },
                )
                put("p_client_id", clientId)
            },
        )
        val row = AppointmentEntity.fromRow(result.jsonObject).copy(doctor = doctorName)
        db.withTransaction {
            appointments.upsert(listOf(row))
            leads.get(leadId)?.let { lead ->
                if (lead.stage in BEFORE_BOOKED) leads.setStage(leadId, LeadStage.CONSULTATION_BOOKED, null, clock())
            }
        }
        return row
    }

    /** Online only. */
    suspend fun dashboard(): SalesDashboard =
        PearlJson.decodeFromJsonElement(SalesDashboard.serializer(), rpc.call("dashboard_sales_exec", JsonObject(emptyMap())))

    /** After a pull: drop phone-made rows the server took but didn't send back to us. */
    suspend fun tidyAfterPull() {
        leads.dropSentLocalOnly()
        calls.dropSentPending()
    }

    companion object {
        /** Same limit as the web call notes. */
        const val MAX_NOTES = 2000

        private val BEFORE_BOOKED = setOf(LeadStage.NEW, LeadStage.NOT_REACHABLE, LeadStage.CONTACTED, LeadStage.INTERESTED)

        private fun iso(ms: Long): String = Instant.ofEpochMilli(ms).toString()

        private fun entityKey(leadId: String?, kind: String, id: String) = if (leadId != null) "lead:$leadId" else "$kind:$id"

        private fun escapeLike(text: String): String =
            text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    }
}
