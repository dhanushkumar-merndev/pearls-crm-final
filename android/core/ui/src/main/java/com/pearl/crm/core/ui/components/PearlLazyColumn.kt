package com.pearl.crm.core.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * A list whose empty message fills the usable viewport, but can grow and scroll when text
 * is large or the keyboard leaves little room. [emptyContentOffset] is space used by any
 * scrollable header; the supplied empty modifier belongs on the empty-state item only.
 */
@Composable
fun PearlLazyColumn(
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(0.dp),
    verticalArrangement: Arrangement.Vertical = Arrangement.Top,
    emptyContentOffset: Dp = 0.dp,
    state: LazyListState = rememberLazyListState(),
    content: LazyListScope.(emptyModifier: Modifier) -> Unit,
) {
    val viewportHeight = remember { mutableIntStateOf(0) }
    // Only the empty item reads this size, during measurement. Populated lists avoid a
    // BoxWithConstraints subcomposition, and resizing never recomposes every row.
    val emptyModifier = Modifier.layout { measurable, constraints ->
        val padding = contentPadding.calculateTopPadding() + contentPadding.calculateBottomPadding() + emptyContentOffset
        val minHeight = (viewportHeight.intValue - padding.roundToPx()).coerceAtLeast(constraints.minHeight).coerceAtMost(constraints.maxHeight)
        val placeable = measurable.measure(constraints.copy(minHeight = minHeight))
        layout(placeable.width, placeable.height) { placeable.place(0, 0) }
    }
    LazyColumn(modifier.onSizeChanged { viewportHeight.intValue = it.height }, state = state, contentPadding = contentPadding, verticalArrangement = verticalArrangement) {
        content(emptyModifier)
    }
}
