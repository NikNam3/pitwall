<script lang="ts">
  // The line chart every display uses (spec 5): uPlot on a black plot with labelled axes and grids.
  // Nothing scales with the panel: more width shows more history (the x-range follows the width in cells).
  import { untrack } from 'svelte';
  import uPlot from 'uplot';
  import 'uplot/dist/uPlot.min.css';
  import { DEFAULT_THEME, cssVar, resolveColour, resolveRole } from '../../theme/index.ts';
  import type { Role } from '../../theme/index.ts';
  import type { WidgetSize } from '../types.ts';
  import { buildData, clipBands, visibleXRange } from './data.ts';
  import type { ChartSeries, PhaseBand } from './data.ts';

  type Props = {
    series: ChartSeries[];
    /** Axes are always labelled. */
    xLabel: string;
    yLabel: string;
    /** Both kinds are plain numbers on the axis; the kind is for the caller's labels. */
    x: { kind: 'lap' | 'sessionTime' };
    /** Safety-car, virtual-safety-car and red-flag periods, painted behind the series (clipped to the visible range). */
    bands?: PhaseBand[] | undefined;
    size: WidgetSize;
    /** Formats the y axis tick values; the default prints the plain numbers. */
    yFormat?: ((v: number) => string) | undefined;
    /** Called after every draw of the plot (the gallery marks its cell ready on the first). */
    ondraw?: (() => void) | undefined;
  };
  let { series, xLabel, yLabel, x, bands, size, yFormat, ondraw }: Props = $props();

  const SERIES_ROLES: Role[] = ['series1', 'series2', 'series3', 'series4', 'series5', 'series6'];

  let host: HTMLDivElement | undefined = $state();
  let plot: uPlot | undefined;
  let applied = { width: 0, height: 0 };
  let cols = 0;
  let xs: number[] = [];

  /** A chart token from the active theme's CSS variable, else the default theme's value. */
  function token(root: Element, name: string, fallback: number): number {
    const v = parseFloat(cssVar(root, name));
    return Number.isFinite(v) ? v : fallback;
  }

  /** What changes the look of the plot but not its data or size: a change rebuilds the plot. */
  const structure = $derived(
    JSON.stringify([series.map((s) => [s.label, s.colour, s.fresh]), bands, xLabel, yLabel, x.kind]),
  );

  // Structural effect: builds the plot. Data and size changes are handled below on the same instance.
  $effect(() => {
    void structure;
    if (!host) return;
    const el = host;
    untrack(() => {
      const root = document.documentElement;
      const tokens = DEFAULT_THEME.chart;
      const lineWidth = token(root, '--pw-chart-line', tokens.lineWidth);
      const ownWidth = token(root, '--pw-chart-own-line', tokens.ownCarLineWidth);
      const staleAlpha = token(root, '--pw-chart-stale-alpha', tokens.staleAlpha);
      const dashVar = cssVar(root, '--pw-chart-dash').split(/\s+/).map(Number).filter(Number.isFinite);
      const dash = dashVar.length > 0 ? dashVar : tokens.dash;
      const xPerCell = {
        lap: token(root, '--pw-chart-x-lap', tokens.xPerCell.lap),
        sessionTime: token(root, '--pw-chart-x-session', tokens.xPerCell.sessionTime),
      };
      const font = `${cssVar(root, '--pw-font-px')} ${cssVar(root, '--pw-font')}`;
      const grid = resolveRole(el, 'grid');
      const axis = { stroke: resolveRole(el, 'textDim'), font, labelFont: font, grid: { stroke: grid }, ticks: { stroke: grid } };

      let plain = 0;
      const lines = series.map((s) => ({
        label: s.label,
        stroke: s.colour ? resolveColour(el, s.colour.colour) : resolveRole(el, SERIES_ROLES[plain++ % SERIES_ROLES.length] ?? 'series1'),
        width: s.colour?.ownCar ? ownWidth : lineWidth,
        ...(s.colour?.dashed ? { dash } : {}),
        alpha: s.fresh === false ? staleAlpha : 1,
        spanGaps: true,
        points: { show: false },
      }));

      const data = buildData(series);
      xs = data[0] as number[];
      cols = size.cols;
      applied = { width: size.px.width, height: size.px.height };
      const bandFill = resolveRole(el, 'bgBand');
      const redFill = resolveRole(el, 'flagRed');
      const bandList = bands ?? [];

      plot = new uPlot(
        {
          width: size.px.width,
          height: size.px.height,
          legend: { show: false },
          cursor: { show: false },
          scales: { x: { time: false, range: () => visibleXRange(xs, cols, x.kind, xPerCell) } },
          axes: [{ ...axis, label: xLabel }, { ...axis, label: yLabel, ...(yFormat ? { values: (_u: uPlot, splits: number[]) => splits.map(yFormat) } : {}) }],
          series: [{}, ...lines],
          hooks: {
            draw: [() => ondraw?.()],
            drawClear: bandList.length
              ? [
                  (u) => {
                    u.ctx.save();
                    for (const b of clipBands(bandList, visibleXRange(xs, cols, x.kind, xPerCell))) {
                      u.ctx.fillStyle = b.kind === 'red' ? redFill : bandFill;
                      u.ctx.globalAlpha = b.kind === 'red' ? 0.3 : 1;
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
    });
    return () => {
      plot?.destroy();
      plot = undefined;
    };
  });

  // Data effect: new points go to the same plot.
  $effect(() => {
    const data = buildData(series);
    xs = data[0] as number[];
    plot?.setData(data as uPlot.AlignedData);
  });

  // Size effect: a new size resizes the same plot; the x-range follows the width, so the scales are recomputed.
  $effect(() => {
    const { width, height } = size.px;
    cols = size.cols;
    if (plot && (width !== applied.width || height !== applied.height)) {
      applied = { width, height };
      plot.setSize({ width, height });
      plot.setData(buildData(untrack(() => series)) as uPlot.AlignedData);
    }
  });
</script>

<div class="chart" style:background-color="var(--pw-bg)" bind:this={host}></div>

<style>
  .chart {
    display: block;
  }
</style>
