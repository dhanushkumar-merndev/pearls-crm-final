package com.pearl.crm.feature.sales

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.EventAvailable
import androidx.compose.material.icons.outlined.EventBusy
import androidx.compose.material.icons.outlined.EventRepeat
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pearl.crm.core.data.SalesRepository
import com.pearl.crm.core.data.db.AppointmentEntity
import com.pearl.crm.core.data.db.AppointmentWithLead
import com.pearl.crm.core.model.IstDates
import com.pearl.crm.core.model.LibrarySource
import com.pearl.crm.core.ui.components.EmptyState
import com.pearl.crm.core.ui.components.ListPageSize
import com.pearl.crm.core.ui.components.LoadingBlock
import com.pearl.crm.core.ui.components.PageControls
import com.pearl.crm.core.ui.components.PearlCard
import com.pearl.crm.core.ui.components.PearlLazyColumn
import com.pearl.crm.core.ui.components.PearlRefreshBox
import com.pearl.crm.core.ui.components.StatusLabel
import com.pearl.crm.core.ui.components.StatusTone
import com.pearl.crm.core.ui.theme.Pearl
import com.pearl.crm.core.ui.theme.Spacing
import java.time.LocalDate
import kotlinx.coroutines.launch

/** The three lists, same as the website's Bookings page. */
private val SCOPES = listOf("upcoming" to R.string.bookings_upcoming, "confirm" to R.string.bookings_confirm, "past" to R.string.bookings_past)

/** A booking that can still be confirmed, moved or cancelled. */
private val OPEN = setOf("pending_confirmation", "confirmed", AppointmentEntity.AUTO_CANCELLED)

@Composable
private fun statusTone(status: String): StatusTone = when (status) {
    "confirmed", "arrived", "with_doctor", "done" -> StatusTone.Good
    "pending_confirmation", AppointmentEntity.AUTO_CANCELLED -> StatusTone.Warning
    "cancelled", "no_show" -> StatusTone.Critical
    else -> StatusTone.Info
}

/**
 * Bookings of my leads in one list (owner, 20/11/2026: "booking or appointment, where to see?"):
 * Upcoming / To confirm / Past, by day. From the phone's copy, so it works offline; the changes
 * (confirm, cancel) are queued like everywhere else, Reschedule needs the internet.
 */
@Composable
fun BookingsScreen(
    sales: SalesRepository,
    library: LibrarySource,
    onOpenLead: (String) -> Unit,
    onReschedule: (String, String) -> Unit,
    onRefresh: suspend () -> Unit = {},
) {
    val context = LocalContext.current
    val today = remember { istToday() }
    var scope by rememberSaveable { mutableStateOf("upcoming") }
    var page by rememberSaveable(scope) { mutableIntStateOf(0) }
    val listState = key(scope, page) { rememberLazyListState() }
    val rows by key(scope, page) {
        remember { sales.observeBookings(scope, today.toString(), ListPageSize + 1, page * ListPageSize) }
            .collectAsStateWithLifecycle(null, minActiveState = Lifecycle.State.RESUMED)
    }
    LaunchedEffect(rows, page) { if (rows?.isEmpty() == true && page > 0) page-- }
    val calls = rememberCallFlow(context)
    val scope2 = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var cancelling by rememberSaveable { mutableStateOf<String?>(null) }
    val confirmedText = stringResource(R.string.booking_confirmed)
    val cancelledText = stringResource(R.string.booking_cancelled)
    val list = rows?.take(ListPageSize)

    Scaffold(contentWindowInsets = WindowInsets(0), snackbarHost = { SnackbarHost(snackbar) }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            ScreenTitle(stringResource(R.string.bookings_title))
            Row(
                Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = Spacing.screen),
                horizontalArrangement = Arrangement.spacedBy(Spacing.s),
            ) {
                SCOPES.forEach { (s, label) ->
                    FilterChip(selected = scope == s, onClick = { scope = s }, label = { Text(stringResource(label)) }, modifier = Modifier.testTag("bookings-$s"))
                }
            }
            PearlRefreshBox(onRefresh = onRefresh, modifier = Modifier.weight(1f)) {
                PearlLazyColumn(
                    Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(start = Spacing.screen, end = Spacing.screen, top = Spacing.s, bottom = Spacing.xl),
                    verticalArrangement = Arrangement.spacedBy(Spacing.item),
                    state = if (list == null) rememberLazyListState() else listState,
                ) { emptyModifier ->
                    when {
                        list == null -> item(key = "loading") { LoadingBlock(rows = 4, rowHeight = 64.dp) }
                        list.isEmpty() -> item(key = "empty") {
                            EmptyState(
                                Icons.Outlined.EventAvailable,
                                stringResource(
                                    when (scope) {
                                        "confirm" -> R.string.bookings_none_confirm
                                        "past" -> R.string.bookings_none_past
                                        else -> R.string.bookings_none_upcoming
                                    },
                                ),
                                emptyModifier,
                            )
                        }
                        else -> list.groupBy { it.appointment.apptDate }.forEach { (day, dayRows) ->
                            item(key = "d$day") {
                                Text(
                                    dayHeading(day, today),
                                    style = MaterialTheme.typography.titleSmall,
                                    color = Pearl.palette.textSecondary,
                                    modifier = Modifier.padding(top = Spacing.s).semantics { heading() },
                                )
                            }
                            items(dayRows, key = { it.appointment.id }) { row ->
                                BookingRow(
                                    row,
                                    past = scope == "past",
                                    onOpen = { row.appointment.leadId?.let(onOpenLead) },
                                    onCall = row.leadPhone?.let { phone -> { row.appointment.leadId?.let { calls.call(it, phone) } } },
                                    onConfirm = {
                                        scope2.launch {
                                            sales.confirmAppointment(row.appointment.id)
                                            snackbar.showSnackbar(confirmedText)
                                        }
                                    },
                                    onReschedule = { row.appointment.leadId?.let { onReschedule(it, row.appointment.id) } },
                                    onCancel = { cancelling = row.appointment.id },
                                )
                            }
                        }
                    }
                    if (rows != null) item(key = "pagination") {
                        PageControls(page, rows!!.size > ListPageSize, { page-- }, { page++ })
                    }
                }
            }
        }
    }
    cancelling?.let { id ->
        CancelBookingDialog(onDismiss = { cancelling = null }, onCancel = { reason ->
            cancelling = null
            scope2.launch {
                sales.cancelAppointment(id, reason)
                snackbar.showSnackbar(cancelledText)
            }
        })
    }
    calls.needsNotes?.let { call ->
        val name = rows?.firstOrNull { it.appointment.leadId == call.leadId }?.leadName ?: call.phone
        AfterCallNotes(sales, library, call, name, onDone = { calls.needsNotes = null }, awayMs = calls.awayMs)
    }
}

