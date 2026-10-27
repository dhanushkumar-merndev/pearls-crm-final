package com.pearl.crm.core.ui.components

import androidx.annotation.StringRes
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.pearl.crm.core.ui.R
import com.pearl.crm.core.ui.theme.Pearl
import com.pearl.crm.core.ui.theme.Spacing
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * A card: the raised token colour with a hairline border (no Material tonal tint, which turns
 * white-ish in the dark theme). [onClick] makes the whole card tappable.
 */
@Composable
fun PearlCard(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    contentPadding: PaddingValues = PaddingValues(Spacing.card),
    verticalSpacing: Dp = Spacing.s,
    color: androidx.compose.ui.graphics.Color = Pearl.palette.raised,
    content: @Composable ColumnScope.() -> Unit,
) {
    val body: @Composable () -> Unit = {
        Column(Modifier.padding(contentPadding), verticalArrangement = Arrangement.spacedBy(verticalSpacing), content = content)
    }
    val shape = MaterialTheme.shapes.medium
    val border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
    if (onClick != null) {
        Surface(onClick = onClick, modifier = modifier.fillMaxWidth(), shape = shape, color = color, border = border, content = body)
    } else {
        Surface(modifier = modifier.fillMaxWidth(), shape = shape, color = color, border = border, content = body)
    }
}

/** A titled block on a screen; [action] sits at the right of the title (e.g. a small "Table" switch). */
@Composable
fun Section(
    title: String,
    modifier: Modifier = Modifier,
    action: (@Composable RowScope.() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(
                title,
                style = MaterialTheme.typography.titleSmall,
                color = Pearl.palette.textSecondary,
                modifier = Modifier.weight(1f).semantics { heading() },
            )
            action?.invoke(this)
        }
        content()
    }
}

/** Secondary text. */
@Composable
fun Muted(text: String, modifier: Modifier = Modifier, maxLines: Int = Int.MAX_VALUE) {
    Text(
        text,
        modifier = modifier,
        color = Pearl.palette.textSecondary,
        style = MaterialTheme.typography.bodyMedium,
        maxLines = maxLines,
        overflow = TextOverflow.Ellipsis,
    )
}

/** A form message under its field, with an error look. [message] is a string resource. */
@Composable
fun FieldError(@StringRes message: Int?, tag: String, vararg args: Any) {
    if (message != null) {
        Text(
            stringResource(message, *args),
            color = MaterialTheme.colorScheme.error,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.testTag(tag),
        )
    }
}

/** A number with its label, for the "today" grids. Put three in a row with `Modifier.weight(1f)`. */
@Composable
fun StatTile(label: String, value: String, modifier: Modifier = Modifier) {
    PearlCard(
        modifier.semantics(mergeDescendants = true) {},
        contentPadding = PaddingValues(horizontal = Spacing.l, vertical = Spacing.m),
        verticalSpacing = 2.dp,
    ) {
        Text(value, style = MaterialTheme.typography.titleLarge, maxLines = 1)
        Text(label, color = Pearl.palette.textSecondary, style = MaterialTheme.typography.bodySmall, maxLines = 2)
    }
}

/** Three tiles to a row, each the same width. */
@Composable
fun StatGrid(tiles: List<Pair<String, String>>, modifier: Modifier = Modifier) {
    FlowRow(
        modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.s),
        verticalArrangement = Arrangement.spacedBy(Spacing.s),
        maxItemsInEachRow = 3,
    ) {
        tiles.forEach { (label, value) -> StatTile(label, value, Modifier.weight(1f)) }
        // Keep a short last row the same width as the others.
        repeat((3 - tiles.size % 3) % 3) { Box(Modifier.weight(1f)) }
    }
}

/** A screen's title bar: back (when given), the title, and [actions] on the right. 48 dp tall. */
@Composable
fun PearlTopBar(
    title: String,
    modifier: Modifier = Modifier,
    onBack: (() -> Unit)? = null,
    subtitle: String? = null,
    actions: @Composable RowScope.() -> Unit = {},
) {
    Row(
        modifier.fillMaxWidth().heightIn(min = 48.dp).padding(start = if (onBack == null) Spacing.screen else 0.dp, end = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (onBack != null) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, stringResource(R.string.common_back)) }
        }
        Column(Modifier.weight(1f)) {
            Text(
                title,
                style = MaterialTheme.typography.titleLarge,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.semantics { heading() },
            )
            subtitle?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Pearl.palette.textSecondary, maxLines = 1) }
        }
        actions()
    }
}

/** What an empty list offers next, e.g. "Show all leads". */
data class EmptyAction(val label: String, val icon: ImageVector, val onClick: () -> Unit)

