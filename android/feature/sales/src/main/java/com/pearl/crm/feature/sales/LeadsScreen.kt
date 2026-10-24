package com.pearl.crm.feature.sales

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.Chat
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.foundation.text.KeyboardOptions
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pearl.crm.core.data.LeadDraft
import com.pearl.crm.core.data.LeadFilter
import com.pearl.crm.core.data.SalesRepository
import com.pearl.crm.core.data.db.LeadEntity
import com.pearl.crm.core.model.LibraryItem
import com.pearl.crm.core.model.LibraryKind
import com.pearl.crm.core.model.LibrarySource
import com.pearl.crm.core.model.Phones
import com.pearl.crm.core.ui.components.ButtonKind
import com.pearl.crm.core.ui.components.PearlButton
import com.pearl.crm.core.ui.components.StatusLabel
import com.pearl.crm.core.ui.components.StatusTone
import com.pearl.crm.core.ui.components.failureMessage
import com.pearl.crm.core.ui.library.LibraryPicker
import com.pearl.crm.core.ui.theme.Pearl
import kotlinx.coroutines.launch

private val FILTER_LABELS = mapOf(
    LeadFilter.Due to R.string.leads_filter_due,
    LeadFilter.All to R.string.leads_filter_all,
    LeadFilter.New to R.string.leads_filter_new,
    LeadFilter.Interested to R.string.leads_filter_interested,
    LeadFilter.Booked to R.string.leads_filter_booked,
)

@Composable
fun LeadsScreen(
    sales: SalesRepository,
    library: LibrarySource,
    onOpenLead: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    var filter by rememberSaveable { mutableStateOf(LeadFilter.Due) }
    var query by rememberSaveable { mutableStateOf("") }
    var adding by rememberSaveable { mutableStateOf(false) }
    val leads by remember(filter, query) { sales.observeLeads(filter, query) }.collectAsStateWithLifecycle(null)
    val calls = rememberCallFlow(context)
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val savedText = stringResource(R.string.saved_offline)

    Scaffold(
        modifier = modifier,
        snackbarHost = { SnackbarHost(snackbar) },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = { adding = true },
                icon = { Icon(Icons.Outlined.Add, null) },
                text = { Text(stringResource(R.string.leads_new)) },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(stringResource(R.string.leads_title), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 16.dp))
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                leadingIcon = { Icon(Icons.Outlined.Search, null) },
                trailingIcon = {
                    if (query.isNotEmpty()) {
                        IconButton(onClick = { query = "" }) { Icon(Icons.Outlined.Close, stringResource(R.string.new_lead_cancel)) }
                    }
                },
                placeholder = { Text(stringResource(R.string.leads_search)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().testTag("lead-search"),
            )
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                LeadFilter.entries.forEach { f ->
                    FilterChip(selected = filter == f, onClick = { filter = f }, label = { Text(stringResource(FILTER_LABELS.getValue(f))) })
                }
            }
            val list = leads
            when {
                list == null -> Unit
                list.isEmpty() -> Muted(stringResource(if (filter == LeadFilter.Due && query.isBlank()) R.string.leads_empty_due else R.string.leads_empty))
                else -> {
                    Muted(stringResource(R.string.leads_swipe_hint))
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.weight(1f)) {
                        items(list, key = { it.id }) { lead ->
                            SwipeLeadRow(
                                lead = lead,
                                onOpen = { onOpenLead(lead.id) },
                                onCall = { calls.call(lead.id, lead.phoneE164) },
                                onWhatsApp = { openWhatsApp(context, lead.phoneE164) },
                            )
                        }
                        item { Spacer(Modifier.size(88.dp)) }
                    }
                }
            }
        }
    }

    calls.needsNotes?.let { call ->
        val lead = leads?.firstOrNull { it.id == call.leadId }
        AfterCallNotes(sales, library, call, lead?.name ?: call.phone, onDone = { saved ->
            calls.needsNotes = null
            if (saved) scope.launch { snackbar.showSnackbar(savedText) }
        }, awayMs = calls.awayMs)
    }

    if (adding) {
        NewLeadDialog(sales, library, onClose = { id ->
            adding = false
            if (id != null) onOpenLead(id)
        })
    }
}

