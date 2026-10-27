package com.pearl.crm.core.ui.charts

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.TableRows
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.patrykandpatrick.vico.compose.cartesian.CartesianChartHost
import com.patrykandpatrick.vico.compose.cartesian.Zoom
import com.patrykandpatrick.vico.compose.cartesian.axis.HorizontalAxis
import com.patrykandpatrick.vico.compose.cartesian.axis.VerticalAxis
import com.patrykandpatrick.vico.compose.cartesian.axis.rememberAxisGuidelineComponent
import com.patrykandpatrick.vico.compose.cartesian.axis.rememberAxisLabelComponent
import com.patrykandpatrick.vico.compose.cartesian.axis.rememberAxisLineComponent
import com.patrykandpatrick.vico.compose.cartesian.data.CartesianChartModelProducer
import com.patrykandpatrick.vico.compose.cartesian.data.CartesianLayerRangeProvider
import com.patrykandpatrick.vico.compose.cartesian.data.CartesianValueFormatter
import com.patrykandpatrick.vico.compose.cartesian.data.ColumnCartesianLayerModel
import com.patrykandpatrick.vico.compose.cartesian.data.columnSeries
import com.patrykandpatrick.vico.compose.cartesian.data.lineSeries
import com.patrykandpatrick.vico.compose.cartesian.decoration.HorizontalLine
import com.patrykandpatrick.vico.compose.cartesian.layer.ColumnCartesianLayer
import com.patrykandpatrick.vico.compose.cartesian.layer.LineCartesianLayer
import com.patrykandpatrick.vico.compose.cartesian.layer.rememberColumnCartesianLayer
import com.patrykandpatrick.vico.compose.cartesian.layer.rememberLine
import com.patrykandpatrick.vico.compose.cartesian.layer.rememberLineCartesianLayer
import com.patrykandpatrick.vico.compose.cartesian.marker.CartesianMarkerController
import com.patrykandpatrick.vico.compose.cartesian.marker.DefaultCartesianMarker
import com.patrykandpatrick.vico.compose.cartesian.marker.rememberDefaultCartesianMarker
import com.patrykandpatrick.vico.compose.cartesian.rememberCartesianChart
import com.patrykandpatrick.vico.compose.cartesian.rememberVicoScrollState
import com.patrykandpatrick.vico.compose.cartesian.rememberVicoZoomState
import com.patrykandpatrick.vico.compose.common.DashedShape
import com.patrykandpatrick.vico.compose.common.Fill
import com.patrykandpatrick.vico.compose.common.Insets
import com.patrykandpatrick.vico.compose.common.ProvideVicoTheme
import com.patrykandpatrick.vico.compose.common.component.LineComponent
import com.patrykandpatrick.vico.compose.common.component.ShapeComponent
import com.patrykandpatrick.vico.compose.common.component.rememberLineComponent
import com.patrykandpatrick.vico.compose.common.component.rememberShapeComponent
import com.patrykandpatrick.vico.compose.common.component.rememberTextComponent
import com.patrykandpatrick.vico.compose.common.data.ExtraStore
import com.patrykandpatrick.vico.compose.m3.common.rememberM3VicoTheme
import com.pearl.crm.core.ui.R
import com.pearl.crm.core.ui.components.PearlCard
import com.pearl.crm.core.ui.components.SkeletonBox
import com.pearl.crm.core.ui.theme.Pearl
import com.pearl.crm.core.ui.theme.Spacing
import kotlin.math.ceil
import kotlin.math.max

/** Chart plot height (compact size); the space is kept while loading so nothing jumps. */
val ChartHeight = 170.dp

/** One stacked part of each column (or one line): its name for the legend, values and colour. */
data class ChartSeries(val name: String, val values: List<Number>, val color: Color)

/** A legend entry; [dashed] draws a dashed line instead of a swatch (target lines). */
data class LegendEntry(val label: String, val color: Color, val dashed: Boolean = false)

/**
 * The y scale for whole-number data: the smallest "nice" step (1, 2, 5, 10, 20…) that needs at
 * most four steps, and the top it reaches. Returns (step, top); the top is at least one step.
 */
