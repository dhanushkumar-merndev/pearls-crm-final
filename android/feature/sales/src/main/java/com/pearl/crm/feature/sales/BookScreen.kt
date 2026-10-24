package com.pearl.crm.feature.sales

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Event
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.foundation.selection.toggleable
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
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.time.OffsetDateTime

private const val DAYS_AHEAD = 14L

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

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, stringResource(R.string.back)) }
            Text(stringResource(R.string.book_title), style = MaterialTheme.typography.titleLarge)
        }
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
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                (0 until DAYS_AHEAD.toInt()).forEach { offset ->
                    val d = today.plusDays(offset.toLong())
                    val label = when (offset) {
                        0 -> stringResource(R.string.book_today)
                        1 -> stringResource(R.string.book_tomorrow)
                        else -> "${d.dayOfWeek.name.take(3).lowercase().replaceFirstChar(Char::uppercase)} ${d.dayOfMonth}/${d.monthValue}"
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
                loading -> Muted(stringResource(R.string.book_loading))
                list == null -> Unit
                list.isEmpty() -> Muted(stringResource(R.string.book_no_slots))
                else -> FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    list.forEach { s ->
                        FilterChip(
                            selected = slot == s,
                            onClick = {
                                slot = s
                                fieldError = null
                                failure = null
                            },
                            label = { Text(stringResource(R.string.book_slot_left, IstDates.formatTime(slotMs(s)), s.left)) },
                        )
                    }
                }
            }
            FieldError(fieldError, "book-error")
        }
        CheckRow(stringResource(R.string.book_online), online) { online = it }
        CheckRow(stringResource(R.string.book_confirmed), confirmed) { confirmed = it }
        failure?.let {
            StatusLabel(failureMessage(it), StatusTone.Critical, Modifier.testTag("book-failure"))
            if (it is RpcFailure.Transient) {
                PearlButton(stringResource(R.string.myday_refresh), Icons.Outlined.Refresh, {
                    failure = null
                    reload++
                }, kind = com.pearl.crm.core.ui.components.ButtonKind.Secondary)
            }
        }
        PearlButton(
            stringResource(R.string.book_save),
            Icons.Outlined.Event,
            busy = busy,
            onClick = {
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
                                onBooked(bookedText.orEmpty())
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
            },
            modifier = Modifier.testTag("book-save"),
        )
    }
}

@Composable
private fun CheckRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.toggleable(value = checked, role = Role.Checkbox, onValueChange = onChange).padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Checkbox(checked = checked, onCheckedChange = null)
        Text(label, modifier = Modifier.padding(start = 8.dp))
    }
}