/** One lead in the list. Swipe right = call, left = WhatsApp; the buttons do the same. */
@Composable
private fun SwipeLeadRow(lead: LeadEntity, onOpen: () -> Unit, onCall: () -> Unit, onWhatsApp: () -> Unit) {
    val state = rememberSwipeToDismissBoxState()
    LaunchedEffect(state.currentValue) {
        when (state.currentValue) {
            SwipeToDismissBoxValue.StartToEnd -> onCall()
            SwipeToDismissBoxValue.EndToStart -> onWhatsApp()
            SwipeToDismissBoxValue.Settled -> return@LaunchedEffect
        }
        state.reset()
    }
    SwipeToDismissBox(
        state = state,
        backgroundContent = {
            val toCall = state.dismissDirection == SwipeToDismissBoxValue.StartToEnd
            Row(
                Modifier.fillMaxSize().background(MaterialTheme.colorScheme.secondaryContainer, MaterialTheme.shapes.medium).padding(horizontal = 20.dp),
                horizontalArrangement = if (toCall) Arrangement.Start else Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(if (toCall) Icons.Outlined.Call else Icons.Outlined.Chat, null)
                Spacer(Modifier.size(8.dp))
                Text(stringResource(if (toCall) R.string.call else R.string.whatsapp))
            }
        },
    ) {
        LeadRow(lead, onOpen, onCall, onWhatsApp)
    }
}

@Composable
fun LeadRow(lead: LeadEntity, onOpen: () -> Unit, onCall: () -> Unit, onWhatsApp: () -> Unit) {
    Surface(
        shape = MaterialTheme.shapes.medium,
        tonalElevation = 1.dp,
        modifier = Modifier.fillMaxWidth().clickable(onClick = onOpen).testTag("lead-${lead.id}"),
    ) {
        Row(Modifier.padding(start = 16.dp, top = 12.dp, bottom = 12.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(lead.name, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    listOfNotNull(lead.phoneE164, stageLabel(lead.stage)).joinToString(" · "),
                    color = Pearl.palette.textSecondary,
                )
                lead.nextFollowupAt?.let { Text(dueText(it), style = MaterialTheme.typography.bodyMedium) }
                if (lead.pending) StatusLabel(stringResource(R.string.not_sent_yet), StatusTone.Info)
            }
            IconButton(onClick = onCall, modifier = Modifier.heightIn(min = 48.dp)) {
                Icon(Icons.Outlined.Call, stringResource(R.string.call))
            }
            IconButton(onClick = onWhatsApp, modifier = Modifier.heightIn(min = 48.dp)) {
                Icon(Icons.Outlined.Chat, stringResource(R.string.whatsapp))
            }
        }
    }
}

/** Saves the notes sheet for a call made from the app. */
@Composable
fun AfterCallNotes(
    sales: SalesRepository,
    library: LibrarySource,
    call: StartedCall,
    leadName: String,
    onDone: (saved: Boolean) -> Unit,
    awayMs: Long = 0,
) {
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    CallNotesSheet(
        leadName = leadName,
        library = library,
        busy = busy,
        onDismiss = { onDone(false) },
        onSave = { input ->
            busy = true
            scope.launch {
                sales.logCall(
                    com.pearl.crm.core.data.CallDraft(
                        leadId = call.leadId,
                        phoneE164 = call.phone,
                        outcome = input.outcome!!,
                        notes = input.notes,
                        next = input.next.toStep(istToday()),
                        startedAt = call.startedAt,
                        durationS = (awayMs / 1000).toInt().coerceIn(0, 4 * 3600),
                        stage = input.stage,
                        lostReasonId = input.lostReason?.id,
                    ),
                )
                busy = false
                onDone(true)
            }
        },
    )
}