fun chartScale(max: Double): Pair<Double, Double> {
    val highest = if (max.isNaN()) 1.0 else max.coerceAtLeast(1.0)
    var magnitude = 1.0
    while (true) {
        for (nice in doubleArrayOf(1.0, 2.0, 5.0)) {
            val step = nice * magnitude
            val steps = ceil(highest / step)
            if (steps <= 4) return step to step * steps
        }
        magnitude *= 10
    }
}

/**
 * The card around a chart: a headline number (e.g. "142 calls · 61% spoke"), a quiet line under
 * it ("Last 14 days"), a small Chart/Table switch on the right, then the chart or table and the
 * legend. Charts always offer the table (CLAUDE.md: every chart has "View as table").
 */
@Composable
fun PearlChartCard(
    headline: String,
    supporting: String,
    asTable: Boolean,
    onToggleTable: () -> Unit,
    modifier: Modifier = Modifier,
    legend: List<LegendEntry> = emptyList(),
    showToggle: Boolean = true,
    content: @Composable ColumnScope.() -> Unit,
) {
    // The chart surface token (the page colour), so grid lines read the same as on the web charts.
    PearlCard(modifier, contentPadding = PaddingValues(Spacing.card), verticalSpacing = Spacing.m, color = Pearl.palette.page) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f).semantics(mergeDescendants = true) {}) {
                Text(headline, style = MaterialTheme.typography.headlineSmall, modifier = Modifier.testTag("chart-headline"))
                Text(supporting, style = MaterialTheme.typography.bodySmall, color = Pearl.palette.textSecondary)
            }
            if (showToggle) {
                val label = stringResource(if (asTable) R.string.chart_show_chart else R.string.chart_show_table)
                val description = stringResource(if (asTable) R.string.chart_show_chart_description else R.string.chart_show_table_description)
                TextButton(
                    onClick = onToggleTable,
                    contentPadding = PaddingValues(horizontal = Spacing.m),
                    modifier = Modifier.heightIn(min = 36.dp).semantics { contentDescription = description }.testTag("chart-toggle"),
                ) {
                    Icon(if (asTable) Icons.Outlined.BarChart else Icons.Outlined.TableRows, null, Modifier.size(18.dp))
                    Text(label, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(start = Spacing.xs))
                }
            }
        }
        content()
        if (legend.isNotEmpty() && !asTable) ChartLegend(legend)
    }
}

/** Small swatches with labels, under the plot. */
@Composable
fun ChartLegend(items: List<LegendEntry>, modifier: Modifier = Modifier) {
    FlowRow(modifier, horizontalArrangement = Arrangement.spacedBy(Spacing.l), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        items.forEach { item ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                if (item.dashed) {
                    Canvas(Modifier.width(14.dp).height(10.dp)) {
                        drawLine(
                            item.color,
                            Offset(0f, size.height / 2),
                            Offset(size.width, size.height / 2),
                            strokeWidth = 1.5.dp.toPx(),
                            pathEffect = PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 2.dp.toPx())),
                        )
                    }
                } else {
                    Box(Modifier.size(10.dp).background(item.color, RoundedCornerShape(2.dp)))
                }
                Text(item.label, style = MaterialTheme.typography.labelSmall, color = Pearl.palette.textSecondary)
            }
        }
    }
}

/** The plot's space while the numbers load. */
@Composable
fun ChartPlaceholder(modifier: Modifier = Modifier) {
    SkeletonBox(modifier.fillMaxWidth().height(ChartHeight))
}

@Composable
private fun axisLabel() = rememberAxisLabelComponent(
    style = TextStyle(color = Pearl.palette.chartLabel, fontSize = 11.sp),
)

/** Dashed 1 dp grid lines in the chart grid colour. */
@Composable
private fun gridLine() = rememberAxisGuidelineComponent(
    fill = Fill(Pearl.palette.chartGrid),
    thickness = 1.dp,
    shape = remember { DashedShape(dashLength = 4.dp, gapLength = 4.dp) },
)

/** Start axis: no line or ticks, dashed guidelines, whole numbers every [step]. */
@Composable
private fun startAxis(step: Double) = VerticalAxis.rememberStart(
    line = null,
    label = axisLabel(),
    valueFormatter = remember { CartesianValueFormatter.decimal(decimalCount = 0) },
    tick = null,
    guideline = gridLine(),
    itemPlacer = remember(step) { VerticalAxis.ItemPlacer.step({ step }) },
)

