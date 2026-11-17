package com.pearl.crm.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** `public.lead_stage`, in ladder order. */
object LeadStage {
    const val NEW = "new"
    const val CONTACTED = "contacted"
    const val INTERESTED = "interested"
    const val CONSULTATION_BOOKED = "consultation_booked"
    const val CONSULTED = "consulted"
    const val SURGERY_SCHEDULED = "surgery_scheduled"
    const val CONVERTED = "converted"
    const val LOST = "lost"
    const val NOT_REACHABLE = "not_reachable"
    const val JUNK = "junk"

    val ALL = listOf(NEW, CONTACTED, INTERESTED, CONSULTATION_BOOKED, CONSULTED, SURGERY_SCHEDULED, CONVERTED, LOST, NOT_REACHABLE, JUNK)

    /** Finished leads: no more follow-ups. */
    val CLOSED = setOf(CONVERTED, LOST, JUNK)

    /** Stages a connected call moves up to "contacted" (same as `log_call`). */
    val BEFORE_CONTACT = setOf(NEW, NOT_REACHABLE)
}

/** `public.call_outcome`. */
object CallOutcome {
    const val CONNECTED = "connected"
    const val NO_ANSWER = "no_answer"
    const val BUSY = "busy"
    const val SWITCHED_OFF = "switched_off"
    const val WRONG_NUMBER = "wrong_number"
    const val CALL_BACK = "call_back"

    val ALL = listOf(CONNECTED, NO_ANSWER, BUSY, SWITCHED_OFF, WRONG_NUMBER, CALL_BACK)
}

object CallDirection {
    const val OUTGOING = "outgoing"
    const val INCOMING = "incoming"
    const val MISSED = "missed"
}

/** One slot from `get_free_slots`. [start] is the server's timestamptz text, sent back as is. */
@Serializable
data class FreeSlot(
    val start: String,
    val end: String? = null,
    val capacity: Int = 1,
    val booked: Int = 0,
    val left: Int = 0,
    @SerialName("blocked_reason") val blockedReason: String? = null,
) {
    val bookable: Boolean get() = left > 0 && blockedReason == null
}

/** `dashboard_sales_exec()`: today's numbers, calls per day for the last 14 days, and this month's targets. */
@Serializable
data class SalesDashboard(
    val date: String? = null,
    val today: SalesToday = SalesToday(),
    @SerialName("calls_per_day") val callsPerDay: List<CallsOnDay> = emptyList(),
    /** Null when the clinic doesn't use targets (Admin → Settings → Sales). */
    val target: SalesTarget? = null,
)

/** One month's targets (Admin → Sales targets); a metric without a target has `target = null`. */
@Serializable
data class SalesTarget(
    val month: String? = null,
    val converted: TargetProgress = TargetProgress(),
    @SerialName("agreed_paise") val agreedPaise: TargetProgress = TargetProgress(),
    val calls: TargetProgress = TargetProgress(),
) {
    val hasAny: Boolean get() = listOf(converted, agreedPaise, calls).any { it.target != null }
}

@Serializable
data class TargetProgress(val target: Long? = null, val actual: Long = 0) {
    /** 0..1 for the meter (past the target stays full). */
    val fraction: Float get() = if (target == null || target <= 0) 0f else (actual.toFloat() / target).coerceIn(0f, 1f)
    val percent: Int get() = if (target == null || target <= 0) 0 else ((actual * 100) / target).toInt()
}

@Serializable
data class SalesToday(
    val calls: Int = 0,
    val connected: Int = 0,
    @SerialName("talk_s") val talkSeconds: Long = 0,
    @SerialName("followups_due") val followupsDue: Int = 0,
    @SerialName("followups_overdue") val followupsOverdue: Int = 0,
    val booked: Int = 0,
    @SerialName("pending_confirmations") val pendingConfirmations: Int = 0,
)

@Serializable
data class CallsOnDay(
    /** yyyy-MM-dd (IST). */
    val day: String,
    val calls: Int = 0,
    val connected: Int = 0,
)

/** The consultation in a lead's sheet row: the next upcoming booking, else the latest. */
@Serializable
data class SheetConsult(
    val at: String? = null,
    val date: String? = null,
    val status: String = "",
    val doctor: String? = null,
)

/** One of the first three calls (Follow-up 1, 2, 3). [at] is the server's timestamptz text. */
@Serializable
data class SheetCall(
    val at: String,
    val outcome: String? = null,
    val by: String? = null,
    val notes: String? = null,
)

/**
 * `lead_sheet_row(lead)`: the sales sheet's columns for one lead (16/11/2026 training): source,
 * sales team, doctor, consultation, quotation (quoted → final), surgery date, follow-up 1–3, remarks.
 */
@Serializable
data class LeadSheetRow(
    @SerialName("source_label") val sourceLabel: String? = null,
    @SerialName("assigned_name") val assignedName: String? = null,
    @SerialName("doctor_name") val doctorName: String? = null,
    @SerialName("amount_quoted_paise") val amountQuotedPaise: Long? = null,
    @SerialName("amount_finalised_paise") val amountFinalisedPaise: Long? = null,
    @SerialName("amount_locked") val amountLocked: Boolean = false,
    @SerialName("surgery_date") val surgeryDate: String? = null,
    val comments1: String? = null,
    val consult: SheetConsult? = null,
    val followups: List<SheetCall> = emptyList(),
    @SerialName("calls_total") val callsTotal: Int = 0,
) {
    /** "Quoted ₹60,000.00 → Final ₹55,000.00" parts; null when neither is set. */
    fun quotation(quoted: (String) -> String, final: (String) -> String): String? {
        if (amountQuotedPaise == null && amountFinalisedPaise == null) return null
        return listOfNotNull(
            amountQuotedPaise?.let { quoted(Money.formatInr(it)) },
            amountFinalisedPaise?.let { final(Money.formatInr(it)) },
        ).joinToString(" → ")
    }

    /** The consultation as one line: date and time (or the day), then the doctor. */
    fun consultText(): String? = consult?.let { c ->
        val whenText = c.at?.let(SheetTimes::ms)?.let(IstDates::formatDateTime)
            ?: c.date?.let { runCatching { java.time.LocalDate.parse(it) }.getOrNull() }?.let(IstDates::formatDay)
        listOfNotNull(whenText, c.doctor).joinToString(" · ").ifEmpty { null }
    }

    /** "DD/MM/YYYY" for the surgery date. */
    fun surgeryText(): String? = surgeryDate?.let { runCatching { java.time.LocalDate.parse(it) }.getOrNull() }?.let(IstDates::formatDay)
}

object SheetTimes {
    /** A Postgres timestamptz ("2026-11-17T04:30:00.12+00:00") → epoch ms. */
    fun ms(text: String): Long? = runCatching { java.time.OffsetDateTime.parse(text).toInstant().toEpochMilli() }.getOrNull()
}
