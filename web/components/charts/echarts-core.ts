// Tree-shaken ECharts: only what dashboards use. Imported lazily by <EChart>, so
// pages without charts never download it (PLAN.md B6).
import { BarChart, GaugeChart, HeatmapChart, LineChart } from "echarts/charts";
import {
  AriaComponent,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";

echarts.use([
  BarChart,
  LineChart,
  HeatmapChart,
  GaugeChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DatasetComponent,
  AriaComponent,
  VisualMapComponent,
  SVGRenderer,
]);

export { echarts };