/** Field → message for the new lead form. */
fun validateNewLead(name: String, phone: String): Map<String, Int> = buildMap {
    if (name.isBlank()) put("name", R.string.new_lead_name_required)
    if (Phones.normalize(phone) == null) put("phone", R.string.new_lead_phone_invalid)
}

@Composable
private fun NewLeadDialog(sales: SalesRepository, library: LibrarySource, onClose: (String?) -> Unit) {
    var name by rememberSaveable { mutableStateOf("") }
    var phone by rememberSaveable { mutableStateOf("") }
    var treatment by rememberSaveable { mutableStateOf("") }
    var comments by rememberSaveable { mutableStateOf("") }
    var source by remember { mutableStateOf<LibraryItem?>(null) }
    var errors by remember { mutableStateOf<Map<String, Int>>(emptyMap()) }
    var duplicateOf by remember { mutableStateOf<String?>(null) }
    var failure by remember { mutableStateOf<Throwable?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val nameFocus = remember { FocusRequester() }
    val phoneFocus = remember { FocusRequester() }

    LaunchedEffect(phone) {
        duplicateOf = if (Phones.normalize(phone) != null) sales.findByPhone(phone)?.name else null
    }

    Dialog(onDismissRequest = { onClose(null) }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize()) {
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Text(stringResource(R.string.new_lead_title), style = MaterialTheme.typography.titleLarge)
                OutlinedTextField(
                    value = name,
                    onValueChange = {
                        name = it
                        errors = errors - "name"
                    },
                    label = { Text(stringResource(R.string.new_lead_name)) },
                    isError = "name" in errors,
                    supportingText = errors["name"]?.let { { Text(stringResource(it)) } },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth().focusRequester(nameFocus).testTag("new-lead-name"),
                )
                OutlinedTextField(
                    value = phone,
                    onValueChange = {
                        phone = it
                        errors = errors - "phone"
                    },
                    label = { Text(stringResource(R.string.new_lead_phone)) },
                    isError = "phone" in errors,
                    supportingText = errors["phone"]?.let { { Text(stringResource(it)) } },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth().focusRequester(phoneFocus).testTag("new-lead-phone"),
                )
                duplicateOf?.let { StatusLabel(stringResource(R.string.new_lead_duplicate, it), StatusTone.Warning) }
                OutlinedTextField(
                    value = treatment,
                    onValueChange = { treatment = it.take(200) },
                    label = { Text(stringResource(R.string.new_lead_treatment)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                LibraryPicker(
                    kind = LibraryKind.LEAD_SOURCE,
                    value = source,
                    onChange = { source = it },
                    source = library,
                    label = stringResource(R.string.new_lead_source),
                )
                OutlinedTextField(
                    value = comments,
                    onValueChange = { comments = it.take(SalesRepository.MAX_NOTES) },
                    label = { Text(stringResource(R.string.new_lead_comments)) },
                    minLines = 2,
                    modifier = Modifier.fillMaxWidth(),
                )
                failure?.let { StatusLabel(failureMessage(it), StatusTone.Critical) }
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    PearlButton(
                        stringResource(R.string.new_lead_save),
                        Icons.Outlined.Check,
                        busy = busy,
                        onClick = {
                            val found = validateNewLead(name, phone)
                            errors = found
                            when {
                                "name" in found -> nameFocus.requestFocus()
                                "phone" in found -> phoneFocus.requestFocus()
                                else -> {
                                    busy = true
                                    scope.launch {
                                        try {
                                            onClose(sales.createLead(LeadDraft(name, phone, treatment, source?.id, comments)))
                                        } catch (e: Exception) {
                                            failure = e
                                        } finally {
                                            busy = false
                                        }
                                    }
                                }
                            }
                        },
                        modifier = Modifier.testTag("new-lead-save"),
                    )
                    PearlButton(stringResource(R.string.new_lead_cancel), Icons.Outlined.Close, { onClose(null) }, kind = ButtonKind.Quiet)
                }
                Box(Modifier.size(1.dp))
            }
        }
    }
}
