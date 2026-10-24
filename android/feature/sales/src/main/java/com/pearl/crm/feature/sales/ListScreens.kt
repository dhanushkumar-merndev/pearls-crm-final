package com.pearl.crm.feature.sales

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pearl.crm.core.data.SalesRepository
import com.pearl.crm.core.data.db.FollowupWithLead
import com.pearl.crm.core.model.IstDates
import com.pearl.crm.core.model.LibrarySource
import com.pearl.crm.core.ui.components.ButtonKind
import com.pearl.crm.core.ui.components.PearlButton
import com.pearl.crm.core.ui.theme.Pearl
import kotlinx.coroutines.launch

/** Open tasks: overdue, today, next 7 days. "Done" closes one; Call rings the lead. */
@Composable
fun FollowupsScreen(
    staffId: String,
    sales: SalesRepository,
    library: LibrarySource,
    onOpenLead: (String) -> Unit,
) {
    val context = LocalContext.current
    val today = remember { istToday() }
    val tasks by remember(staffId) { sales.observeOpenFollowups(staffId, today.plusDays(7).toString()) }
        .collectAsStateWithLifecycle(null)
    val calls = rememberCallFlow(context)
    val scope = rememberCoroutineScope()
    val list = tasks
    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(stringResource(R.string.followups_title), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 16.dp))
        if (list != null && list.isEmpty()) Muted(stringResource(R.string.followups_empty))
        if (list != null && list.isNotEmpty()) {
            val todayText = today.toString()
            val groups = listOf(
                R.string.followups_overdue to list.filter { it.task.dueDate < todayText },
                R.string.followups_today to list.filter { it.task.dueDate == todayText },
                R.string.followups_upcoming to list.filter { it.task.dueDate > todayText },
            ).filter { it.second.isNotEmpty() }
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.weight(1f)) {
                groups.forEach { (title, rows) ->
                    item(key = "h$title") {
                        Text(stringResource(title), style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp))
                    }
                    items(rows, key = { it.task.id }) { row ->
                        TaskRow(
                            row,
                            onOpen = { row.task.leadId?.let(onOpenLead) },
                            onCall = row.leadPhone?.let { phone -> { row.task.leadId?.let { calls.call(it, phone) } } },
                            onDone = { scope.launch { sales.completeFollowup(row.task.id, null) } },
                        )
                    }
                }
            }
        }
    }
    calls.needsNotes?.let { call ->
        val name = list?.firstOrNull { it.task.leadId == call.leadId }?.leadName ?: call.phone
        AfterCallNotes(sales, library, call, name, onDone = { calls.needsNotes = null }, awayMs = calls.awayMs)
    }
}

@Composable
private fun TaskRow(row: FollowupWithLead, onOpen: () -> Unit, onCall: (() -> Unit)?, onDone: () -> Unit) {
    val task = row.task
    Surface(shape = MaterialTheme.shapes.medium, tonalElevation = 1.dp, modifier = Modifier.fillMaxWidth().clickable(onClick = onOpen)) {
        Row(Modifier.padding(start = 16.dp, top = 12.dp, bottom = 12.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(row.leadName ?: task.reason, style = MaterialTheme.typography.titleMedium)
                Text(
                    if (task.kind == "call_to_confirm") stringResource(R.string.followups_kind_call_to_confirm) else task.reason,
                    color = Pearl.palette.textSecondary,
                )
                Text(task.dueAt?.let(IstDates::formatDateTime) ?: task.dueDate.split('-').reversed().joinToString("/"))
            }
            if (onCall != null) {
                IconButton(onClick = onCall) { Icon(Icons.Outlined.Call, stringResource(R.string.call)) }
            }
            PearlButton(stringResource(R.string.followups_done), Icons.Outlined.Check, onDone, kind = ButtonKind.Secondary)
        }
    }
}

/** Calls made or received in the last 60 days, newest first. */
@Composable
fun CallsScreen(sales: SalesRepository, onOpenLead: (String) -> Unit) {
    val calls by remember { sales.observeRecentCalls(200) }.collectAsStateWithLifecycle(null)
    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(stringResource(R.string.calls_title), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 16.dp))
        val list = calls
        if (list != null && list.isEmpty()) Muted(stringResource(R.string.calls_empty))
        if (!list.isNullOrEmpty()) {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.weight(1f)) {
                items(list, key = { it.call.id }) { row ->
                    val c = row.call
                    Surface(
                        shape = MaterialTheme.shapes.medium,
                        tonalElevation = 1.dp,
                        modifier = Modifier.fillMaxWidth().clickable(enabled = c.leadId != null) { c.leadId?.let(onOpenLead) },
                    ) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(row.leadName ?: c.phoneE164 ?: stringResource(R.string.calls_unknown), style = MaterialTheme.typography.titleMedium)
                            Text(
                                listOfNotNull(
                                    IstDates.formatDateTime(c.startedAt),
                                    c.outcome?.let { outcomeLabel(it) },
                                    stringResource(R.string.calls_duration, c.durationS / 60, c.durationS % 60),
                                ).joinToString(" · "),
                                color = Pearl.palette.textSecondary,
                            )
                            c.notes?.let { Text(it, maxLines = 3) }
                            if (c.pending) Muted(stringResource(R.string.not_sent_yet))
                        }
                    }
                }
            }
        }
    }
}