/** "Today", "Tomorrow", "Mon 23/11", or a full date for other years. */
@Composable
private fun dayHeading(day: String, today: LocalDate): String {
    val d = runCatching { LocalDate.parse(day) }.getOrNull() ?: return day
    return when (d) {
        today -> stringResource(R.string.book_today)
        today.plusDays(1) -> stringResource(R.string.book_tomorrow)
        today.minusDays(1) -> stringResource(R.string.bookings_yesterday)
        else -> if (d.year == today.year) bookDayLabel(d) else "%02d/%02d/%04d".format(d.dayOfMonth, d.monthValue, d.year)
    }
}

@Composable
private fun BookingRow(
    row: AppointmentWithLead,
    past: Boolean,
    onOpen: () -> Unit,
    onCall: (() -> Unit)?,
    onConfirm: () -> Unit,
    onReschedule: () -> Unit,
    onCancel: () -> Unit,
) {
    val a = row.appointment
    var menu by remember { mutableStateOf(false) }
    val open = !past && a.status in OPEN
    PearlCard(
        onClick = onOpen,
        modifier = Modifier.testTag("booking-${a.id}"),
        contentPadding = PaddingValues(start = Spacing.l, top = Spacing.m, bottom = Spacing.m, end = Spacing.xs),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(row.leadName ?: "—", style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    listOfNotNull(a.slotStart?.let(IstDates::formatTime), a.doctor).joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall,
                    color = Pearl.palette.textSecondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                StatusLabel(apptStatusLabel(a.status), statusTone(a.status))
                if (a.pending) StatusLabel(stringResource(R.string.not_sent_yet), StatusTone.Info)
            }
            if (onCall != null) {
                IconButton(onClick = onCall, modifier = Modifier.testTag("booking-call-${a.id}")) {
                    Icon(Icons.Outlined.Call, stringResource(R.string.call), tint = Pearl.palette.textSecondary)
                }
            }
            if (open) {
                Box {
                    IconButton(onClick = { menu = true }, modifier = Modifier.testTag("booking-menu-${a.id}")) {
                        Icon(Icons.Outlined.MoreVert, stringResource(R.string.bookings_actions_for, row.leadName ?: ""), tint = Pearl.palette.textSecondary)
                    }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        if (a.status != "confirmed") {
                            DropdownMenuItem(
                                text = { Text(stringResource(if (a.status == AppointmentEntity.AUTO_CANCELLED) R.string.myday_restore else R.string.booking_confirm)) },
                                leadingIcon = { Icon(Icons.Outlined.Check, null) },
                                onClick = {
                                    menu = false
                                    onConfirm()
                                },
                                modifier = Modifier.testTag("booking-menu-confirm"),
                            )
                        }
                        if (a.doctorId != null) {
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.booking_reschedule)) },
                                leadingIcon = { Icon(Icons.Outlined.EventRepeat, null) },
                                onClick = {
                                    menu = false
                                    onReschedule()
                                },
                                modifier = Modifier.testTag("booking-menu-reschedule"),
                            )
                        }
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.booking_cancel)) },
                            leadingIcon = { Icon(Icons.Outlined.EventBusy, null) },
                            onClick = {
                                menu = false
                                onCancel()
                            },
                            modifier = Modifier.testTag("booking-menu-cancel"),
                        )
                    }
                }
            }
        }
    }
}
