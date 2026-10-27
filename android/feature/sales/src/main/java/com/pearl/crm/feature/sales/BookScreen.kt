package com.pearl.crm.feature.sales

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Event
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.pearl.crm.core.data.SalesRepository
import com.pearl.crm.core.data.newClientId
import com.pearl.crm.core.model.FreeSlot
import com.pearl.crm.core.model.IstDates
import com.pearl.crm.core.model.LibraryItem
import com.pearl.crm.core.model.LibraryKind
import com.pearl.crm.core.model.LibrarySource
import com.pearl.crm.core.model.RpcFailure
import com.pearl.crm.core.ui.components.PearlButton
import com.pearl.crm.core.ui.components.StatusLabel
import com.pearl.crm.core.ui.components.StatusTone
import com.pearl.crm.core.ui.components.failureMessage
import com.pearl.crm.core.ui.library.LibraryPicker
import com.pearl.crm.core.ui.theme.Spacing
import java.time.OffsetDateTime
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.material3.Scaffold
import androidx.compose.ui.unit.dp
import com.pearl.crm.core.ui.components.ButtonKind
import com.pearl.crm.core.ui.components.FieldError
import com.pearl.crm.core.ui.components.LoadingBlock
import com.pearl.crm.core.ui.components.Muted
import com.pearl.crm.core.ui.components.PearlTopBar
import com.pearl.crm.core.ui.components.Section
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val DAYS_AHEAD = 14L

/** A day chip after "Tomorrow": "Mon 27/10", the day name in the phone's language. */
fun bookDayLabel(date: LocalDate, locale: Locale = Locale.getDefault()): String =
    date.format(DateTimeFormatter.ofPattern("EEE d/M", locale))

private fun slotMs(slot: FreeSlot): Long = OffsetDateTime.parse(slot.start).toInstant().toEpochMilli()

/**
 * Book a consultation for a lead: doctor → day → a free time. Needs the internet (the server
 * checks the slot is still free; if someone took it first, "slot full" shows and the times reload).
 */
@Composable
fun BookScreen(
    leadId: String,
    sales: SalesRepository,
    library: LibrarySource,
    onBack: () -> Unit,
    onBooked: (String) -> Unit,
) {
    val today = remember { istToday() }
    var doctor by remember { mutableStateOf<LibraryItem?>(null) }
    var dayOffset by rememberSaveable { mutableIntStateOf(0) }
    var slots by remember { mutableStateOf<List<FreeSlot>?>(null) }
    var slot by remember { mutableStateOf<FreeSlot?>(null) }
    var online by rememberSaveable { mutableStateOf(false) }
    var confirmed by rememberSaveable { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<Throwable?>(null) }
    var fieldError by remember { mutableStateOf<Int?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    // Same id for every retry of this booking: a lost answer can never book twice.
    val clientId = rememberSaveable { newClientId() }
    val scope = rememberCoroutineScope()
    val day = today.plusDays(dayOffset.toLong())
    val bookedText = slot?.let { stringResource(R.string.book_done, IstDates.formatDateTime(slotMs(it))) }

    LaunchedEffect(doctor?.id, dayOffset, reload) {
        val id = doctor?.id ?: return@LaunchedEffect
        loading = true
        slot = null
        try {
            slots = sales.freeSlots(id, day)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            slots = null
            failure = e
        } finally {
            loading = false
        }
    }

    fun save() {
        val d = doctor
        val s = slot
        when {
            d == null -> fieldError = R.string.book_doctor_required
            s == null -> fieldError = R.string.book_slot_required
            else -> {
                busy = true
                scope.launch {
                    try {
                        sales.book(clientId, leadId, d.id, d.label, s, online, confirmed)
                        // Navigation must run on the main thread, whatever thread the call came back on.
                        withContext(Dispatchers.Main.immediate) { onBooked(bookedText.orEmpty()) }
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        failure = e
                        // Someone else took it: show the fresh list.
                        if (e is RpcFailure.Permanent && e.code == "slot_full") reload++
                    } finally {
                        busy = false
                    }
                }
            }
        }
    }

    Scaffold(
        contentWindowInsets = WindowInsets(0),
        topBar = { PearlTopBar(stringResource(R.string.book_title), onBack = onBack) },
        // Book stays at the bottom, above the keyboard, however long the form is.
        bottomBar = {
            Column(Modifier.imePadding()) {
                BottomActionBar {
                    // A failed booking is explained right above the button.
                    failure?.let {
                        StatusLabel(failureMessage(it), StatusTone.Critical, Modifier.testTag("book-failure"))
                        if (it is RpcFailure.Transient) {
                            PearlButton(stringResource(R.string.myday_refresh), Icons.Outlined.Refresh, {
                                failure = null
                                reload++
                            }, kind = ButtonKind.Tonal, small = true)
                        }
                    }
                    PearlButton(
                        stringResource(R.string.book_save),
                        Icons.Outlined.Event,
                        busy = busy,
                        onClick = ::save,
                        modifier = Modifier.fillMaxWidth().testTag("book-save"),
                    )
                }
            }
        },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(horizontal = Spacing.screen, vertical = Spacing.xs),
            verticalArrangement = Arrangement.spacedBy(Spacing.section),
        ) {
            LibraryPicker(
                kind = LibraryKind.DOCTOR,
                value = doctor,
                onChange = {
                    doctor = it
                    failure = null
                    fieldError = null
                },
                source = library,
                label = stringResource(R.string.book_doctor),
                modifier = Modifier.testTag("book-doctor"),
            )
            Section(stringResource(R.string.book_day)) {
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
                    (0 until DAYS_AHEAD.toInt()).forEach { offset ->
                        val d = today.plusDays(offset.toLong())
                        val label = when (offset) {
                            0 -> stringResource(R.string.book_today)
                            1 -> stringResource(R.string.book_tomorrow)
                            else -> bookDayLabel(d)
                        }
                        FilterChip(selected = dayOffset == offset, onClick = {
                            dayOffset = offset
                            failure = null
                        }, label = { Text(label) })
                    }
                }
            }
            Section(stringResource(R.string.book_slot)) {
                val list = slots?.filter { it.bookable }
                when {
                    doctor == null -> Muted(stringResource(R.string.book_pick_doctor))
                    loading -> LoadingBlock(rows = 1, rowHeight = 32.dp)
                    list == null -> Unit
                    list.isEmpty() -> Muted(stringResource(R.string.book_no_slots))
                    // 40 dp chips, same gap across and down.
                    else -> FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.s), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                        list.forEach { s ->
                            FilterChip(
                                selected = slot == s,
                                onClick = {
                                    slot = s
                                    fieldError = null
                                    failure = null
                                },
                                label = { Text(stringResource(R.string.book_slot_left, IstDates.formatTime(slotMs(s)), s.left)) },
                                modifier = Modifier.height(40.dp),
                            )
                        }
                    }
                }
                FieldError(fieldError, "book-error")
            }
            CheckRow(stringResource(R.string.book_online), online) { online = it }
            CheckRow(stringResource(R.string.book_confirmed), confirmed) { confirmed = it }
        }
    }
}

@Composable
private fun CheckRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.toggleable(value = checked, role = Role.Checkbox, onValueChange = onChange).padding(vertical = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Checkbox(checked = checked, onCheckedChange = null)
        Text(label, modifier = Modifier.padding(start = Spacing.s))
    }
}