/** Bottom axis: a thin baseline, every [labelEvery]th label, always including the last (today). */
@Composable
private fun bottomAxis(labels: List<String>, labelEvery: Int) = HorizontalAxis.rememberBottom(
    line = rememberAxisLineComponent(fill = Fill(Pearl.palette.chartAxis), thickness = 1.dp),
    label = axisLabel(),
    valueFormatter = remember(labels) { CartesianValueFormatter { _, x, _ -> labels.getOrNull(x.toInt()).orEmpty() } },
    tick = null,
    guideline = null,
    itemPlacer = remember(labels.size, labelEvery) {
        val every = labelEvery.coerceAtLeast(1)
        HorizontalAxis.ItemPlacer.aligned(spacing = { every }, offset = { (labels.size - 1).coerceAtLeast(0) % every })
    },
)

/** The tap marker: a small rounded label ("Mon 20/10 · 12 calls · 7 spoke") and a dashed guide. */
@Composable
private fun marker(text: (Int) -> String, indicatorColor: Color? = null): DefaultCartesianMarker {
    val label = rememberTextComponent(
        style = TextStyle(color = MaterialTheme.colorScheme.onSurface, fontSize = 12.sp),
        padding = Insets(Spacing.s, Spacing.xs, Spacing.s, Spacing.xs),
        background = rememberShapeComponent(
            fill = Fill(MaterialTheme.colorScheme.surfaceContainerHighest),
            shape = MaterialTheme.shapes.small,
            strokeFill = Fill(MaterialTheme.colorScheme.outline),
            strokeThickness = 1.dp,
        ),
    )
    val formatter = remember(text) { DefaultCartesianMarker.ValueFormatter { _, targets -> text(targets.first().x.toInt()) } }
    val surface = MaterialTheme.colorScheme.surface
    return rememberDefaultCartesianMarker(
        label = label,
        valueFormatter = formatter,
        labelPosition = DefaultCartesianMarker.LabelPosition.Top,
        indicator = indicatorColor?.let { c -> { _: Color -> ShapeComponent(Fill(c), CircleShape, strokeFill = Fill(surface), strokeThickness = 2.dp) } },
        indicatorSize = 10.dp,
        guideline = rememberAxisGuidelineComponent(fill = Fill(Pearl.palette.chartAxis), thickness = 1.dp),
    )
}

/**
 * Stacked columns, one per x (e.g. a day), that always fit the width: no sideways scrolling or
 * zoom, so 14 days fit a 360 dp phone. [stacks] are drawn bottom-up; only the top part of each
 * column gets the rounded corners. [target] adds a dashed line (e.g. the daily calls target).
 * [markerText] is shown when a column is tapped; [description] is read by screen readers.
 */
