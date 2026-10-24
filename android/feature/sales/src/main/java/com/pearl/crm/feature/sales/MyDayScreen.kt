package com.pearl.crm.feature.sales

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.TableRows
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.patrykandpatrick.vico.compose.cartesian.CartesianChartHost
import com.patrykandpatrick.vico.compose.cartesian.axis.HorizontalAxis
import com.patrykandpatrick.vico.compose.cartesian.axis.VerticalAxis
import com.patrykandpatrick.vico.compose.cartesian.data.CartesianChartModelProducer
import com.patrykandpatrick.vico.compose.cartesian.data.CartesianValueFormatter
import com.patrykandpatrick.vico.compose.cartesian.data.columnSeries
import com.patrykandpatrick.vico.compose.cartesian.layer.rememberColumnCartesianLayer
import com.patrykandpatrick.vico.compose.cartesian.rememberCartesianChart
import com.patrykandpatrick.vico.compose.common.ProvideVicoTheme
import com.patrykandpatrick.vico.compose.m3.common.rememberM3VicoTheme
import com.pearl.crm.core.data.SalesRepository
import com.pearl.crm.core.model.CallsOnDay
import com.pearl.crm.core.model.IstDates
import com.pearl.crm.core.model.RpcFailure
import com.pearl.crm.core.model.SalesDashboard
import com.pearl.crm.core.ui.components.ButtonKind
import com.pearl.crm.core.ui.components.PearlButton
import com.pearl.crm.core.ui.components.StatusLabel
import com.pearl.crm.core.ui.components.StatusTone
import com.pearl.crm.core.ui.components.failureMessage
import com.pearl.crm.core.ui.theme.Pearl
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** Sales "My day": today's numbers (online), the calls chart, and bookings waiting for a yes. */
@Composable
fun MyDayScreen(
    name: String,
    sales: SalesRepository,
    offline: Boolean,
    hasFailedChanges: Boolean,
    onOpenLead: (String) -> Unit,
) {
    var dashboard by remember { mutableStateOf<SalesDashboard?>(null) }
    var failure by remember { mutableStateOf<Throwable?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    val pending by remember { sales.observeNeedsConfirmation() }.collectAsStateWithLifecycle(emptyList())
    val scope = rememberCoroutineScope()

    LaunchedEffect(reload) {
        try {
            dashboard = sales.dashboard()
            failure = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            failure = e
        }
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(stringResource(R.string.myday_hello, name), style = MaterialTheme.typography.titleLarge)
        if (hasFailedChanges) StatusLabel(stringResource(R.string.myday_unsent_failed), StatusTone.Critical)
        if (offline) StatusLabel(stringResource(R.string.myday_offline), StatusTone.Offline)

        val d = dashboard
        when {
            d != null -> {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Tile(stringResource(R.string.myday_calls), d.today.calls)
                    Tile(stringResource(R.string.myday_connected), d.today.connected)
                    Tile(stringResource(R.string.myday_due), d.today.followupsDue)
                    Tile(stringResource(R.string.myday_overdue), d.today.followupsOverdue)
                    Tile(stringResource(R.string.myday_booked), d.today.booked)
                    Tile(stringResource(R.string.myday_pending), d.today.pendingConfirmations)
                }
                CallsChart(d.callsPerDay)
            }
            failure is RpcFailure.Transient -> Muted(stringResource(R.string.myday_offline_numbers))
            failure != null -> StatusLabel(failureMessage(failure!!), StatusTone.Critical)
        }
        if (failure != null) {
            PearlButton(stringResource(R.string.myday_refresh), Icons.Outlined.Refresh, { reload++ }, kind = ButtonKind.Secondary)
        }

        Section(stringResource(R.string.myday_confirm_title)) {
            if (pending.isEmpty()) Muted(stringResource(R.string.myday_confirm_none))
            pending.forEach { row ->
                val a = row.appointment
                Surface(
                    shape = MaterialTheme.shapes.medium,
                    tonalElevation = 1.dp,
                    modifier = Modifier.fillMaxWidth().clickable(enabled = a.leadId != null) { a.leadId?.let(onOpenLead) },
                ) {
                    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(row.leadName ?: "—", style = MaterialTheme.typography.titleMedium)
                            row.leadPhone?.let { Text(it) }
                            Text(
                                listOfNotNull(a.slotStart?.let(IstDates::formatDateTime), a.doctor).joinToString(" · "),
                                color = Pearl.palette.textSecondary,
                            )
                            if (a.pending) Muted(stringResource(R.string.not_sent_yet))
                        }
                        PearlButton(
                            stringResource(R.string.myday_confirm),
                            Icons.Outlined.Check,
                            { scope.launch { sales.confirmAppointment(a.id) } },
                            kind = ButtonKind.Secondary,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun Tile(label: String, value: Int) {
    Surface(shape = MaterialTheme.shapes.medium, tonalElevation = 1.dp, modifier = Modifier.widthIn(min = 150.dp)) {
        Column(Modifier.padding(12.dp)) {
            Text(label, color = Pearl.palette.textSecondary, style = MaterialTheme.typography.bodyMedium)
            Text(value.toString(), style = MaterialTheme.typography.headlineSmall)
        }
    }
}

/** dd/MM labels under the columns. */
private fun dayLabel(day: String): String = day.split('-').let { if (it.size == 3) "${it[2]}/${it[1]}" else day }

/** Calls per day, columns (Vico), with a "Show as table" switch for reading exact numbers. */
@Composable
fun CallsChart(days: List<CallsOnDay>) {
    var asTable by rememberSaveable { mutableStateOf(false) }
    Section(stringResource(R.string.myday_chart)) {
        PearlButton(
            stringResource(if (asTable) R.string.myday_chart_chart else R.string.myday_chart_table),
            if (asTable) Icons.Outlined.BarChart else Icons.Outlined.TableRows,
            { asTable = !asTable },
            kind = ButtonKind.Quiet,
        )
        if (asTable || days.isEmpty()) {
            days.forEach { d ->
                Text(stringResource(R.string.myday_chart_row, dayLabel(d.day), d.calls, d.connected), modifier = Modifier.testTag("chart-row"))
            }
        } else {
            val producer = remember { CartesianChartModelProducer() }
            LaunchedEffect(days) {
                producer.runTransaction { columnSeries { series(days.map { it.calls }) } }
            }
            val labels = days.map { dayLabel(it.day) }
            val bottom = CartesianValueFormatter { _, x, _ -> labels.getOrNull(x.toInt()) ?: "" }
            val summary = days.joinToString { "${dayLabel(it.day)} ${it.calls}" }
            ProvideVicoTheme(rememberM3VicoTheme()) {
                CartesianChartHost(
                    rememberCartesianChart(
                        rememberColumnCartesianLayer(),
                        startAxis = VerticalAxis.rememberStart(),
                        bottomAxis = HorizontalAxis.rememberBottom(valueFormatter = bottom),
                    ),
                    producer,
                    Modifier.fillMaxWidth().height(220.dp).semantics { contentDescription = summary },
                )
            }
        }
    }
}
