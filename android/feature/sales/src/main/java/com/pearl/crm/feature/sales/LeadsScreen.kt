package com.pearl.crm.feature.sales

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.Chat
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.EventAvailable
import androidx.compose.material.icons.outlined.People
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.SearchOff
import androidx.compose.material.icons.outlined.Swipe
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
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
import com.pearl.crm.core.ui.components.EmptyAction
import com.pearl.crm.core.ui.components.EmptyState
import com.pearl.crm.core.ui.components.IconSize
import com.pearl.crm.core.ui.components.LoadingBlock
import com.pearl.crm.core.ui.components.Muted
import com.pearl.crm.core.ui.components.PearlButton
import com.pearl.crm.core.ui.components.PearlCard
import com.pearl.crm.core.ui.components.PearlRefreshBox
import com.pearl.crm.core.ui.components.PearlTopBar
import com.pearl.crm.core.ui.components.StatusLabel
import com.pearl.crm.core.ui.components.StatusTone
import com.pearl.crm.core.ui.components.failureMessage
import com.pearl.crm.core.ui.library.LibraryPicker
import com.pearl.crm.core.ui.theme.Pearl
import com.pearl.crm.core.ui.theme.Spacing
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val FILTER_LABELS = mapOf(
    LeadFilter.Due to R.string.leads_filter_due,
    LeadFilter.All to R.string.leads_filter_all,
    LeadFilter.New to R.string.leads_filter_new,
    LeadFilter.Interested to R.string.leads_filter_interested,
    LeadFilter.Booked to R.string.leads_filter_booked,
)

/** Room under the list for the New lead button, so the last row isn't hidden behind it. */
internal val FabClearance = 80.dp

/**
 * The leads on this phone: search, a filter row, and the list (swipe right = call, left =
 * WhatsApp). [swipeHint] shows the swipe tip (the first time only; [onSwipeHintShown] remembers
 * it). [onRefresh] is the pull-down: a sync with the server.
 */
