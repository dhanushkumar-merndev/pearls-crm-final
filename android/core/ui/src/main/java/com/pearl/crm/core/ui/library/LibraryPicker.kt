package com.pearl.crm.core.ui.library

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.UnfoldMore
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.pearl.crm.core.model.LibraryItem
import com.pearl.crm.core.model.LibrarySource
import com.pearl.crm.core.model.RpcFailure
import com.pearl.crm.core.ui.R
import com.pearl.crm.core.ui.components.MinTouchTarget
import com.pearl.crm.core.ui.components.failureMessage
import com.pearl.crm.core.ui.theme.Pearl
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject

/**
 * The one picker for every library, like the web LibraryCombobox: opens with the 10 most
 * used, searches on the server as you type, "Load 10 more", and — where allowed — "Add
 * '<what you typed>'", which creates the item flagged for the admin's review. Lead sources,
 * lost reasons and other lists also work offline from the phone's synced copy.
 */
@Composable
fun LibraryPicker(
    kind: String,
    value: LibraryItem?,
    onChange: (LibraryItem?) -> Unit,
    source: LibrarySource,
    label: String,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    allowCreate: Boolean = false,
    createDefaults: JsonObject = JsonObject(emptyMap()),
    enabled: Boolean = true,
) {
    var open by rememberSaveable { mutableStateOf(false) }
    Column(
        modifier
            .fillMaxWidth()
            .clickable(enabled = enabled, role = Role.Button) { open = true },
    ) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = Pearl.palette.textSecondary)
        Spacer(Modifier.size(6.dp))
        Surface(
            shape = MaterialTheme.shapes.medium,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 56.dp)
                .alpha(if (enabled) 1f else 0.5f),
        ) {
            Row(Modifier.padding(horizontal = 16.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    value?.label ?: placeholder ?: stringResource(R.string.picker_choose),
                    style = MaterialTheme.typography.bodyLarge,
                    color = if (value == null) Pearl.palette.textMuted else MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Icon(Icons.Outlined.UnfoldMore, contentDescription = null, tint = Pearl.palette.textSecondary)
            }
        }
    }
    if (open) {
        Dialog(onDismissRequest = { open = false }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
            LibrarySearchPanel(
                kind = kind,
                source = source,
                title = label,
                selected = value,
                allowCreate = allowCreate,
                createDefaults = createDefaults,
                onPick = {
                    onChange(it)
                    open = false
                },
                onClose = { open = false },
            )
        }
    }
}

private const val PAGE_SIZE = 10
private const val DEBOUNCE_MS = 250L

