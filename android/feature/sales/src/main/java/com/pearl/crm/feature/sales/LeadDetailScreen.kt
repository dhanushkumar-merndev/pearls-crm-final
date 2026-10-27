package com.pearl.crm.feature.sales

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.CallMade
import androidx.compose.material.icons.automirrored.outlined.CallMissed
import androidx.compose.material.icons.automirrored.outlined.CallReceived
import androidx.compose.material.icons.automirrored.outlined.NoteAdd
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.Chat
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.Event
import androidx.compose.material.icons.outlined.EventRepeat
import androidx.compose.material.icons.outlined.SwapVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pearl.crm.core.data.SalesRepository
import com.pearl.crm.core.data.db.LeadEntity
import com.pearl.crm.core.model.CallDirection
import com.pearl.crm.core.model.IstDates
import com.pearl.crm.core.model.LeadStage
import com.pearl.crm.core.model.LibraryItem
import com.pearl.crm.core.model.LibraryKind
import com.pearl.crm.core.model.LibrarySource
import com.pearl.crm.core.ui.components.ButtonKind
import com.pearl.crm.core.ui.components.EmptyState
import com.pearl.crm.core.ui.components.FieldError
import com.pearl.crm.core.ui.components.ListRow
import com.pearl.crm.core.ui.components.LoadingBlock
import com.pearl.crm.core.ui.components.Muted
import com.pearl.crm.core.ui.components.PearlButton
import com.pearl.crm.core.ui.components.PearlCard
import com.pearl.crm.core.ui.components.PearlTopBar
import com.pearl.crm.core.ui.components.Section
import com.pearl.crm.core.ui.components.StatusLabel
import com.pearl.crm.core.ui.components.StatusTone
import com.pearl.crm.core.ui.library.LibraryPicker
import com.pearl.crm.core.ui.theme.Pearl
import com.pearl.crm.core.ui.theme.Spacing
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/** The lead as read from the phone; [lead] null = not on this phone (any more). */
private class LeadLoad(val lead: LeadEntity?)

/** Icon for a call's direction (incoming / outgoing / missed), always shown with its label. */
fun callDirectionIcon(direction: String): ImageVector = when (direction) {
    CallDirection.INCOMING -> Icons.AutoMirrored.Outlined.CallReceived
    CallDirection.MISSED -> Icons.AutoMirrored.Outlined.CallMissed
    else -> Icons.AutoMirrored.Outlined.CallMade
}

@Composable
fun callDirectionLabel(direction: String): String = stringResource(
    when (direction) {
        CallDirection.INCOMING -> R.string.calls_dir_incoming
        CallDirection.MISSED -> R.string.calls_dir_missed
        else -> R.string.calls_dir_outgoing
    },
)

/**
 * One lead: the name in the top bar, the details card, Call (the one primary action) next to
 * WhatsApp and Book, then quieter Call notes / Note / Stage, then the history.
 */