@Composable
fun PearlColumnChart(
    xLabels: List<String>,
    stacks: List<ChartSeries>,
    markerText: (Int) -> String,
    description: String,
    modifier: Modifier = Modifier,
    target: Double? = null,
    labelEvery: Int = 2,
    height: Dp = ChartHeight,
) {
    val totals = remember(stacks) { xLabels.indices.map { i -> stacks.sumOf { it.values.getOrNull(i)?.toDouble() ?: 0.0 } } }
    val (step, top) = remember(totals, target) { chartScale(max(totals.maxOrNull() ?: 0.0, target ?: 0.0)) }
    val producer = remember { CartesianChartModelProducer() }
    LaunchedEffect(stacks) {
        producer.runTransaction { columnSeries { stacks.forEach { series(it.values) } } }
    }
    val rounded = RoundedCornerShape(topStart = 4.dp, topEnd = 4.dp)
    val tops = stacks.map { rememberLineComponent(fill = Fill(it.color), thickness = 14.dp, shape = rounded) }
    val flats = stacks.map { rememberLineComponent(fill = Fill(it.color), thickness = 14.dp, shape = RectangleShape) }
    val columns = remember(tops, flats, stacks) {
        object : ColumnCartesianLayer.ColumnProvider {
            override fun getColumn(entry: ColumnCartesianLayerModel.Entry, seriesIndex: Int, extraStore: ExtraStore): LineComponent {
                // The highest part with a value at this x is the visible top: round only that one.
                val x = entry.x.toInt()
                val topIndex = stacks.indices.lastOrNull { (stacks[it].values.getOrNull(x)?.toDouble() ?: 0.0) > 0.0 }
                return if (seriesIndex == topIndex) tops[seriesIndex] else flats[seriesIndex]
            }

            override fun getWidestSeriesColumn(seriesIndex: Int, extraStore: ExtraStore) = tops[seriesIndex]
        }
    }
    val targetLine = rememberLineComponent(
        fill = Fill(Pearl.palette.textSecondary),
        thickness = 1.5.dp,
        shape = remember { DashedShape(dashLength = 6.dp, gapLength = 4.dp) },
    )
    val decorations = remember(target, targetLine) { target?.let { t -> listOf(HorizontalLine(y = { t }, line = targetLine)) }.orEmpty() }
    ProvideVicoTheme(rememberM3VicoTheme(columnCartesianLayerColors = stacks.map { it.color }, lineColor = Pearl.palette.chartAxis, textColor = Pearl.palette.chartLabel)) {
        CartesianChartHost(
            rememberCartesianChart(
                rememberColumnCartesianLayer(
                    columnProvider = columns,
                    columnCollectionSpacing = Spacing.s,
                    mergeMode = { ColumnCartesianLayer.MergeMode.Stacked },
                    rangeProvider = remember(top) { CartesianLayerRangeProvider.fixed(minY = 0.0, maxY = top) },
                ),
                startAxis = startAxis(step),
                bottomAxis = bottomAxis(xLabels, labelEvery),
                marker = marker(markerText),
                decorations = decorations,
                markerController = CartesianMarkerController.rememberToggleOnTap(),
            ),
            producer,
            modifier.fillMaxWidth().height(height).semantics { contentDescription = description }.testTag("column-chart"),
            scrollState = rememberVicoScrollState(scrollEnabled = false),
            zoomState = rememberVicoZoomState(zoomEnabled = false, initialZoom = Zoom.Content),
            placeholder = { ChartPlaceholder() },
        )
    }
}

/**
 * A smooth line with a soft gradient under it (for trends: money per month, leads per week…).
 * Same axes, marker and fit-to-width rules as [PearlColumnChart].
 */
@Composable
fun PearlLineChart(
    xLabels: List<String>,
    values: List<Number>,
    markerText: (Int) -> String,
    description: String,
    modifier: Modifier = Modifier,
    color: Color = Pearl.palette.chartSeries.first(),
    labelEvery: Int = 2,
    height: Dp = ChartHeight,
) {
    val (step, top) = remember(values) { chartScale(values.maxOfOrNull { it.toDouble() } ?: 0.0) }
    val producer = remember { CartesianChartModelProducer() }
    LaunchedEffect(values) {
        producer.runTransaction { lineSeries { series(values) } }
    }
    val area = remember(color) {
        LineCartesianLayer.AreaFill.single(Fill(Brush.verticalGradient(listOf(color.copy(alpha = 0.32f), color.copy(alpha = 0f)))))
    }
    val line = LineCartesianLayer.rememberLine(
        fill = remember(color) { LineCartesianLayer.LineFill.single(Fill(color)) },
        stroke = LineCartesianLayer.LineStroke.Continuous(thickness = 2.dp, cap = StrokeCap.Round),
        areaFill = area,
        interpolator = remember { LineCartesianLayer.Interpolator.cubic() },
    )
    ProvideVicoTheme(rememberM3VicoTheme(lineCartesianLayerColors = listOf(color), lineColor = Pearl.palette.chartAxis, textColor = Pearl.palette.chartLabel)) {
        CartesianChartHost(
            rememberCartesianChart(
                rememberLineCartesianLayer(
                    lineProvider = LineCartesianLayer.LineProvider.series(line),
                    rangeProvider = remember(top) { CartesianLayerRangeProvider.fixed(minY = 0.0, maxY = top) },
                ),
                startAxis = startAxis(step),
                bottomAxis = bottomAxis(xLabels, labelEvery),
                marker = marker(markerText, indicatorColor = color),
                markerController = CartesianMarkerController.rememberToggleOnTap(),
            ),
            producer,
            modifier.fillMaxWidth().height(height).semantics { contentDescription = description }.testTag("line-chart"),
            scrollState = rememberVicoScrollState(scrollEnabled = false),
            zoomState = rememberVicoZoomState(zoomEnabled = false, initialZoom = Zoom.Content),
            placeholder = { ChartPlaceholder() },
        )
    }
}
