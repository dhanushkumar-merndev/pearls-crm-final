package com.pearl.crm.feature.sales

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.pearl.crm.core.data.NextStep
import com.pearl.crm.core.data.SalesRepository
import com.pearl.crm.core.model.CallOutcome
import com.pearl.crm.core.model.IstDates
import com.pearl.crm.core.model.LeadStage
import com.pearl.crm.core.model.LibraryItem
import com.pearl.crm.core.model.LibraryKind
import com.pearl.crm.core.model.LibrarySource
import com.pearl.crm.core.ui.components.FieldError
import com.pearl.crm.core.ui.components.Section
import com.pearl.crm.core.ui.components.ButtonKind
import com.pearl.crm.core.ui.components.PearlButton
import com.pearl.crm.core.ui.library.LibraryPicker
import com.pearl.crm.core.ui.theme.Pearl
import com.pearl.crm.core.ui.theme.Spacing
import java.time.LocalDate
import java.time.LocalTime

/** "Next step" chips. Call-backs are at 11 AM IST on that day. */
enum class NextChoice(val label: Int) {
    Close(R.string.notes_next_close),
    Tomorrow(R.string.notes_next_tomorrow),
    ThreeDays(R.string.notes_next_3days),
    NextWeek(R.string.notes_next_week),
    NoMore(R.string.notes_next_none),
    ;

    fun toStep(today: LocalDate): NextStep = when (this) {
        Close -> NextStep.CloseDue
        NoMore -> NextStep.NoMore
        Tomorrow -> NextStep.CallAgain(at11(today.plusDays(1)))
        ThreeDays -> NextStep.CallAgain(at11(today.plusDays(3)))
        NextWeek -> NextStep.CallAgain(at11(today.plusDays(7)))
    }

    private fun at11(day: LocalDate) = day.atTime(LocalTime.of(11, 0)).atZone(IstDates.ZONE).toInstant().toEpochMilli()
}

/** What the person filled in. */
data class CallNotesInput(
    val outcome: String? = null,
    val notes: String = "",
    val next: NextChoice = NextChoice.Close,
    val stage: String? = null,
    val lostReason: LibraryItem? = null,
    /** Optional, only for a lost lead: the person says why. */
    val voiceNote: VoiceClip? = null,
)

enum class NotesField { Outcome, Notes, LostReason }

/** Field → message (string resource). Empty = ready to save. Same rules as the server. */
fun validateCallNotes(input: CallNotesInput): Map<NotesField, Int> = buildMap {
    if (input.outcome !in CallOutcome.ALL) put(NotesField.Outcome, R.string.notes_outcome_required)
    if (input.notes.trim().length > SalesRepository.MAX_NOTES) put(NotesField.Notes, R.string.notes_too_long)
    if (input.stage == LeadStage.LOST && input.lostReason == null) put(NotesField.LostReason, R.string.notes_lost_reason_required)
}

