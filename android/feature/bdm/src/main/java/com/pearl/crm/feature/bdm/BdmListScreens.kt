package com.pearl.crm.feature.bdm

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pearl.crm.core.data.BdmRepository
import com.pearl.crm.core.data.BdmVisit
import com.pearl.crm.core.data.LeadFilter
import com.pearl.crm.core.data.SalesRepository
import com.pearl.crm.core.model.IstDates
import com.pearl.crm.core.model.LibrarySource
import com.pearl.crm.core.ui.components.ButtonKind
import com.pearl.crm.core.ui.components.PearlButton
import com.pearl.crm.core.ui.components.StatusLabel
import com.pearl.crm.core.ui.components.StatusTone
import com.pearl.crm.core.ui.components.failureMessage
import com.pearl.crm.core.ui.theme.Pearl
import com.pearl.crm.feature.sales.NewLeadDialog
import com.pearl.crm.feature.sales.stageLabel
import kotlinx.coroutines.CancellationException
import java.time.OffsetDateTime

private fun km(m: Int?) = "%.1f".format((m ?: 0) / 1000.0)

private fun time(iso: String?): String? = iso?.let { runCatching { IstDates.formatTime(OffsetDateTime.parse(it).toInstant().toEpochMilli()) }.getOrNull() }

/** Today's visits from the server: km driven next to km expected (online). */
@Composable
fun BdmVisitsScreen(bdm: BdmRepository, staffId: String) {
    var visits by remember { mutableStateOf<List<BdmVisit>?>(null) }
    var failure by remember { mutableStateOf<Throwable?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    LaunchedEffect(reload) {
        try {
            visits = bdm.visitsToday(staffId)
            failure = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            failure = e
        }
    }
    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(stringResource(R.string.bdm_visits_title), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 16.dp))
        failure?.let { StatusLabel(failureMessage(it), StatusTone.Offline) }
        PearlButton(stringResource(R.string.bdm_refresh), Icons.Outlined.Refresh, { reload++ }, kind = ButtonKind.Quiet)
        val list = visits
        if (list != null && list.isEmpty()) Text(stringResource(R.string.bdm_visits_empty), color = Pearl.palette.textSecondary)
        if (!list.isNullOrEmpty()) {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.weight(1f)) {
                items(list, key = { it.id }) { v ->
                    Surface(shape = MaterialTheme.shapes.medium, tonalElevation = 1.dp, modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(v.destination, style = MaterialTheme.typography.titleMedium)
                            Text(listOfNotNull(time(v.travelStartedAt), time(v.reachedAt), time(v.completedAt)).joinToString(" → "), color = Pearl.palette.textSecondary)
                            if (v.reachedAt != null) {
                                Text(
                                    if (v.estimateStatus == "ok") stringResource(R.string.bdm_visit_km, km(v.actualM), km(v.estDistanceM))
                                    else stringResource(R.string.bdm_visit_km_pending, km(v.actualM)),
                                )
                            }
                            if (v.flagLongRoute) StatusLabel(stringResource(R.string.bdm_visit_long), StatusTone.Warning)
                            StatusLabel(
                                stringResource(if (v.completedAt != null) R.string.bdm_visit_done else R.string.bdm_visit_open),
                                if (v.completedAt != null) StatusTone.Good else StatusTone.Info,
                            )
                            v.outcome?.let { Text(it, color = Pearl.palette.textSecondary, maxLines = 3) }
                        }
                    }
                }
            }
        }
    }
}

/** Leads this BDM made (synced to the phone), and a new one. */
@Composable
fun BdmLeadsScreen(sales: SalesRepository, library: LibrarySource) {
    val leads by remember { sales.observeLeads(LeadFilter.All, "") }.collectAsStateWithLifecycle(null)
    var adding by rememberSaveable { mutableStateOf(false) }
    Scaffold(floatingActionButton = {
        ExtendedFloatingActionButton(onClick = { adding = true }, icon = { Icon(Icons.Outlined.Add, null) }, text = { Text(stringResource(R.string.bdm_new_lead)) })
    }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(stringResource(R.string.bdm_leads_title), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 16.dp))
            val list = leads
            if (list != null && list.isEmpty()) Text(stringResource(R.string.bdm_leads_empty), color = Pearl.palette.textSecondary)
            if (!list.isNullOrEmpty()) {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.weight(1f)) {
                    items(list, key = { it.id }) { lead ->
                        Surface(shape = MaterialTheme.shapes.medium, tonalElevation = 1.dp, modifier = Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(12.dp)) {
                                Text(lead.name, style = MaterialTheme.typography.titleMedium)
                                Text("${lead.phoneE164} · ${stageLabel(lead.stage)}", color = Pearl.palette.textSecondary)
                            }
                        }
                    }
                    item { Spacer(Modifier.size(88.dp)) }
                }
            }
        }
    }
    if (adding) NewLeadDialog(sales, library) { adding = false }
}
