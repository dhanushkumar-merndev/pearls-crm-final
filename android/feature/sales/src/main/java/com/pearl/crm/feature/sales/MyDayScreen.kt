package com.pearl.crm.feature.sales

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import com.pearl.crm.core.ui.components.LocalOnline
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pearl.crm.core.data.SalesRepository
import com.pearl.crm.core.model.CallsOnDay
import com.pearl.crm.core.model.IstDates
import com.pearl.crm.core.model.Money
import com.pearl.crm.core.model.RpcFailure
import com.pearl.crm.core.model.SalesDashboard
import com.pearl.crm.core.model.SalesTarget
import com.pearl.crm.core.model.TargetProgress
import com.pearl.crm.core.ui.charts.ChartPlaceholder
import com.pearl.crm.core.ui.charts.ChartSeries
import com.pearl.crm.core.ui.charts.LegendEntry
import com.pearl.crm.core.ui.charts.PearlChartCard
import com.pearl.crm.core.ui.charts.PearlColumnChart
import com.pearl.crm.core.ui.components.ButtonKind
import com.pearl.crm.core.ui.components.EmptyState
import com.pearl.crm.core.ui.components.LoadingBlock
import com.pearl.crm.core.ui.components.Muted
import com.pearl.crm.core.ui.components.PearlButton
import com.pearl.crm.core.ui.components.PearlCard
import com.pearl.crm.core.ui.components.PearlRefreshBox
import com.pearl.crm.core.ui.components.Section
import com.pearl.crm.core.ui.components.SkeletonBox
import com.pearl.crm.core.ui.components.StatGrid
import com.pearl.crm.core.ui.components.StatusLabel
import com.pearl.crm.core.ui.components.StatusTone
import com.pearl.crm.core.ui.components.failureMessage
import com.pearl.crm.core.ui.theme.Pearl
import com.pearl.crm.core.ui.theme.Spacing
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.ceil
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * Sales "My day": today's numbers (online), the calls chart, and bookings waiting for a yes.
 * Pull down to load the numbers again. Offline / unsent changes show in the banner above every tab.
 */
@Composable
fun MyDayScreen(
    name: String,
    sales: SalesRepository,
    onOpenLead: (String) -> Unit,
) {
    var dashboard by remember { mutableStateOf<SalesDashboard?>(null) }
    var failure by remember { mutableStateOf<Throwable?>(null) }
    val pending by remember { sales.observeNeedsConfirmation() }.collectAsStateWithLifecycle(emptyList())
    val scope = rememberCoroutineScope()

    suspend fun load() {
        try {
            dashboard = sales.dashboard()
            failure = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            failure = e
        }
    }
    LaunchedEffect(Unit) { load() }
    val online = LocalOnline.current
    LaunchedEffect(online) { if (online && failure != null) load() }

    PearlRefreshBox(onRefresh = { load() }, modifier = Modifier.fillMaxSize()) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Spacing.screen),
            verticalArrangement = Arrangement.spacedBy(Spacing.section),
        ) {
            Text(stringResource(R.string.myday_hello, name), style = MaterialTheme.typography.titleLarge)

            val d = dashboard
            when {
                d != null -> TodayTiles(d)
                failure != null -> {
                    val f = failure!!
                    StatusLabel(
                        if (f is RpcFailure.Transient) stringResource(R.string.myday_offline_numbers) else failureMessage(f),
                        if (f is RpcFailure.Transient) StatusTone.Offline else StatusTone.Critical,
                    )
                    PearlButton(stringResource(R.string.myday_refresh), Icons.Outlined.Refresh, { scope.launch { load() } }, kind = ButtonKind.Tonal, small = true)
                }
                // Loading: the tiles' space, so nothing jumps when the numbers arrive.
                else -> LoadingBlock(rows = 1, rowHeight = 64.dp)
            }
            d?.target?.takeIf { it.hasAny }?.let { TargetsSection(it) }
            if (failure == null || d != null) {
                CallsChart(d?.callsPerDay, dailyCallsTarget(d?.target, istToday()))
            }

            Section(stringResource(R.string.myday_confirm_title)) {
                if (pending.isEmpty()) {
                    Muted(stringResource(R.string.myday_confirm_none))
                }
                pending.forEach { row ->
                    val a = row.appointment
                    PearlCard(onClick = a.leadId?.let { id -> { onOpenLead(id) } }) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.m)) {
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Text(row.leadName ?: "—", style = MaterialTheme.typography.titleSmall)
                                Muted(listOfNotNull(row.leadPhone, a.slotStart?.let(IstDates::formatDateTime), a.doctor).joinToString(" · "))
                                if (a.pending) StatusLabel(stringResource(R.string.not_sent_yet), StatusTone.Info)
                            }
                            PearlButton(
                                stringResource(R.string.myday_confirm),
                                Icons.Outlined.Check,
                                { scope.launch { sales.confirmAppointment(a.id) } },
                                kind = ButtonKind.Tonal,
                                small = true,
                            )
                        }
                    }
                }
            }
        }
    }
}

