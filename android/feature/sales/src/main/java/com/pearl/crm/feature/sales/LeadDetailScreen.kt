package com.pearl.crm.feature.sales

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.NoteAdd
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.Chat
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.Event
import androidx.compose.material.icons.outlined.SwapVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
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
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pearl.crm.core.data.SalesRepository
import com.pearl.crm.core.model.IstDates
import com.pearl.crm.core.model.LeadStage
import com.pearl.crm.core.model.LibraryItem
import com.pearl.crm.core.model.LibraryKind
import com.pearl.crm.core.model.LibrarySource
import com.pearl.crm.core.ui.components.ButtonKind
import com.pearl.crm.core.ui.components.PearlButton
import com.pearl.crm.core.ui.components.StatusLabel
import com.pearl.crm.core.ui.components.StatusTone
import com.pearl.crm.core.ui.library.LibraryPicker
import com.pearl.crm.core.ui.theme.Pearl
import kotlinx.coroutines.launch

@Composable
fun LeadDetailScreen(
    leadId: String,
    sales: SalesRepository,
    library: LibrarySource,
    onBack: () -> Unit,
    onBook: (String) -> Unit,
) {
    val context = LocalContext.current
    val lead by remember(leadId) { sales.observeLead(leadId) }.collectAsStateWithLifecycle(null)
    val tasks by remember(leadId) { sales.observeLeadFollowups(leadId) }.collectAsStateWithLifecycle(emptyList())
    val bookings by remember(leadId) { sales.observeLeadAppointments(leadId) }.collectAsStateWithLifecycle(emptyList())
    val calls by remember(leadId) { sales.observeLeadCalls(leadId) }.collectAsStateWithLifecycle(emptyList())
    val flow = rememberCallFlow(context)
    var manualNotes by rememberSaveable { mutableStateOf(false) }
    var noting by rememberSaveable { mutableStateOf(false) }
    var staging by rememberSaveable { mutableStateOf(false) }
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val savedText = stringResource(R.string.saved_offline)
    val showSaved: (Boolean) -> Unit = { saved -> if (saved) scope.launch { snackbar.showSnackbar(savedText) } }

    Scaffold(snackbarHost = { SnackbarHost(snackbar) }) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, stringResource(R.string.back)) }
                Text(
                    lead?.slNo?.let { stringResource(R.string.lead_number, it.toInt()) } ?: stringResource(R.string.lead_title),
                    style = MaterialTheme.typography.titleMedium,
                    color = Pearl.palette.textSecondary,
                )
            }
            val current = lead
            if (current == null) {
                Muted(stringResource(R.string.lead_not_found))
                return@Column
            }
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(current.name, style = MaterialTheme.typography.headlineSmall)
                Text(current.phoneE164, style = MaterialTheme.typography.bodyLarge)
                Text(stringResource(R.string.lead_stage) + ": " + stageLabel(current.stage))
                current.nextFollowupAt?.let { Text(dueText(it)) }
                current.treatmentText?.let { Muted(stringResource(R.string.lead_treatment, it)) }
                current.comments1?.let { Muted(stringResource(R.string.lead_comments, it)) }
                if (current.pending) StatusLabel(stringResource(R.string.not_sent_yet), StatusTone.Info)
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                PearlButton(stringResource(R.string.call), Icons.Outlined.Call, { flow.call(current.id, current.phoneE164) })
                PearlButton(stringResource(R.string.whatsapp), Icons.Outlined.Chat, { openWhatsApp(context, current.phoneE164) }, kind = ButtonKind.Secondary)
                PearlButton(stringResource(R.string.lead_log_call), Icons.Outlined.EditNote, { manualNotes = true }, kind = ButtonKind.Secondary)
                PearlButton(stringResource(R.string.lead_add_note), Icons.AutoMirrored.Outlined.NoteAdd, { noting = true }, kind = ButtonKind.Secondary)
                PearlButton(stringResource(R.string.lead_change_stage), Icons.Outlined.SwapVert, { staging = true }, kind = ButtonKind.Secondary)
                if (current.stage !in LeadStage.CLOSED) {
                    PearlButton(stringResource(R.string.lead_book), Icons.Outlined.Event, { onBook(current.id) }, kind = ButtonKind.Secondary)
                }
            }

            Section(stringResource(R.string.lead_tasks)) {
                if (tasks.isEmpty()) Muted(stringResource(R.string.lead_none))
                tasks.forEach { task ->
                    Text("${task.dueAt?.let(IstDates::formatDateTime) ?: task.dueDate} · ${task.reason}")
                    Muted(listOfNotNull(taskStatusLabel(task.status), task.outcome).joinToString(" · "))
                }
            }
            HorizontalDivider()
            Section(stringResource(R.string.lead_bookings)) {
                if (bookings.isEmpty()) Muted(stringResource(R.string.lead_none))
                bookings.forEach { a ->
                    Text(listOfNotNull(a.slotStart?.let(IstDates::formatDateTime) ?: a.apptDate, a.doctor).joinToString(" · "))
                    Muted(apptStatusLabel(a.status))
                }
            }
            HorizontalDivider()
            Section(stringResource(R.string.lead_calls)) {
                if (calls.isEmpty()) Muted(stringResource(R.string.lead_none))
                calls.forEach { c ->
                    Text(listOfNotNull(IstDates.formatDateTime(c.startedAt), c.outcome?.let { outcomeLabel(it) }).joinToString(" · "))
                    c.notes?.let { Muted(it) }
                    if (c.pending) StatusLabel(stringResource(R.string.not_sent_yet), StatusTone.Info)
                }
            }
        }
    }

    val current = lead
    if (current != null) {
        flow.needsNotes?.let { call ->
            AfterCallNotes(sales, library, call, current.name, onDone = {
                flow.needsNotes = null
                showSaved(it)
            }, awayMs = flow.awayMs)
        }
        if (manualNotes) {
            AfterCallNotes(sales, library, StartedCall(current.id, current.phoneE164, System.currentTimeMillis()), current.name, onDone = {
                manualNotes = false
                showSaved(it)
            })
        }
        if (noting) {
            NoteDialog(onDismiss = { noting = false }, onSave = { text ->
                noting = false
                scope.launch {
                    sales.addNote(current.id, text)
                    showSaved(true)
                }
            })
        }
        if (staging) {
            StageDialog(current.stage, library, onDismiss = { staging = false }, onSave = { stage, reason ->
                staging = false
                scope.launch {
                    sales.setStage(current.id, stage, reason?.id)
                    showSaved(true)
                }
            })
        }
    }
}