@Composable
fun LeadDetailScreen(
    leadId: String,
    sales: SalesRepository,
    library: LibrarySource,
    onBack: () -> Unit,
    onBook: (String) -> Unit,
) {
    val context = LocalContext.current
    val load by remember(leadId) { sales.observeLead(leadId).map { LeadLoad(it) } }.collectAsStateWithLifecycle(null)
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
    val lead = load?.lead

    Scaffold(
        contentWindowInsets = WindowInsets(0),
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            PearlTopBar(
                title = lead?.name ?: stringResource(R.string.lead_title),
                subtitle = lead?.slNo?.let { stringResource(R.string.lead_number, it.toInt()) },
                onBack = onBack,
            )
        },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState())
                .padding(start = Spacing.screen, end = Spacing.screen, top = Spacing.xs, bottom = Spacing.screen),
            verticalArrangement = Arrangement.spacedBy(Spacing.section),
        ) {
            val current = lead
            when {
                load == null -> {
                    LoadingBlock(rows = 3, rowHeight = 48.dp)
                    return@Column
                }
                current == null -> {
                    EmptyState(Icons.Outlined.Close, stringResource(R.string.lead_not_found))
                    return@Column
                }
            }
            PearlCard(verticalSpacing = Spacing.xs) {
                Text(current.phoneE164, style = MaterialTheme.typography.titleMedium)
                Text(stringResource(R.string.lead_stage) + ": " + stageLabel(current.stage), style = MaterialTheme.typography.bodyMedium)
                current.nextFollowupAt?.let { Text(dueText(it), style = MaterialTheme.typography.bodyMedium) }
                current.treatmentText?.let { Muted(stringResource(R.string.lead_treatment, it)) }
                current.comments1?.let { Muted(stringResource(R.string.lead_comments, it)) }
                if (current.pending) StatusLabel(stringResource(R.string.not_sent_yet), StatusTone.Info)
            }

            Column(verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
                    PearlButton(stringResource(R.string.call), Icons.Outlined.Call, { flow.call(current.id, current.phoneE164) }, Modifier.weight(1f))
                    PearlButton(stringResource(R.string.whatsapp), Icons.Outlined.Chat, { openWhatsApp(context, current.phoneE164) }, Modifier.weight(1f), kind = ButtonKind.Secondary)
                    if (current.stage !in LeadStage.CLOSED) {
                        val bookLabel = stringResource(R.string.lead_book)
                        PearlButton(
                            stringResource(R.string.lead_book_short),
                            Icons.Outlined.Event,
                            { onBook(current.id) },
                            Modifier.weight(1f).semantics { contentDescription = bookLabel },
                            kind = ButtonKind.Secondary,
                        )
                    }
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.s), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                    val notesLabel = stringResource(R.string.lead_log_call)
                    val noteLabel = stringResource(R.string.lead_add_note)
                    PearlButton(
                        stringResource(R.string.lead_log_call_short),
                        Icons.Outlined.EditNote,
                        { manualNotes = true },
                        Modifier.semantics { contentDescription = notesLabel },
                        kind = ButtonKind.Tonal,
                        small = true,
                    )
                    PearlButton(
                        stringResource(R.string.lead_add_note_short),
                        Icons.AutoMirrored.Outlined.NoteAdd,
                        { noting = true },
                        Modifier.semantics { contentDescription = noteLabel },
                        kind = ButtonKind.Tonal,
                        small = true,
                    )
                    PearlButton(stringResource(R.string.lead_change_stage), Icons.Outlined.SwapVert, { staging = true }, kind = ButtonKind.Tonal, small = true)
                }
            }

            History(stringResource(R.string.lead_tasks), tasks.isEmpty()) {
                tasks.forEachIndexed { i, task ->
                    if (i > 0) HorizontalDivider()
                    ListRow(
                        title = "${task.dueAt?.let(IstDates::formatDateTime) ?: task.dueDate} · ${task.reason}",
                        supporting = listOfNotNull(taskStatusLabel(task.status), task.outcome).joinToString(" · "),
                        icon = Icons.Outlined.EventRepeat,
                    )
                }
            }
            History(stringResource(R.string.lead_bookings), bookings.isEmpty()) {
                bookings.forEachIndexed { i, a ->
                    if (i > 0) HorizontalDivider()
                    ListRow(
                        title = listOfNotNull(a.slotStart?.let(IstDates::formatDateTime) ?: a.apptDate, a.doctor).joinToString(" · "),
                        supporting = apptStatusLabel(a.status),
                        icon = Icons.Outlined.Event,
                    )
                }
            }
            History(stringResource(R.string.lead_calls), calls.isEmpty()) {
                calls.forEachIndexed { i, c ->
                    if (i > 0) HorizontalDivider()
                    ListRow(
                        title = listOfNotNull(IstDates.formatDateTime(c.startedAt), c.outcome?.let { outcomeLabel(it) }).joinToString(" · "),
                        supporting = listOfNotNull(callDirectionLabel(c.direction), c.notes).joinToString(" · "),
                        icon = callDirectionIcon(c.direction),
                        iconTint = if (c.direction == CallDirection.MISSED) Pearl.palette.badText else null,
                        below = if (c.pending) ({ StatusLabel(stringResource(R.string.not_sent_yet), StatusTone.Info) }) else null,
                    )
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

/** A history block: its rows in one card, or "Nothing yet." */
@Composable
private fun History(title: String, empty: Boolean, rows: @Composable () -> Unit) {
    Section(title) {
        if (empty) {
            Muted(stringResource(R.string.lead_none))
        } else {
            PearlCard(contentPadding = PaddingValues(0.dp), verticalSpacing = 0.dp) { rows() }
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
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.s), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
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
