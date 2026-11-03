package com.pearl.crm.core.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import com.pearl.crm.core.ui.R
import com.pearl.crm.core.ui.theme.Spacing

const val ListPageSize = 50

/** Bounded local pages: every cached row remains reachable, including offline. */
@Composable
fun PageControls(page: Int, hasNext: Boolean, onPrevious: () -> Unit, onNext: () -> Unit) {
    if (page == 0 && !hasNext) return
    Row(
        Modifier.fillMaxWidth().padding(vertical = Spacing.s),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PearlButton(stringResource(R.string.common_previous_page), Icons.AutoMirrored.Outlined.ArrowBack, onPrevious, enabled = page > 0, kind = ButtonKind.Quiet, small = true, modifier = Modifier.testTag("previous-page"))
        Text(stringResource(R.string.common_page_number, page + 1))
        PearlButton(stringResource(R.string.common_next_page), Icons.AutoMirrored.Outlined.ArrowForward, onNext, enabled = hasNext, kind = ButtonKind.Quiet, small = true, modifier = Modifier.testTag("next-page"))
    }
}
