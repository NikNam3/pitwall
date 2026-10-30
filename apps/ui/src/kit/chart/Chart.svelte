<script lang="ts">
  // The line chart every display uses (spec 5): uPlot on a black plot with labelled axes and grids; each line is named at
  // its right end in its colour (our car bold), labels pushed apart where lines end close together; when they cannot all
  // fit, ours and the ones nearest to ours keep theirs. A line that ends well before the newest x (a retired or lapped
  // car) is named at its own end instead, inside the plot. A line of one point shows as a dot. A series' live end is drawn dotted (`ChartSeries.liveEnd`): every series has
  // its live line, empty when not live, so a live end that comes or goes is a data change, never a rebuild.
  // Nothing scales with the panel: more width shows more history (the x-range follows the width in cells).
  import { untrack } from 'svelte';
  import uPlot from 'uplot';
  import 'uplot/dist/uPlot.min.css';
  import { DEFAULT_THEME, cssNumber, cssVar, resolveColour, resolveRole } from '../../theme/index.ts';
  import type { Role } from '../../theme/index.ts';
  import { cellBox } from '../size/size.ts';
  import type { WidgetSize } from '../types.ts';
  import { buildData, clipBands, plotLines, visibleXRange } from './data.ts';
  import type { ChartSeries, PhaseBand } from './data.ts';
  import { earlyLabelLeft, endLabels, endsEarly, placeLabels } from './labels.ts';
  import type { EndLabel } from './labels.ts';

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

  /** A dash pattern token (px on, px off) from the theme's CSS variable at `el`, else the default theme's value. */
  function dashToken(el: Element, name: string, fallback: number[]): number[] {
    const v = cssVar(el, name).split(/\s+/).filter((t) => t !== '').map(Number).filter(Number.isFinite);
    return v.length > 0 ? v : fallback;
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
      // Every token is read at the chart's own element: a theme set on an ancestor (a gallery cell, a panel) counts.
      const tokens = DEFAULT_THEME.chart;
      const lineWidth = cssNumber(el, '--pw-chart-line', tokens.lineWidth);
      const ownWidth = cssNumber(el, '--pw-chart-own-line', tokens.ownCarLineWidth);
      const staleAlpha = cssNumber(el, '--pw-chart-stale-alpha', tokens.staleAlpha);
      const redAlpha = cssNumber(el, '--pw-chart-red-alpha', tokens.redBandAlpha);
      const dash = dashToken(el, '--pw-chart-dash', tokens.dash);
      const liveDash = dashToken(el, '--pw-chart-live-dash', tokens.liveDash);
      const xPerCell = {
        lap: cssNumber(el, '--pw-chart-x-lap', tokens.xPerCell.lap),
        sessionTime: cssNumber(el, '--pw-chart-x-session', tokens.xPerCell.sessionTime),
      };
      const font = `${cssVar(el, '--pw-font-px')} ${cssVar(el, '--pw-font')}`;
      const fontPx = cssNumber(el, '--pw-font-px', DEFAULT_THEME.fontPx);
      const boldWeight = cssNumber(el, '--pw-weight-bold', DEFAULT_THEME.table.boldWeight);
      // The labels sit one column gap right of the plot; the plot leaves room for the gap and the longest label.
      const cellPx = cellBox(fontPx, DEFAULT_THEME.density.lineHeight).width;
      const labelGapPx = cssNumber(el, '--pw-col-gap-cols', DEFAULT_THEME.density.columnGapCols) * cellPx;
      const labelRoomPx = labelGapPx + cellPx * series.reduce((m, s) => Math.max(m, s.label.length), 0);
      const grid = resolveRole(el, 'grid');
      const axis = { stroke: resolveRole(el, 'textDim'), font, labelFont: font, grid: { stroke: grid }, ticks: { stroke: grid } };

      // A line of one point has no segment to draw (a settled point at the end of lap 1, or a live point before it), so
      // it shows as a dot of its stroke; a line of more points shows none.
      const onePoint = (u: uPlot, i: number): boolean => (u.data[i] ?? []).filter((v) => v !== null && v !== undefined).length === 1;
      let plain = 0;
      const lines = series.map((s) => {
        const stroke = s.colour ? resolveColour(el, s.colour.colour) : resolveRole(el, SERIES_ROLES[plain++ % SERIES_ROLES.length] ?? 'series1');
        const width = s.colour?.ownCar ? ownWidth : lineWidth;
        return {
          label: s.label,
          stroke,
          width,
          ...(s.colour?.dashed ? { dash } : {}),
          alpha: s.fresh === false ? staleAlpha : 1,
          spanGaps: true,
          points: { show: onePoint, size: 2 * width, fill: stroke, stroke },
        };
      });

      const plotted = plotLines(series);
      // The live lines follow the series' own lines, in their look but dotted.
      const liveLines = plotted.flatMap((p) => {
        const line = p.live ? lines[p.of] : undefined;
        return line ? [{ ...line, dash: liveDash }] : [];
      });
      const data = buildData(plotted);
      xs = data[0] as number[];
      cols = size.cols;
      applied = { width: size.px.width, height: size.px.height };
      const bandFill = resolveRole(el, 'bgBand');
      const redFill = resolveRole(el, 'flagRed');
      const bandList = bands ?? [];

      /**
       * Paints each line's label: right of the plot at its end, or, for a line that ends early, one gap right of its own
       * end but never past the plot's right edge, so it stays clear of the column (canvas px: scaled by the canvas' pixel
       * ratio).
       */
      const drawLabels = (u: uPlot): void => {
        const ratio = uPlot.pxRatio;
        const rowPx = fontPx * ratio;
        const range = visibleXRange(xs, cols, x.kind, xPerCell);
        const labels = endLabels(untrack(() => series), range);
        const early = labels.filter((l) => endsEarly(l, range, x.kind));
        const column = labels.filter((l) => !endsEarly(l, range, x.kind));
        const ys = placeLabels(column.map((l) => u.valToPos(l.value, 'y', true) - u.bbox.top), rowPx, u.bbox.height, column.map((l) => l.bold));
        const plotRight = u.bbox.left + u.bbox.width;
        const columnLeft = plotRight + labelGapPx * ratio;
        /** Draws the label at the left `leftOf` gives for its width in the label font. */
        const draw = (l: EndLabel, leftOf: (widthPx: number) => number, y: number): void => {
          const line = lines[l.index];
          if (!line) return;
          u.ctx.font = `${l.bold ? `${boldWeight} ` : ''}${rowPx}px ${cssVar(el, '--pw-font')}`;
          u.ctx.fillStyle = line.stroke;
          u.ctx.globalAlpha = line.alpha;
          u.ctx.fillText(l.text, leftOf(u.ctx.measureText(l.text).width), y);
        };
        u.ctx.save();
        u.ctx.textAlign = 'left';
        u.ctx.textBaseline = 'middle';
        column.forEach((l, i) => {
          const y = ys[i];
          if (y !== undefined) draw(l, () => columnLeft, u.bbox.top + y);
        });
        for (const l of early) {
          const endPx = u.valToPos(l.x, 'x', true);
          draw(l, (widthPx) => earlyLabelLeft(endPx, labelGapPx * ratio, widthPx, plotRight), u.valToPos(l.value, 'y', true));
        }
        u.ctx.restore();
      };

      plot = new uPlot(
        {
          width: size.px.width,
          height: size.px.height,
          legend: { show: false },
          padding: [null, labelRoomPx, null, null],
          cursor: { show: false },
          scales: { x: { time: false, range: () => visibleXRange(xs, cols, x.kind, xPerCell) } },
          axes: [{ ...axis, label: xLabel }, { ...axis, label: yLabel, ...(yFormat ? { values: (_u: uPlot, splits: number[]) => splits.map(yFormat) } : {}) }],
          series: [{}, ...lines, ...liveLines],
          hooks: {
            draw: [drawLabels, () => ondraw?.()],
            drawClear: bandList.length
              ? [
                  (u) => {
                    u.ctx.save();
                    for (const b of clipBands(bandList, visibleXRange(xs, cols, x.kind, xPerCell))) {
                      u.ctx.fillStyle = b.kind === 'red' ? redFill : bandFill;
                      u.ctx.globalAlpha = b.kind === 'red' ? redAlpha : 1;
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
    const data = buildData(plotLines(series));
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
      plot.setData(buildData(plotLines(untrack(() => series))) as uPlot.AlignedData);
    }
  });
</script>

<div class="chart" style:background-color="var(--pw-bg)" bind:this={host}></div>

<style>
  .chart {
    display: block;
  }
</style>