@Composable
fun LeadsScreen(
    sales: SalesRepository,
    library: LibrarySource,
    onOpenLead: (String) -> Unit,
    modifier: Modifier = Modifier,
    onRefresh: suspend () -> Unit = {},
    swipeHint: Boolean = true,
    onSwipeHintShown: () -> Unit = {},
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
    // Seen once is enough: the tip stays for this visit, then never again.
    val showHint = rememberSaveable { swipeHint }
    LaunchedEffect(Unit) { if (showHint) onSwipeHintShown() }

    Scaffold(
        modifier = modifier,
        contentWindowInsets = WindowInsets(0),
        snackbarHost = { SnackbarHost(snackbar) },
        floatingActionButton = {
            val label = stringResource(R.string.leads_new)
            ExtendedFloatingActionButton(
                onClick = { adding = true },
                icon = { Icon(Icons.Outlined.Add, null) },
                text = { Text(label) },
                // Material hides the label from screen readers (cleared semantics): name the button.
                modifier = Modifier.semantics { contentDescription = label },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            Column(
                Modifier.padding(start = Spacing.screen, end = Spacing.screen, top = Spacing.screen),
                verticalArrangement = Arrangement.spacedBy(Spacing.s),
            ) {
                Text(stringResource(R.string.leads_title), style = MaterialTheme.typography.titleLarge)
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    leadingIcon = { Icon(Icons.Outlined.Search, null, Modifier.size(IconSize)) },
                    trailingIcon = {
                        if (query.isNotEmpty()) {
                            IconButton(onClick = { query = "" }) { Icon(Icons.Outlined.Close, stringResource(R.string.new_lead_cancel)) }
                        }
                    },
                    placeholder = { Text(stringResource(R.string.leads_search)) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    modifier = Modifier.fillMaxWidth().testTag("lead-search"),
                )
            }
            Row(
                Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = Spacing.screen),
                horizontalArrangement = Arrangement.spacedBy(Spacing.s),
            ) {
                LeadFilter.entries.forEach { f ->
                    FilterChip(selected = filter == f, onClick = { filter = f }, label = { Text(stringResource(FILTER_LABELS.getValue(f))) })
                }
            }
            PearlRefreshBox(onRefresh = onRefresh, modifier = Modifier.weight(1f)) {
                val list = leads
                LazyColumn(
                    Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(start = Spacing.screen, end = Spacing.screen, top = Spacing.xs, bottom = FabClearance),
                    verticalArrangement = Arrangement.spacedBy(Spacing.item),
                ) {
                    when {
                        list == null -> item(key = "loading") { LoadingBlock(rows = 4, rowHeight = 64.dp) }
                        list.isEmpty() -> item(key = "empty") {
                            when {
                                query.isNotBlank() -> EmptyState(
                                    Icons.Outlined.SearchOff,
                                    stringResource(R.string.leads_empty_search, query),
                                    action = EmptyAction(stringResource(R.string.leads_clear_search), Icons.Outlined.Close) { query = "" },
                                )
                                filter == LeadFilter.Due -> EmptyState(
                                    Icons.Outlined.EventAvailable,
                                    stringResource(R.string.leads_empty_due),
                                    action = EmptyAction(stringResource(R.string.leads_show_all), Icons.Outlined.People) { filter = LeadFilter.All },
                                )
                                else -> EmptyState(Icons.Outlined.People, stringResource(R.string.leads_empty))
                            }
                        }
                        else -> {
                            if (showHint) item(key = "hint") { SwipeHint() }
                            items(list, key = { it.id }) { lead ->
                                SwipeLeadRow(
                                    lead = lead,
                                    onOpen = { onOpenLead(lead.id) },
                                    onCall = { calls.call(lead.id, lead.phoneE164) },
                                    onWhatsApp = { openWhatsApp(context, lead.phoneE164) },
                                )
                            }
                        }
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

@Composable
private fun SwipeHint() {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.s), modifier = Modifier.padding(vertical = Spacing.xs)) {
        Icon(Icons.Outlined.Swipe, null, tint = Pearl.palette.textMuted, modifier = Modifier.size(18.dp))
        Text(stringResource(R.string.leads_swipe_hint), style = MaterialTheme.typography.bodySmall, color = Pearl.palette.textSecondary)
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
                Modifier.fillMaxSize().background(MaterialTheme.colorScheme.secondaryContainer, MaterialTheme.shapes.medium).padding(horizontal = Spacing.xl),
                horizontalArrangement = if (toCall) Arrangement.Start else Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(if (toCall) Icons.Outlined.Call else Icons.Outlined.Chat, null, Modifier.size(IconSize))
                Spacer(Modifier.width(Spacing.s))
                Text(stringResource(if (toCall) R.string.call else R.string.whatsapp), style = MaterialTheme.typography.labelLarge)
            }
        },
    ) {
        LeadRow(lead, onOpen, onCall, onWhatsApp)
    }
}

@Composable
fun LeadRow(lead: LeadEntity, onOpen: () -> Unit, onCall: () -> Unit, onWhatsApp: () -> Unit) {
    PearlCard(
        onClick = onOpen,
        modifier = Modifier.testTag("lead-${lead.id}"),
        contentPadding = PaddingValues(start = Spacing.l, top = Spacing.m, bottom = Spacing.m, end = Spacing.xs),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(lead.name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    listOfNotNull(lead.phoneE164, stageLabel(lead.stage)).joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall,
                    color = Pearl.palette.textSecondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                lead.nextFollowupAt?.let { Text(dueText(it), style = MaterialTheme.typography.bodySmall) }
                if (lead.pending) StatusLabel(stringResource(R.string.not_sent_yet), StatusTone.Info)
            }
            IconButton(onClick = onCall) { Icon(Icons.Outlined.Call, stringResource(R.string.call), Modifier.size(IconSize)) }
            IconButton(onClick = onWhatsApp) { Icon(Icons.Outlined.Chat, stringResource(R.string.whatsapp), Modifier.size(IconSize)) }
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
    /** From the phone's call log when the caller flow knows the call (real length, its key). */
    durationS: Int? = null,
    direction: String = com.pearl.crm.core.model.CallDirection.OUTGOING,
    deviceCallKey: String? = null,
) {
    val scope = rememberCoroutineScope()
    val voice = LocalVoiceNotes.current
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
                        direction = direction,
                        startedAt = call.startedAt,
                        durationS = (durationS ?: (awayMs / 1000).toInt()).coerceIn(0, 4 * 3600),
                        stage = input.stage,
                        lostReasonId = input.lostReason?.id,
                        deviceCallKey = deviceCallKey,
                    ),
                )
                val clip = input.voiceNote
                if (clip != null && voice != null) voice.recordings.addVoiceNote(call.leadId, clip.file, clip.seconds, lostNote = true)
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

/**
 * The new lead form, full screen. Keyboard "Next" walks name → phone → treatment; Save stays
 * at the bottom above the keyboard.
 */
@Composable
fun NewLeadDialog(sales: SalesRepository, library: LibrarySource, onClose: (String?) -> Unit) {
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
    val focus = LocalFocusManager.current

    LaunchedEffect(phone) {
        duplicateOf = if (Phones.normalize(phone) != null) sales.findByPhone(phone)?.name else null
    }

    fun save() {
        val found = validateNewLead(name, phone)
        errors = found
        when {
            "name" in found -> nameFocus.requestFocus()
            "phone" in found -> phoneFocus.requestFocus()
            else -> {
                busy = true
                scope.launch {
                    try {
                        val id = sales.createLead(LeadDraft(name, phone, treatment, source?.id, comments))
                        // Opening the lead navigates: on the main thread, whatever thread the save came back on.
                        withContext(Dispatchers.Main.immediate) { onClose(id) }
                    } catch (e: Exception) {
                        failure = e
                    } finally {
                        busy = false
                    }
                }
            }
        }
    }

    // Edge to edge: the form draws behind the bars itself and keeps Save above the keyboard.
    Dialog(onDismissRequest = { onClose(null) }, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Surface(Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize().safeDrawingPadding()) {
                PearlTopBar(stringResource(R.string.new_lead_title), modifier = Modifier.padding(top = Spacing.xs))
                Column(
                    Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = Spacing.screen),
                    verticalArrangement = Arrangement.spacedBy(Spacing.m),
                ) {
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
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Next),
                        keyboardActions = KeyboardActions(onNext = { phoneFocus.requestFocus() }),
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
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone, imeAction = ImeAction.Next),
                        keyboardActions = KeyboardActions(onNext = { focus.moveFocus(FocusDirection.Down) }),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth().focusRequester(phoneFocus).testTag("new-lead-phone"),
                    )
                    duplicateOf?.let { StatusLabel(stringResource(R.string.new_lead_duplicate, it), StatusTone.Warning) }
                    OutlinedTextField(
                        value = treatment,
                        onValueChange = { treatment = it.take(200) },
                        label = { Text(stringResource(R.string.new_lead_treatment)) },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { focus.clearFocus() }),
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
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                        minLines = 2,
                        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.l),
                    )
                }
                BottomActionBar {
                    failure?.let { StatusLabel(failureMessage(it), StatusTone.Critical) }
                    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s), verticalAlignment = Alignment.CenterVertically) {
                        PearlButton(
                            stringResource(R.string.new_lead_save),
                            Icons.Outlined.Check,
                            busy = busy,
                            onClick = ::save,
                            modifier = Modifier.weight(1f).testTag("new-lead-save"),
                        )
                        PearlButton(stringResource(R.string.new_lead_cancel), Icons.Outlined.Close, { onClose(null) }, kind = ButtonKind.Quiet)
                    }
                }
            }
        }
    }
}

/** The sticky bottom bar of a form: a hairline on top, then the Save row (and any message). */
@Composable
fun BottomActionBar(content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    Column {
        HorizontalDivider()
        Column(
            Modifier.fillMaxWidth().padding(horizontal = Spacing.screen, vertical = Spacing.m),
            verticalArrangement = Arrangement.spacedBy(Spacing.s),
            content = content,
        )
    }
}