/** Three key numbers as tiles, the rest on one quiet line under them. */
@Composable
private fun TodayTiles(d: SalesDashboard) {
    val t = d.today
    StatGrid(
        listOf(
            stringResource(R.string.myday_calls) to t.calls.toString(),
            stringResource(R.string.myday_connected) to t.connected.toString(),
            stringResource(R.string.myday_due) to t.followupsDue.toString(),
        ),
    )
    Muted(stringResource(R.string.myday_secondary, t.followupsOverdue, t.booked, t.pendingConfirmations), Modifier.testTag("myday-secondary"))
}

/** This month's targets: a meter per metric that has one (the number is written out too). */
@Composable
fun TargetsSection(target: SalesTarget) {
    Section(stringResource(R.string.myday_targets)) {
        PearlCard(verticalSpacing = Spacing.m) {
            TargetRow(stringResource(R.string.myday_target_converted), target.converted) { it.toString() }
            TargetRow(stringResource(R.string.myday_target_agreed), target.agreedPaise, Money::formatInr)
            TargetRow(stringResource(R.string.myday_target_calls), target.calls) { it.toString() }
        }
    }
}

@Composable
private fun TargetRow(label: String, p: TargetProgress, show: (Long) -> String) {
    val target = p.target ?: return
    val text = stringResource(R.string.myday_target_progress, show(p.actual), show(target), p.percent)
    Column(Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}.testTag("target-$label"), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(label, style = MaterialTheme.typography.bodyMedium)
            Text(text, style = MaterialTheme.typography.bodyMedium, color = Pearl.palette.textSecondary)
        }
        LinearProgressIndicator(progress = { p.fraction }, modifier = Modifier.fillMaxWidth().height(6.dp))
    }
}

/**
 * The month's calls target spread over its working days (Monday to Saturday), rounded up.
 * Null when the clinic set no calls target.
 */
fun dailyCallsTarget(target: SalesTarget?, today: LocalDate): Int? {
    val monthly = target?.calls?.target?.takeIf { it > 0 } ?: return null
    val first = target.month?.let { runCatching { LocalDate.parse(it) }.getOrNull() }?.withDayOfMonth(1) ?: today.withDayOfMonth(1)
    val workingDays = (0 until first.lengthOfMonth()).count { first.plusDays(it.toLong()).dayOfWeek != DayOfWeek.SUNDAY }
    return ceil(monthly.toDouble() / workingDays).toInt()
}

/** The server sends the last 14 days (dashboard_sales_exec). */
private const val CHART_DAYS = 14

private val AXIS_DAY = DateTimeFormatter.ofPattern("dd/MM")

private fun parseDay(day: String): LocalDate? = runCatching { LocalDate.parse(day) }.getOrNull()

/** dd/MM under the columns and in the table. */
private fun dayLabel(day: String): String = parseDay(day)?.format(AXIS_DAY) ?: day

/** "Mon 20/10" in the phone's language, for the tap marker. */
private fun dayName(day: String): String =
    parseDay(day)?.format(DateTimeFormatter.ofPattern("EEE dd/MM", Locale.getDefault())) ?: day

/**
 * Calls per day: a card with the total and how many were reached, stacked columns (spoke /
 * not reached) that fit the screen, a dashed daily-target line, and a Table switch for the exact
 * numbers. [days] null = still loading (the chart's space is kept).
 */
