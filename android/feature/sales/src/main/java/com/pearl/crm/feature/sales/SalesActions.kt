package com.pearl.crm.feature.sales

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.EventBusy
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import com.pearl.crm.core.model.IstDates
import com.pearl.crm.core.ui.components.ButtonKind
import com.pearl.crm.core.ui.components.FieldError
import com.pearl.crm.core.ui.components.Muted
import com.pearl.crm.core.ui.components.PearlButton
import com.pearl.crm.core.ui.components.Section
import com.pearl.crm.core.ui.theme.Spacing
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime

private const val NEXT_CALL_DAYS = 30

/** Times offered for a next call: 9:00 AM to 8:30 PM, every half hour. */
internal val NEXT_CALL_TIMES: List<LocalTime> = (18..41).map { LocalTime.of(it / 2, (it % 2) * 30) }

/** The time chips that can still be picked on [day] ([nowMs] past ones are left out today). */
internal fun nextCallTimes(day: LocalDate, today: LocalDate, nowMs: Long): List<LocalTime> =
    if (day != today) NEXT_CALL_TIMES else NEXT_CALL_TIMES.filter { day.atTime(it).atZone(IstDates.ZONE).toInstant().toEpochMilli() > nowMs }

private fun atMs(day: LocalDate, time: LocalTime) = day.atTime(time).atZone(IstDates.ZONE).toInstant().toEpochMilli()

/**
 * "Change time" for a lead's next call, without logging a call (owner, 20/11/2026). Day chips then
 * time chips (the app's own pickers, no system dialog). [onSave] gets the new time, or null for
 * "No next call" (only offered when there is one).
 */
@Composable
fun NextCallDialog(leadName: String, currentMs: Long?, onDismiss: () -> Unit, onSave: (Long?) -> Unit) {
    val today = remember { istToday() }
    val now = remember { System.currentTimeMillis() }
    val current = currentMs?.takeIf { it > now }?.let { Instant.ofEpochMilli(it).atZone(IstDates.ZONE) }
    var dayOffset by rememberSaveable {
        mutableIntStateOf(current?.toLocalDate()?.let { (it.toEpochDay() - today.toEpochDay()).toInt() } ?: 1)
    }
    var time by rememberSaveable { mutableStateOf(current?.toLocalTime()?.toString() ?: "11:00") }
    var error by remember { mutableStateOf<Int?>(null) }
    val day = today.plusDays(dayOffset.toLong())
    val times = nextCallTimes(day, today, now)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.next_call_title, leadName)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
                Muted(stringResource(R.string.next_call_hint))
                Section(stringResource(R.string.book_day)) {
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
                        (0 until NEXT_CALL_DAYS).forEach { offset ->
                            val d = today.plusDays(offset.toLong())
                            val label = when (offset) {
                                0 -> stringResource(R.string.book_today)
                                1 -> stringResource(R.string.book_tomorrow)
                                else -> bookDayLabel(d)
                            }
                            FilterChip(selected = dayOffset == offset, onClick = {
                                dayOffset = offset
                                error = null
                            }, label = { Text(label) })
                        }
                    }
                }
                Section(stringResource(R.string.next_call_time)) {
                    if (times.isEmpty()) {
                        Muted(stringResource(R.string.next_call_no_times))
                    } else {
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.s), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                            times.forEach { t ->
                                FilterChip(selected = time == t.toString(), onClick = {
                                    time = t.toString()
                                    error = null
                                }, label = { Text(IstDates.formatTime(atMs(day, t))) }, modifier = Modifier.testTag("next-call-$t"))
                            }
                        }
                    }
                }
                FieldError(error, "next-call-error")
            }
        },
        confirmButton = {
            PearlButton(stringResource(R.string.next_call_save), Icons.Outlined.Check, {
                val t = times.firstOrNull { it.toString() == time }
                if (t == null) error = R.string.next_call_pick_time else onSave(atMs(day, t))
            }, modifier = Modifier.testTag("next-call-save"))
        },
        dismissButton = {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                if (currentMs != null) {
                    PearlButton(stringResource(R.string.next_call_clear), Icons.Outlined.EventBusy, { onSave(null) }, kind = ButtonKind.Quiet)
                }
                PearlButton(stringResource(R.string.new_lead_cancel), Icons.Outlined.Close, onDismiss, kind = ButtonKind.Quiet)
            }
        },
    )
}

/** Cancel a booking: a reason is asked first (same as the website). */
@Composable
fun CancelBookingDialog(onDismiss: () -> Unit, onCancel: (String) -> Unit) {
    var reason by rememberSaveable { mutableStateOf("") }
    var error by remember { mutableStateOf<Int?>(null) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.booking_cancel_title)) },
        text = {
            OutlinedTextField(
                value = reason,
                onValueChange = {
                    reason = it.take(300)
                    error = null
                },
                label = { Text(stringResource(R.string.booking_cancel_reason)) },
                minLines = 2,
                isError = error != null,
                supportingText = error?.let { { Text(stringResource(it)) } },
                modifier = Modifier.fillMaxWidth().testTag("cancel-reason"),
            )
        },
        confirmButton = {
            PearlButton(stringResource(R.string.booking_cancel), Icons.Outlined.EventBusy, {
                when {
                    reason.isBlank() -> error = R.string.booking_cancel_reason_required
                    reason.trim().length < 3 -> error = R.string.booking_cancel_reason_short
                    else -> onCancel(reason.trim())
                }
            }, modifier = Modifier.testTag("cancel-booking-save"))
        },
        dismissButton = { PearlButton(stringResource(R.string.booking_keep), Icons.Outlined.Close, onDismiss, kind = ButtonKind.Quiet) },
    )
}

/** Rupees as typed ("1,500" / "1500.50") → paise; null when empty or not a number. */
fun rupeesToPaise(text: String): Long? {
    val t = text.replace(",", "").replace("₹", "").trim()
    if (t.isEmpty() || !Regex("^\\d{1,9}(\\.\\d{1,2})?$").matches(t)) return null
    val parts = t.split('.')
    return parts[0].toLong() * 100 + (parts.getOrNull(1)?.padEnd(2, '0')?.toLong() ?: 0)
}

/** Paise → "1500" or "1500.50" for a text field. */
fun paiseToRupeesText(paise: Long?): String =
    paise?.let { if (it % 100 == 0L) (it / 100).toString() else "%d.%02d".format(it / 100, it % 100) } ?: ""
