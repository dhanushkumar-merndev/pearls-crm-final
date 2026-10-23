package com.pearl.crm.core.model

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Dates shown DD/MM/YYYY, 12-hour time, Asia/Kolkata — same as packages/shared/src/dates.ts. */
object IstDates {
    val ZONE: ZoneId = ZoneId.of("Asia/Kolkata")
    private val DATE = DateTimeFormatter.ofPattern("dd/MM/yyyy", Locale.ENGLISH).withZone(ZONE)
    private val TIME = DateTimeFormatter.ofPattern("h:mm a", Locale.ENGLISH).withZone(ZONE)

    fun formatDate(epochMs: Long): String = DATE.format(Instant.ofEpochMilli(epochMs))

    fun formatTime(epochMs: Long): String = TIME.format(Instant.ofEpochMilli(epochMs))

    fun formatDateTime(epochMs: Long): String = "${formatDate(epochMs)} ${formatTime(epochMs)}"
}