@Composable
private fun NoteDialog(onDismiss: () -> Unit, onSave: (String) -> Unit) {
    var text by rememberSaveable { mutableStateOf("") }
    var error by remember { mutableStateOf<Int?>(null) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.lead_add_note)) },
        text = {
            OutlinedTextField(
                value = text,
                onValueChange = {
                    text = it.take(SalesRepository.MAX_NOTES)
                    error = null
                },
                label = { Text(stringResource(R.string.lead_note)) },
                minLines = 3,
                isError = error != null,
                supportingText = error?.let { { Text(stringResource(it)) } },
                modifier = Modifier.fillMaxWidth().testTag("note-text"),
            )
        },
        confirmButton = {
            PearlButton(stringResource(R.string.lead_note_save), Icons.Outlined.Check, {
                if (text.isBlank()) error = R.string.lead_note_required else onSave(text)
            })
        },
        dismissButton = { PearlButton(stringResource(R.string.new_lead_cancel), Icons.Outlined.Close, onDismiss, kind = ButtonKind.Quiet) },
    )
}

@Composable
private fun StageDialog(current: String, library: LibrarySource, onDismiss: () -> Unit, onSave: (String, LibraryItem?) -> Unit) {
    var stage by rememberSaveable { mutableStateOf(current) }
    var reason by remember { mutableStateOf<LibraryItem?>(null) }
    var error by remember { mutableStateOf<Int?>(null) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.lead_change_stage)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    LeadStage.ALL.forEach { s ->
                        FilterChip(selected = stage == s, onClick = {
                            stage = s
                            error = null
                        }, label = { Text(stageLabel(s)) })
                    }
                }
                if (stage == LeadStage.LOST) {
                    LibraryPicker(
                        kind = LibraryKind.LOST_REASON,
                        value = reason,
                        onChange = {
                            reason = it
                            error = null
                        },
                        source = library,
                        label = stringResource(R.string.notes_lost_reason),
                    )
                }
                FieldError(error, "stage-error")
            }
        },
        confirmButton = {
            PearlButton(stringResource(R.string.lead_stage_save), Icons.Outlined.Check, {
                when {
                    stage == LeadStage.LOST && reason == null -> error = R.string.notes_lost_reason_required
                    stage == current && stage != LeadStage.LOST -> onDismiss()
                    else -> onSave(stage, reason)
                }
            })
        },
        dismissButton = { PearlButton(stringResource(R.string.new_lead_cancel), Icons.Outlined.Close, onDismiss, kind = ButtonKind.Quiet) },
    )
}