/** The full-screen search list inside [LibraryPicker]. */
@Composable
internal fun LibrarySearchPanel(
    kind: String,
    source: LibrarySource,
    title: String,
    selected: LibraryItem?,
    allowCreate: Boolean,
    createDefaults: JsonObject,
    onPick: (LibraryItem?) -> Unit,
    onClose: () -> Unit,
) {
    var query by rememberSaveable { mutableStateOf("") }
    var items by remember { mutableStateOf<List<LibraryItem>>(emptyList()) }
    var nextCursor by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    var loadingMore by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<Throwable?>(null) }
    var createFailure by remember { mutableStateOf<Throwable?>(null) }
    var creating by remember { mutableStateOf(false) }
    var reload by remember { mutableIntStateOf(0) }
    // Bumped by every new search so a late "Load 10 more" can't mix into a newer list.
    var generation by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()
    val focus = remember { FocusRequester() }
    val trimmed = query.trim()

    LaunchedEffect(trimmed, reload) {
        generation++
        loading = true
        failure = null
        createFailure = null
        if (trimmed.isNotEmpty()) delay(DEBOUNCE_MS)
        try {
            val page = source.search(kind, trimmed, null, PAGE_SIZE)
            items = page.items
            nextCursor = page.nextCursor
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            failure = e
            items = emptyList()
            nextCursor = null
        }
        loading = false
    }
    LaunchedEffect(Unit) { focus.requestFocus() }

    fun loadMore() {
        val cursor = nextCursor ?: return
        val forGeneration = generation
        scope.launch {
            loadingMore = true
            try {
                val page = source.search(kind, trimmed, cursor, PAGE_SIZE)
                if (forGeneration == generation) {
                    items = (items + page.items).distinctBy { it.id }
                    nextCursor = page.nextCursor
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failure = e
            } finally {
                loadingMore = false
            }
        }
    }

    fun create() {
        scope.launch {
            creating = true
            createFailure = null
            try {
                onPick(source.create(kind, trimmed, createDefaults))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                createFailure = e
            } finally {
                creating = false
            }
        }
    }

    val exact = items.any { it.label.equals(trimmed, ignoreCase = true) }
    val showCreate = allowCreate && trimmed.isNotEmpty() && !exact && !loading

    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(Modifier.fillMaxSize().statusBarsPadding()) {
            Row(Modifier.padding(start = 4.dp, end = 16.dp, top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onClose, modifier = Modifier.size(MinTouchTarget)) {
                    Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = stringResource(R.string.common_close))
                }
                Text(title, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                placeholder = { Text(stringResource(R.string.picker_search)) },
                leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                trailingIcon = {
                    if (loading) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                },
                singleLine = true,
                textStyle = MaterialTheme.typography.bodyLarge,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp)
                    .focusRequester(focus),
            )
            LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)) {
                if (selected != null) {
                    item(key = "__clear") {
                        PickerAction(stringResource(R.string.picker_clear), Icons.Outlined.Close) { onPick(null) }
                    }
                }
                items(items, key = { it.id }) { item ->
                    ItemRow(item, isSelected = selected?.id == item.id) { onPick(item) }
                }
                if (!loading && failure == null && items.isEmpty() && !showCreate) {
                    item(key = "__nothing") {
                        Text(
                            stringResource(R.string.picker_nothing),
                            color = Pearl.palette.textSecondary,
                            modifier = Modifier.fillMaxWidth().padding(24.dp),
                        )
                    }
                }
                failure?.let { error ->
                    item(key = "__failure") {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(failureMessage(error), color = Pearl.palette.badText)
                            PickerAction(stringResource(R.string.common_try_again), Icons.Outlined.Refresh) { reload++ }
                        }
                    }
                }
                if (nextCursor != null && failure == null) {
                    item(key = "__more") {
                        PickerAction(
                            stringResource(if (loadingMore) R.string.picker_loading else R.string.picker_more),
                            Icons.Outlined.ExpandMore,
                            enabled = !loadingMore,
                        ) { loadMore() }
                    }
                }
                if (showCreate) {
                    item(key = "__create") {
                        PickerAction(stringResource(R.string.picker_add, trimmed), Icons.Outlined.Add, enabled = !creating) { create() }
                        createFailure?.let {
                            Text(
                                if (it is RpcFailure.Transient) stringResource(R.string.picker_add_offline) else failureMessage(it),
                                color = Pearl.palette.badText,
                                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ItemRow(item: LibraryItem, isSelected: Boolean, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .semantics { selected = isSelected }
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(
            Icons.Outlined.Check,
            contentDescription = if (isSelected) stringResource(R.string.picker_selected) else null,
            modifier = Modifier.size(22.dp).alpha(if (isSelected) 1f else 0f),
        )
        Column(Modifier.weight(1f)) {
            Text(item.label, style = MaterialTheme.typography.bodyLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
            item.subtitle?.takeIf { it.isNotBlank() }?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = Pearl.palette.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        if (item.onTheFly) {
            Surface(shape = RoundedCornerShape(50), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)) {
                Text(
                    stringResource(R.string.picker_new),
                    style = MaterialTheme.typography.labelSmall,
                    color = Pearl.palette.textSecondary,
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 2.dp),
                )
            }
        }
    }
}

@Composable
private fun PickerAction(text: String, icon: ImageVector, enabled: Boolean = true, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = MinTouchTarget)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(22.dp), tint = Pearl.palette.link)
        Text(text, style = MaterialTheme.typography.bodyLarge, color = Pearl.palette.link)
    }
}
