package com.pearl.crm.feature.bdm

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.People
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pearl.crm.core.data.BdmRepository
import com.pearl.crm.core.data.BdmVisit
import com.pearl.crm.core.data.LeadFilter
import com.pearl.crm.core.data.SalesRepository
import com.pearl.crm.core.model.IstDates
import com.pearl.crm.core.model.LibrarySource
import com.pearl.crm.core.ui.components.EmptyState
import com.pearl.crm.core.ui.components.LoadingBlock
import com.pearl.crm.core.ui.components.Muted
import com.pearl.crm.core.ui.components.PearlCard
import com.pearl.crm.core.ui.components.PearlRefreshBox
import com.pearl.crm.core.ui.components.StatusLabel
import com.pearl.crm.core.ui.components.StatusTone
import com.pearl.crm.core.ui.components.failureMessage
import com.pearl.crm.core.ui.theme.Spacing
import com.pearl.crm.feature.sales.NewLeadDialog
import com.pearl.crm.feature.sales.stageLabel
import java.time.OffsetDateTime
import kotlinx.coroutines.CancellationException

private fun km(m: Int?) = "%.1f".format((m ?: 0) / 1000.0)

private fun time(iso: String?): String? = iso?.let { runCatching { IstDates.formatTime(OffsetDateTime.parse(it).toInstant().toEpochMilli()) }.getOrNull() }

/** Today's visits from the server: km driven next to km expected (online). Pull down to refresh. */
@Composable
fun BdmVisitsScreen(bdm: BdmRepository, staffId: String) {
    var visits by remember { mutableStateOf<List<BdmVisit>?>(null) }
    var failure by remember { mutableStateOf<Throwable?>(null) }
    suspend fun load() {
        try {
            visits = bdm.visitsToday(staffId)
            failure = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            failure = e
        }
    }
    LaunchedEffect(Unit) { load() }
    Column(Modifier.fillMaxSize()) {
        ListTitle(stringResource(R.string.bdm_visits_title))
        PearlRefreshBox(onRefresh = { load() }, modifier = Modifier.weight(1f)) {
            val list = visits
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = Spacing.screen, end = Spacing.screen, bottom = Spacing.screen),
                verticalArrangement = Arrangement.spacedBy(Spacing.item),
            ) {
                failure?.let { f -> item(key = "failure") { StatusLabel(failureMessage(f), StatusTone.Offline) } }
                when {
                    list == null && failure == null -> item(key = "loading") { LoadingBlock(rows = 3, rowHeight = 72.dp) }
                    list.isNullOrEmpty() -> if (list != null) item(key = "empty") { EmptyState(Icons.Outlined.Place, stringResource(R.string.bdm_visits_empty), body = stringResource(R.string.bdm_visits_empty_body)) }
                    else -> items(list, key = { it.id }) { v -> VisitCard(v) }
                }
            }
        }
    }
}

@Composable
private fun VisitCard(v: BdmVisit) {
    PearlCard(verticalSpacing = 2.dp) {
        Text(v.destination, style = MaterialTheme.typography.titleSmall)
        Muted(listOfNotNull(time(v.travelStartedAt), time(v.reachedAt), time(v.completedAt)).joinToString(" → "))
        if (v.reachedAt != null) {
            Text(
                if (v.estimateStatus == "ok") stringResource(R.string.bdm_visit_km, km(v.actualM), km(v.estDistanceM))
                else stringResource(R.string.bdm_visit_km_pending, km(v.actualM)),
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        if (v.flagLongRoute) StatusLabel(stringResource(R.string.bdm_visit_long), StatusTone.Warning)
        StatusLabel(
            stringResource(if (v.completedAt != null) R.string.bdm_visit_done else R.string.bdm_visit_open),
            if (v.completedAt != null) StatusTone.Good else StatusTone.Info,
        )
        v.outcome?.let { Muted(it, maxLines = 3) }
    }
}

@Composable
private fun ListTitle(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.titleLarge,
        modifier = Modifier.padding(start = Spacing.screen, end = Spacing.screen, top = Spacing.screen, bottom = Spacing.s),
    )
}

/** Leads this BDM made (synced to the phone), and a new one. Pull down to sync. */
@Composable
fun BdmLeadsScreen(sales: SalesRepository, library: LibrarySource, onRefresh: suspend () -> Unit = {}) {
    val leads by remember { sales.observeLeads(LeadFilter.All, "") }.collectAsStateWithLifecycle(null)
    var adding by rememberSaveable { mutableStateOf(false) }
    Scaffold(contentWindowInsets = WindowInsets(0), floatingActionButton = {
        val label = stringResource(R.string.bdm_new_lead)
        // Material hides the label from screen readers (cleared semantics): name the button.
        ExtendedFloatingActionButton(
            onClick = { adding = true },
            icon = { Icon(Icons.Outlined.Add, null) },
            text = { Text(label) },
            modifier = Modifier.semantics { contentDescription = label },
        )
    }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            ListTitle(stringResource(R.string.bdm_leads_title))
            PearlRefreshBox(onRefresh = onRefresh, modifier = Modifier.weight(1f)) {
                val list = leads
                LazyColumn(
                    Modifier.fillMaxSize(),
                    // Room under the last row for the New lead button.
                    contentPadding = PaddingValues(start = Spacing.screen, end = Spacing.screen, bottom = 80.dp),
                    verticalArrangement = Arrangement.spacedBy(Spacing.item),
                ) {
                    when {
                        list == null -> item(key = "loading") { LoadingBlock(rows = 4, rowHeight = 56.dp) }
                        list.isEmpty() -> item(key = "empty") {
                            // The floating "New lead" button is already on screen.
                            EmptyState(Icons.Outlined.People, stringResource(R.string.bdm_leads_empty))
                        }
                        else -> items(list, key = { it.id }) { lead ->
                            PearlCard(verticalSpacing = 2.dp) {
                                Text(lead.name, style = MaterialTheme.typography.titleSmall)
                                Muted("${lead.phoneE164} · ${stageLabel(lead.stage)}")
                            }
                        }
                    }
                }
            }
        }
    }
    if (adding) NewLeadDialog(sales, library) { adding = false }
}
