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