@Composable
fun CallsChart(days: List<CallsOnDay>?, dailyTarget: Int? = null) {
    var asTable by rememberSaveable { mutableStateOf(false) }
    if (days == null) {
        PearlCard(verticalSpacing = Spacing.m, modifier = Modifier.testTag("calls-chart-loading")) {
            SkeletonBox(Modifier.width(180.dp).height(40.dp))
            ChartPlaceholder()
        }
        return
    }
    val total = days.sumOf { it.calls }
    val spoke = days.sumOf { it.connected.coerceAtMost(it.calls) }
    if (total == 0) {
        val n = if (days.isEmpty()) CHART_DAYS else days.size
        PearlCard {
            EmptyState(Icons.Outlined.BarChart, pluralStringResource(R.plurals.myday_chart_empty, n, n))
        }
        return
    }
    val percent = spoke * 100 / total
    val headline = pluralStringResource(R.plurals.myday_chart_summary, total, total, percent)
    val spokeLabel = stringResource(R.string.myday_chart_spoke)
    val missedLabel = stringResource(R.string.myday_chart_not_reached)
    val palette = Pearl.palette
    val legend = listOfNotNull(
        LegendEntry(spokeLabel, palette.chartSeries.first()),
        LegendEntry(missedLabel, palette.chartEmphasisGray),
        dailyTarget?.let { LegendEntry(stringResource(R.string.myday_chart_target, it), palette.textSecondary, dashed = true) },
    )
    PearlChartCard(
        headline = headline,
        supporting = pluralStringResource(R.plurals.myday_chart_period, days.size, days.size),
        asTable = asTable,
        onToggleTable = { asTable = !asTable },
        legend = legend,
    ) {
        if (asTable) {
            CallsTable(days)
        } else {
            val labels = remember(days) { days.map { dayLabel(it.day) } }
            val markers = days.map { pluralStringResource(R.plurals.myday_chart_marker, it.calls, dayName(it.day), it.calls, it.connected) }
            val markerText = remember(markers) { { i: Int -> markers.getOrElse(i) { "" } } }
            val stacks = remember(days, palette) {
                listOf(
                    ChartSeries(spokeLabel, days.map { it.connected.coerceAtMost(it.calls) }, palette.chartSeries.first()),
                    ChartSeries(missedLabel, days.map { (it.calls - it.connected).coerceAtLeast(0) }, palette.chartEmphasisGray),
                )
            }
            PearlColumnChart(
                xLabels = labels,
                stacks = stacks,
                markerText = markerText,
                description = stringResource(R.string.myday_chart_description, headline, pluralStringResource(R.plurals.myday_chart_period, days.size, days.size)),
                target = dailyTarget?.toDouble(),
            )
        }
    }
}

/** The same numbers as a table, newest day first. Each row is tagged `chart-row`. */
@Composable
private fun CallsTable(days: List<CallsOnDay>) {
    Column {
        TableRow(stringResource(R.string.myday_chart_col_day), stringResource(R.string.myday_chart_col_calls), stringResource(R.string.myday_chart_spoke), header = true)
        days.asReversed().forEach { d ->
            HorizontalDivider()
            TableRow(dayName(d.day), d.calls.toString(), d.connected.toString(), modifier = Modifier.testTag("chart-row"))
        }
    }
}

@Composable
private fun TableRow(day: String, calls: String, spoke: String, modifier: Modifier = Modifier, header: Boolean = false) {
    val style = if (header) MaterialTheme.typography.labelMedium else MaterialTheme.typography.bodyMedium
    val color = if (header) Pearl.palette.textSecondary else MaterialTheme.colorScheme.onSurface
    Row(modifier.fillMaxWidth().semantics(mergeDescendants = true) {}.padding(vertical = Spacing.s)) {
        Text(day, style = style, color = color, modifier = Modifier.weight(1f))
        Text(calls, style = style, color = color, textAlign = TextAlign.End, modifier = Modifier.weight(0.6f))
        Text(spoke, style = style, color = color, textAlign = TextAlign.End, modifier = Modifier.weight(0.6f))
    }
}
