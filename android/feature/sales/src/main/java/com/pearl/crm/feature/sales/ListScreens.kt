package com.pearl.crm.feature.sales

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.PhoneDisabled
import androidx.compose.material.icons.outlined.TaskAlt
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pearl.crm.core.data.SalesRepository
import com.pearl.crm.core.data.db.FollowupWithLead
import com.pearl.crm.core.model.CallDirection
import com.pearl.crm.core.model.IstDates
import com.pearl.crm.core.model.LibrarySource
import com.pearl.crm.core.ui.components.ButtonKind
import com.pearl.crm.core.ui.components.EmptyState
import com.pearl.crm.core.ui.components.IconSize
import com.pearl.crm.core.ui.components.LoadingBlock
import com.pearl.crm.core.ui.components.PearlButton
import com.pearl.crm.core.ui.components.PearlCard
import com.pearl.crm.core.ui.components.PearlRefreshBox
import com.pearl.crm.core.ui.components.StatusLabel
import com.pearl.crm.core.ui.components.StatusTone
import com.pearl.crm.core.ui.theme.Pearl
import com.pearl.crm.core.ui.theme.Spacing
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Open tasks: overdue, today, next 7 days. "Done" hides the task and offers Undo for a few
 * seconds; only then is it closed (leaving the screen closes it straight away). Call rings the
 * lead. Pull down to sync.
 */
