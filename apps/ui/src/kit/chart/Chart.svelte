<script lang="ts">
  // The line chart every display uses (spec 5): uPlot on a black plot with labelled axes and grids.
  // Nothing scales with the panel: more width shows more history (the x-range follows the width in cells).
  import uPlot from 'uplot';
  import 'uplot/dist/uPlot.min.css';
  import { DEFAULT_THEME, cssVar, resolveColour, resolveRole } from '../../theme/index.ts';
  import type { Role } from '../../theme/index.ts';
  import type { WidgetSize } from '../types.ts';
  import { buildData, visibleXRange } from './data.ts';
  import type { ChartSeries } from './data.ts';

  type Props = {
    series: ChartSeries[];
    /** Axes are always labelled. */
    xLabel: string;
    yLabel: string;
    /** Both kinds are plain numbers on the axis; the kind is for the caller's labels. */
    x: { kind: 'lap' | 'sessionTime' };
    /** Safety-car and virtual-safety-car periods, painted behind the series. */
    bands?: Array<{ from: number; to: number; kind: 'sc' | 'vsc' }> | undefined;
    size: WidgetSize;
  };
  let { series, xLabel, yLabel, bands, size }: Props = $props();

  const SERIES_ROLES: Role[] = ['series1', 'series2', 'series3', 'series4', 'series5', 'series6'];
  const DASH = [6, 4];

  let host: HTMLDivElement | undefined = $state();

  /** A chart token from the active theme's CSS variable, else the first theme's value. */
  function token(root: Element, name: string, fallback: number): number {
    const v = parseFloat(cssVar(root, name));
    return Number.isFinite(v) ? v : fallback;
  }

  $effect(() => {
    if (!host) return;
    const el = host;
    const root = document.documentElement;
    const tokens = DEFAULT_THEME.chart;
    const lineWidth = token(root, '--pw-chart-line', tokens.lineWidth);
    const ownWidth = token(root, '--pw-chart-own-line', tokens.ownCarLineWidth);
    const staleAlpha = token(root, '--pw-chart-stale-alpha', tokens.staleAlpha);
    const font = `${cssVar(root, '--pw-font-px')} ${cssVar(root, '--pw-font')}`;
    const grid = resolveRole(el, 'grid');
    const axis = { stroke: resolveRole(el, 'textDim'), font, labelFont: font, grid: { stroke: grid }, ticks: { stroke: grid } };

    let plain = 0;
    const lines = series.map((s) => ({
      label: s.label,
      stroke: s.colour ? resolveColour(el, s.colour.colour) : resolveRole(el, SERIES_ROLES[plain++ % SERIES_ROLES.length] ?? 'series1'),
      width: s.colour?.ownCar ? ownWidth : lineWidth,
      ...(s.colour?.dashed ? { dash: DASH } : {}),
      alpha: s.fresh === false ? staleAlpha : 1,
      spanGaps: true,
      points: { show: false },
    }));

    const data = buildData(series);
    const bandFill = resolveRole(el, 'bgBand');
    const bandList = bands ?? [];
    const cols = size.cols;

    const plot = new uPlot(
      {
        width: size.px.width,
        height: size.px.height,
        legend: { show: false },
        cursor: { show: false },
        scales: { x: { time: false, range: (_u, min, max) => visibleXRange(data[0] as number[], cols, min, max) } },
        axes: [{ ...axis, label: xLabel }, { ...axis, label: yLabel }],
        series: [{}, ...lines],
        hooks: {
          drawClear: bandList.length
            ? [
                (u) => {
                  u.ctx.save();
                  u.ctx.fillStyle = bandFill;
                  for (const b of bandList) {
                    const left = u.valToPos(b.from, 'x', true);
                    u.ctx.fillRect(left, u.bbox.top, u.valToPos(b.to, 'x', true) - left, u.bbox.height);
                  }
                  u.ctx.restore();
                },
              ]
            : [],
        },
      },
      data as uPlot.AlignedData,
      el,
    );
    return () => plot.destroy();
  });
</script>

<div class="chart" style:background-color="var(--pw-bg)" bind:this={host}></div>

<style>
  .chart {
    display: block;
  }
</style>