/** The bottom sheet shown after a call. [onSave] gets checked input. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CallNotesSheet(
    leadName: String,
    library: LibrarySource,
    onSave: (CallNotesInput) -> Unit,
    onDismiss: () -> Unit,
    busy: Boolean = false,
) {
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = state) {
        CallNotesForm(leadName, library, onSave, onDismiss, busy, Modifier.navigationBarsPadding())
    }
}

/** The sheet's content (tested on its own). */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun CallNotesForm(
    leadName: String,
    library: LibrarySource,
    onSave: (CallNotesInput) -> Unit,
    onLater: () -> Unit,
    busy: Boolean = false,
    modifier: Modifier = Modifier,
) {
    var outcome by rememberSaveable { mutableStateOf<String?>(null) }
    var notes by rememberSaveable { mutableStateOf("") }
    var next by rememberSaveable { mutableStateOf(NextChoice.Close) }
    var stage by rememberSaveable { mutableStateOf<String?>(null) }
    var lostReason by remember { mutableStateOf<LibraryItem?>(null) }
    var voiceNote by remember { mutableStateOf<VoiceClip?>(null) }
    var errors by remember { mutableStateOf<Map<NotesField, Int>>(emptyMap()) }
    val notesFocus = remember { FocusRequester() }
    val scroll = rememberScrollState()
    val outcomeView = remember { BringIntoViewRequester() }
    val notesView = remember { BringIntoViewRequester() }
    val lostView = remember { BringIntoViewRequester() }
    // After a failed save: bring the first bad field into view (and focus the notes box).
    var showFirst by remember { mutableStateOf<NotesField?>(null) }
    LaunchedEffect(showFirst) {
        when (showFirst) {
            NotesField.Outcome -> outcomeView.bringIntoView()
            NotesField.Notes -> {
                notesView.bringIntoView()
                notesFocus.requestFocus()
            }
            NotesField.LostReason -> lostView.bringIntoView()
            null -> Unit
        }
        showFirst = null
    }

    Column(
        modifier.fillMaxWidth().verticalScroll(scroll).padding(horizontal = Spacing.l, vertical = Spacing.s),
        verticalArrangement = Arrangement.spacedBy(Spacing.l),
    ) {
        Text(stringResource(R.string.notes_title), style = MaterialTheme.typography.titleLarge)
        Text(leadName, color = Pearl.palette.textSecondary)

        Section(stringResource(R.string.notes_outcome), Modifier.bringIntoViewRequester(outcomeView)) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.s), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                CallOutcome.ALL.forEach { value ->
                    FilterChip(
                        selected = outcome == value,
                        onClick = {
                            outcome = value
                            errors = errors - NotesField.Outcome
                        },
                        label = { Text(outcomeLabel(value)) },
                        leadingIcon = if (outcome == value) ({ Icon(Icons.Outlined.Check, null) }) else null,
                        modifier = Modifier.testTag("outcome-$value"),
                    )
                }
            }
            FieldError(errors[NotesField.Outcome], "outcome-error")
        }

        val notesError = errors[NotesField.Notes]
        val notesErrorText = notesError?.let { stringResource(it, SalesRepository.MAX_NOTES) }
        OutlinedTextField(
            value = notes,
            onValueChange = {
                notes = it
                errors = errors - NotesField.Notes
            },
            label = { Text(stringResource(R.string.notes_text)) },
            minLines = 3,
            isError = notesError != null,
            supportingText = {
                Text(notesErrorText ?: stringResource(R.string.notes_counter, notes.trim().length, SalesRepository.MAX_NOTES))
            },
            modifier = Modifier
                .fillMaxWidth()
                .focusRequester(notesFocus)
                .bringIntoViewRequester(notesView)
                .testTag("notes")
                .semantics { if (notesErrorText != null) error(notesErrorText) },
        )

        Section(stringResource(R.string.notes_next)) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.s), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                NextChoice.entries.forEach { choice ->
                    FilterChip(
                        selected = next == choice,
                        onClick = { next = choice },
                        label = { Text(stringResource(choice.label)) },
                        leadingIcon = if (next == choice) ({ Icon(Icons.Outlined.Schedule, null) }) else null,
                    )
                }
            }
        }

        Section(stringResource(R.string.notes_stage)) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.s), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                FilterChip(selected = stage == null, onClick = { stage = null }, label = { Text(stringResource(R.string.notes_stage_keep)) })
                STAGES_AFTER_CALL.forEach { value ->
                    FilterChip(
                        selected = stage == value,
                        onClick = {
                            stage = value
                            errors = errors - NotesField.LostReason
                        },
                        label = { Text(stageLabel(value)) },
                        modifier = Modifier.testTag("stage-$value"),
                    )
                }
            }
        }

        if (stage == LeadStage.LOST) {
            LibraryPicker(
                kind = LibraryKind.LOST_REASON,
                value = lostReason,
                onChange = {
                    lostReason = it
                    errors = errors - NotesField.LostReason
                },
                source = library,
                label = stringResource(R.string.notes_lost_reason),
                modifier = Modifier.bringIntoViewRequester(lostView).testTag("lost-reason"),
            )
            FieldError(errors[NotesField.LostReason], "lost-reason-error")
            VoiceNoteRecorder(voiceNote) { voiceNote = it }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.m)) {
            PearlButton(
                stringResource(R.string.notes_save),
                Icons.Outlined.Check,
                onClick = {
                    val input = CallNotesInput(outcome, notes, next, stage, lostReason, voiceNote.takeIf { stage == LeadStage.LOST })
                    val found = validateCallNotes(input)
                    errors = found
                    if (found.isEmpty()) onSave(input) else showFirst = NotesField.entries.first { it in found }
                },
                busy = busy,
                modifier = Modifier.testTag("save-notes"),
            )
            PearlButton(stringResource(R.string.notes_later), Icons.Outlined.Schedule, onLater, kind = ButtonKind.Quiet)
        }
    }
}

/** Stages offered in the sheet (the ones a call can lead to). */
private val STAGES_AFTER_CALL = listOf(
    LeadStage.INTERESTED, LeadStage.NOT_REACHABLE, LeadStage.LOST, LeadStage.JUNK,
)