@Composable
fun FollowupsScreen(
    staffId: String,
    sales: SalesRepository,
    library: LibrarySource,
    onOpenLead: (String) -> Unit,
    onRefresh: suspend () -> Unit = {},
) {
    val context = LocalContext.current
    val today = remember { istToday() }
    val tasks by remember(staffId) { sales.observeOpenFollowups(staffId, today.plusDays(7).toString()) }
        .collectAsStateWithLifecycle(null)
    val calls = rememberCallFlow(context)
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    // Marked done, waiting out the Undo time.
    val hidden = remember { mutableStateListOf<String>() }
    val doneText = stringResource(R.string.followups_done_snack)
    val undoText = stringResource(R.string.followups_undo)
    val list = tasks?.filter { it.task.id !in hidden }

    fun done(id: String) {
        hidden += id
        scope.launch {
            var undone = false
            try {
                undone = snackbar.showSnackbar(doneText, actionLabel = undoText, duration = SnackbarDuration.Short) == SnackbarResult.ActionPerformed
            } catch (e: CancellationException) {
                // The screen went away during the Undo time: the task is still done.
                withContext(NonCancellable) { sales.completeFollowup(id, null) }
                throw e
            }
            if (undone) hidden -= id else withContext(NonCancellable) { sales.completeFollowup(id, null) }
        }
    }

    Scaffold(contentWindowInsets = WindowInsets(0), snackbarHost = { SnackbarHost(snackbar) }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            ScreenTitle(stringResource(R.string.followups_title))
            PearlRefreshBox(onRefresh = onRefresh, modifier = Modifier.weight(1f)) {
                LazyColumn(
                    Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(start = Spacing.screen, end = Spacing.screen, bottom = Spacing.screen),
                    verticalArrangement = Arrangement.spacedBy(Spacing.item),
                ) {
                    when {
                        list == null -> item(key = "loading") { LoadingBlock(rows = 4, rowHeight = 64.dp) }
                        list.isEmpty() -> item(key = "empty") {
                            EmptyState(Icons.Outlined.TaskAlt, stringResource(R.string.followups_empty), body = stringResource(R.string.followups_empty_body))
                        }
                        else -> {
                            val todayText = today.toString()
                            val groups = listOf(
                                R.string.followups_overdue to list.filter { it.task.dueDate < todayText },
                                R.string.followups_today to list.filter { it.task.dueDate == todayText },
                                R.string.followups_upcoming to list.filter { it.task.dueDate > todayText },
                            ).filter { it.second.isNotEmpty() }
                            groups.forEach { (title, rows) ->
                                item(key = "h$title") {
                                    Text(
                                        stringResource(title),
                                        style = MaterialTheme.typography.titleSmall,
                                        color = Pearl.palette.textSecondary,
                                        modifier = Modifier.padding(top = Spacing.s).semantics { heading() },
                                    )
                                }
                                items(rows, key = { it.task.id }) { row ->
                                    TaskRow(
                                        row,
                                        overdue = row.task.dueDate < todayText,
                                        onOpen = { row.task.leadId?.let(onOpenLead) },
                                        onCall = row.leadPhone?.let { phone -> { row.task.leadId?.let { calls.call(it, phone) } } },
                                        onDone = { done(row.task.id) },
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    calls.needsNotes?.let { call ->
        val name = tasks?.firstOrNull { it.task.leadId == call.leadId }?.leadName ?: call.phone
        AfterCallNotes(sales, library, call, name, onDone = { calls.needsNotes = null }, awayMs = calls.awayMs)
    }
}

/** A tab's title, same place and size on every list screen. */
@Composable
internal fun ScreenTitle(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.titleLarge,
        modifier = Modifier.padding(start = Spacing.screen, end = Spacing.screen, top = Spacing.screen, bottom = Spacing.s).semantics { heading() },
    )
}

@Composable
private fun TaskRow(row: FollowupWithLead, overdue: Boolean, onOpen: () -> Unit, onCall: (() -> Unit)?, onDone: () -> Unit) {
    val task = row.task
    PearlCard(
        onClick = onOpen,
        modifier = Modifier.testTag("task-${task.id}"),
        contentPadding = PaddingValues(start = Spacing.l, top = Spacing.m, bottom = Spacing.m, end = Spacing.s),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(row.leadName ?: task.reason, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    if (task.kind == "call_to_confirm") stringResource(R.string.followups_kind_call_to_confirm) else task.reason,
                    style = MaterialTheme.typography.bodySmall,
                    color = Pearl.palette.textSecondary,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    task.dueAt?.let(IstDates::formatDateTime) ?: task.dueDate.split('-').reversed().joinToString("/"),
                    style = MaterialTheme.typography.bodySmall,
                    color = if (overdue) Pearl.palette.badText else MaterialTheme.colorScheme.onSurface,
                )
            }
            if (onCall != null) {
                IconButton(onClick = onCall) { Icon(Icons.Outlined.Call, stringResource(R.string.call), Modifier.size(IconSize)) }
            }
            PearlButton(stringResource(R.string.followups_done), Icons.Outlined.Check, onDone, kind = ButtonKind.Tonal, small = true)
        }
    }
}

/** Calls made or received in the last 60 days, newest first, each with its direction. */
@Composable
fun CallsScreen(sales: SalesRepository, onOpenLead: (String) -> Unit, onRefresh: suspend () -> Unit = {}) {
    val calls by remember { sales.observeRecentCalls(200) }.collectAsStateWithLifecycle(null)
    Column(Modifier.fillMaxSize()) {
        ScreenTitle(stringResource(R.string.calls_title))
        PearlRefreshBox(onRefresh = onRefresh, modifier = Modifier.weight(1f)) {
            val list = calls
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = Spacing.screen, end = Spacing.screen, bottom = Spacing.screen),
                verticalArrangement = Arrangement.spacedBy(Spacing.item),
            ) {
                when {
                    list == null -> item(key = "loading") { LoadingBlock(rows = 4, rowHeight = 64.dp) }
                    list.isEmpty() -> item(key = "empty") { EmptyState(Icons.Outlined.PhoneDisabled, stringResource(R.string.calls_empty)) }
                    else -> items(list, key = { it.call.id }) { row ->
                        val c = row.call
                        val missed = c.direction == CallDirection.MISSED
                        PearlCard(onClick = c.leadId?.let { id -> { onOpenLead(id) } }, verticalSpacing = 2.dp) {
                            Text(row.leadName ?: c.phoneE164 ?: stringResource(R.string.calls_unknown), style = MaterialTheme.typography.titleSmall)
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                                Icon(
                                    callDirectionIcon(c.direction),
                                    contentDescription = null,
                                    tint = if (missed) Pearl.palette.badText else Pearl.palette.textSecondary,
                                    modifier = Modifier.size(16.dp),
                                )
                                Text(
                                    listOfNotNull(
                                        callDirectionLabel(c.direction),
                                        IstDates.formatDateTime(c.startedAt),
                                        c.outcome?.let { outcomeLabel(it) },
                                        when {
                                            missed || c.durationS <= 0 -> null
                                            c.durationS < 60 -> stringResource(R.string.calls_duration_s, c.durationS)
                                            else -> stringResource(R.string.calls_duration, c.durationS / 60, c.durationS % 60)
                                        },
                                    ).joinToString(" · "),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = if (missed) Pearl.palette.badText else Pearl.palette.textSecondary,
                                )
                            }
                            c.notes?.let { Text(it, style = MaterialTheme.typography.bodyMedium, maxLines = 3, overflow = TextOverflow.Ellipsis) }
                            if (c.pending) StatusLabel(stringResource(R.string.not_sent_yet), StatusTone.Info)
                        }
                    }
                }
            }
        }
    }
}