/** Nothing to show: an icon, a short title, a line of help and (optionally) the next step. */
@Composable
fun EmptyState(icon: ImageVector, title: String, modifier: Modifier = Modifier, body: String? = null, action: EmptyAction? = null) {
    Column(
        modifier.fillMaxWidth().padding(vertical = Spacing.xl, horizontal = Spacing.l).testTag("empty-state"),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.s),
    ) {
        Icon(icon, contentDescription = null, tint = Pearl.palette.textMuted, modifier = Modifier.size(32.dp))
        Text(title, style = MaterialTheme.typography.titleSmall, textAlign = TextAlign.Center)
        body?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = Pearl.palette.textSecondary, textAlign = TextAlign.Center, modifier = Modifier.widthIn(max = 320.dp)) }
        action?.let { PearlButton(it.label, it.icon, it.onClick, kind = ButtonKind.Tonal, small = true, modifier = Modifier.padding(top = Spacing.xs)) }
    }
}

/** A grey placeholder block while something loads (no shimmer: calm, and cheap to draw). */
@Composable
fun SkeletonBox(modifier: Modifier = Modifier) {
    Box(modifier.background(MaterialTheme.colorScheme.surfaceContainerHighest.copy(alpha = 0.5f), MaterialTheme.shapes.small))
}

/** [rows] placeholder rows of [rowHeight], read out as "Loading…". Keeps the screen from jumping. */
@Composable
fun LoadingBlock(modifier: Modifier = Modifier, rows: Int = 3, rowHeight: Dp = 56.dp) {
    val loading = stringResource(R.string.common_loading)
    Column(
        modifier.fillMaxWidth().semantics(mergeDescendants = true) { contentDescription = loading }.testTag("loading"),
        verticalArrangement = Arrangement.spacedBy(Spacing.item),
    ) {
        repeat(rows) { SkeletonBox(Modifier.fillMaxWidth().height(rowHeight)) }
    }
}

/**
 * One row of a list or a menu: optional leading icon, a title, an optional line under it, and
 * a trailing slot (or a chevron when [chevron] and tappable). At least 48 dp tall.
 */
@Composable
fun ListRow(
    title: String,
    modifier: Modifier = Modifier,
    supporting: String? = null,
    icon: ImageVector? = null,
    iconTint: androidx.compose.ui.graphics.Color? = null,
    /** e.g. the "bad" text colour for a row that signs out or deletes. */
    titleColor: androidx.compose.ui.graphics.Color? = null,
    onClick: (() -> Unit)? = null,
    chevron: Boolean = false,
    trailing: (@Composable RowScope.() -> Unit)? = null,
    /** Extra lines under the title (e.g. a status label). */
    below: (@Composable ColumnScope.() -> Unit)? = null,
) {
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = Spacing.l, vertical = Spacing.s),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.l),
    ) {
        icon?.let { Icon(it, contentDescription = null, tint = iconTint ?: Pearl.palette.textSecondary, modifier = Modifier.size(IconSize)) }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, color = titleColor ?: androidx.compose.ui.graphics.Color.Unspecified, maxLines = 2, overflow = TextOverflow.Ellipsis)
            supporting?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Pearl.palette.textSecondary, maxLines = 3, overflow = TextOverflow.Ellipsis) }
            below?.invoke(this)
        }
        trailing?.invoke(this)
        if (chevron && onClick != null) {
            Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, contentDescription = null, tint = Pearl.palette.textMuted, modifier = Modifier.size(IconSize))
        }
    }
}

/**
 * The slim strip above every tab when the phone is offline or changes could not be sent.
 * Always icon + text ([StatusLabel]); [actionLabel] adds a quiet button (e.g. "Open settings").
 */
@Composable
fun SyncBanner(
    text: String,
    tone: StatusTone,
    modifier: Modifier = Modifier,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Row(
        modifier
            .fillMaxWidth()
            .background(Pearl.palette.raised)
            .heightIn(min = 40.dp)
            .padding(start = Spacing.screen, end = Spacing.xs)
            .testTag("sync-banner"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        StatusLabel(text, tone, Modifier.weight(1f).padding(vertical = Spacing.s))
        if (actionLabel != null && onAction != null) {
            TextButton(onClick = onAction) { Text(actionLabel, style = MaterialTheme.typography.labelMedium) }
        }
    }
}

/**
 * Pull down to refresh. [onRefresh] runs once per pull (the spinner shows until it returns);
 * a failure is left to the screen (it shows its own error), the spinner just stops.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PearlRefreshBox(onRefresh: suspend () -> Unit, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = {
            refreshing = true
            scope.launch {
                try {
                    onRefresh()
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                } finally {
                    refreshing = false
                }
            }
        },
        modifier = modifier,
    ) { content() }
}
