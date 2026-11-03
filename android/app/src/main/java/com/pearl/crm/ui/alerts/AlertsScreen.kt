package com.pearl.crm.ui.alerts

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.DoneAll
import androidx.compose.material.icons.outlined.NotificationsNone
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pearl.crm.AppContainer
import com.pearl.crm.BuildConfig
import com.pearl.crm.R
import com.pearl.crm.core.data.Alert
import com.pearl.crm.core.model.IstDates
import com.pearl.crm.core.ui.components.ButtonKind
import com.pearl.crm.core.ui.components.EmptyState
import com.pearl.crm.core.ui.components.LoadingBlock
import com.pearl.crm.core.ui.components.Muted
import com.pearl.crm.core.ui.components.PearlButton
import com.pearl.crm.core.ui.components.PearlCard
import com.pearl.crm.core.ui.components.PearlRefreshBox
import com.pearl.crm.core.ui.components.PearlLazyColumn
import com.pearl.crm.core.ui.components.StatusLabel
import com.pearl.crm.core.ui.components.StatusTone
import com.pearl.crm.core.ui.components.failureMessage
import com.pearl.crm.core.ui.theme.Spacing
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * Reception and admin on the phone: their alerts, newest first (online; a push reloads it).
 * Tapping one marks it read and shows "Open on web" for its page.
 */
@Composable
fun AlertsScreen(container: AppContainer) {
    var alerts by remember { mutableStateOf<List<Alert>?>(null) }
    var failure by remember { mutableStateOf<Throwable?>(null) }
    var open by remember { mutableStateOf<String?>(null) }
    val pushes by container.alertsChanged.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val uri = LocalUriHandler.current

    suspend fun load() {
        try {
            alerts = container.account.alerts()
            failure = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            failure = e
        }
    }
    fun markRead(ids: List<String>?) {
        alerts = alerts?.map { if (ids == null || it.id in ids) it.copy(read = true) else it }
        scope.launch { runCatching { container.account.markAlertsRead(ids) } }
    }
    LaunchedEffect(pushes) { load() }

    AlertsContent(
        alerts = alerts,
        failure = failure?.let { failureMessage(it) },
        open = open,
        onRefresh = { load() },
        onMarkAll = { markRead(null) },
        onOpen = { a ->
            open = if (open == a.id) null else a.id
            if (!a.read) markRead(listOf(a.id))
        },
        onOpenWeb = { uri.openUri(it) },
    )
}

@Composable
internal fun AlertsContent(
    alerts: List<Alert>?,
    failure: String?,
    open: String?,
    onRefresh: suspend () -> Unit,
    onMarkAll: () -> Unit,
    onOpen: (Alert) -> Unit,
    onOpenWeb: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var headerHeight by remember { mutableIntStateOf(0) }
    val headerSpace = with(LocalDensity.current) { headerHeight.toDp() } + Spacing.item
    PearlRefreshBox(onRefresh = onRefresh, modifier = Modifier.fillMaxSize()) {
        val list = alerts
        PearlLazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = Spacing.screen, end = Spacing.screen, top = Spacing.screen, bottom = Spacing.xl),
            verticalArrangement = Arrangement.spacedBy(Spacing.item),
            emptyContentOffset = headerSpace,
        ) { emptyModifier ->
            item(key = "header") {
                Column(
                    Modifier.fillMaxWidth().onSizeChanged { headerHeight = it.height },
                    verticalArrangement = Arrangement.spacedBy(Spacing.l),
                ) {
                    Text(stringResource(R.string.alerts_title), style = MaterialTheme.typography.headlineSmall)
                    Muted(stringResource(R.string.alerts_intro))
                    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
                        PearlButton(stringResource(R.string.alerts_refresh), Icons.Outlined.Refresh, { scope.launch { onRefresh() } }, kind = ButtonKind.Tonal, small = true)
                        if (alerts.orEmpty().any { !it.read }) {
                            PearlButton(stringResource(R.string.alerts_mark_all), Icons.Outlined.DoneAll, onMarkAll, kind = ButtonKind.Secondary, small = true)
                        }
                    }
                    failure?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                }
            }
            when {
                list == null && failure == null -> item(key = "loading") { LoadingBlock(rows = 3) }
                list != null && list.isEmpty() -> item(key = "empty") {
                    EmptyState(Icons.Outlined.NotificationsNone, stringResource(R.string.alerts_empty), emptyModifier, body = stringResource(R.string.alerts_empty_body))
                }
                list != null -> items(list, key = { it.id }) { a ->
                    AlertCard(
                        alert = a,
                        expanded = open == a.id,
                        onClick = { onOpen(a) },
                        onOpenWeb = webUrl(a.link)?.let { url -> { onOpenWeb(url) } },
                    )
                }
            }
        }
    }
}

@Composable
private fun AlertCard(alert: Alert, expanded: Boolean, onClick: () -> Unit, onOpenWeb: (() -> Unit)?) {
    PearlCard(onClick = onClick, modifier = Modifier.testTag("alert-${alert.id}")) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
            Text(
                alert.title,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = if (alert.read) FontWeight.Normal else FontWeight.SemiBold,
                modifier = Modifier.weight(1f),
            )
            if (!alert.read) StatusLabel(stringResource(R.string.alerts_new), StatusTone.Info)
        }
        alert.body?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodyMedium, maxLines = if (expanded) Int.MAX_VALUE else 2) }
        alert.createdAt?.let { Muted(IstDates.formatDateTime(it)) }
        if (expanded && onOpenWeb != null) {
            PearlButton(stringResource(R.string.alerts_open_web), Icons.AutoMirrored.Outlined.OpenInNew, onOpenWeb, kind = ButtonKind.Tonal, small = true)
            Muted(stringResource(R.string.alerts_web_hint))
        }
    }
}

/** The alert's page on the live web app; null when the build has no web address or the alert no page. */
private fun webUrl(link: String?): String? {
    val base = BuildConfig.WEB_URL.trimEnd('/')
    if (base.isBlank() || link.isNullOrBlank() || !link.startsWith("/")) return null
    return base + link
}
