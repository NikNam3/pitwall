<script lang="ts">
  // The line chart every display uses (spec 5): uPlot on a black plot with labelled axes and grids; each line is named at
  // its right end in its colour (our car bold), labels pushed apart where lines end close together; when they cannot all
  // fit, ours and the ones nearest to ours keep theirs. A line that ends well before the newest x (a retired or lapped
  // car) is named at its own end instead, inside the plot. A line of one point shows as a dot. A series' live end is
  // drawn dotted (`ChartSeries.liveEnd`): every series has its live line, empty when not live, so a live end that comes
  // or goes is a data change, never a rebuild.
  // Point marks (`marks`: dots, rings, dotted rings in their roles) are painted over the lines and a series' ±sd band
  // (`ChartSeries.band`) under them, translucent in its colour; neither is a uPlot series. A pinned mark never widens the
  // y range and is drawn at the plot's edge when off-scale.
  // Nothing scales with the panel: more width shows more history (the x-range follows the width in cells); a tyre-age
  // axis shows the whole stint.
  import { untrack } from 'svelte';
  import uPlot from 'uplot';
  import 'uplot/dist/uPlot.min.css';
  import { DEFAULT_THEME, cssNumber, cssVar, resolveColour, resolveRole } from '../../theme/index.ts';
  import type { Role } from '../../theme/index.ts';
  import { cellBox } from '../size/size.ts';
  import type { WidgetSize } from '../types.ts';
  import { bandOutline, buildData, clipBands, plotLines, visibleXRange, yExtent } from './data.ts';
  import type { ChartMark, ChartSeries, PhaseBand, XKind } from './data.ts';
  import { earlyLabelLeft, endLabels, endsEarly, fitAxisLabel, placeLabels } from './labels.ts';
  import type { AxisLabel, EndLabel } from './labels.ts';

  type Props = {
    series: ChartSeries[];
    /**
     * Each axis label is drawn in the longest of its forms that fits the plot's length along its axis, or not at all
     * when none fits; give a short form that fits the compact size.
     */
    xLabel: AxisLabel;
    yLabel: AxisLabel;
    /**
     * Every kind is plain numbers on the axis. Laps and session time follow the width (more width, more history); a tyre
     * age runs from 0 to one lap past the oldest age, ticked in whole laps.
     */
    x: { kind: XKind };
    /** Point marks over the lines (no uPlot series). */
    marks?: ChartMark[] | undefined;
    /** Safety-car, virtual-safety-car and red-flag periods, painted behind the series (clipped to the visible range). */
    bands?: PhaseBand[] | undefined;
    size: WidgetSize;
    /** Formats the y axis tick values; the default prints the plain numbers. */
    yFormat?: ((v: number) => string) | undefined;
    /**
     * The y axis' tick steps, in y units, smallest first: give steps the format can tell apart (`TENTH_STEPS_MS` for a
     * time to tenths); the default is uPlot's (1, 2, 2.5, 5 per decade).
     */
    ySteps?: readonly number[] | undefined;
    /** Called after every draw of the plot (the gallery marks its cell ready on the first). */
    ondraw?: (() => void) | undefined;
  };
  let { series, xLabel, yLabel, x, marks, bands, size, yFormat, ySteps, ondraw }: Props = $props();

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

  /** Whole laps: the tyre-age axis' tick steps. */
  const WHOLE_LAPS = [1, 2, 4, 5, 10, 20, 25, 50, 100];

  /** uPlot's default y gutter (CSS px): a chart whose tick labels fit it keeps it. */
  const Y_GUTTER_PX = 50;

  /** What uPlot holds of an axis at run time: its tick font as drawn (canvas px) first, its tick length and gap. */
  type DrawnAxis = { font: readonly [string, ...unknown[]]; ticks: { show?: boolean; size: number }; gap: number };

  /**
   * The y gutter (CSS px): the tick, the gap and the widest tick label, measured in the tick font as uPlot draws it, so
   * no label leaves the canvas; never narrower than uPlot's default.
   */
  const yGutter = (u: uPlot, values: string[] | null, i: number): number => {
    const axis = u.axes[i] as unknown as DrawnAxis | undefined;
    if (!axis || !values || values.length === 0) return Y_GUTTER_PX;
    u.ctx.save();
    u.ctx.font = axis.font[0];
    const widest = values.reduce((m, v) => Math.max(m, u.ctx.measureText(String(v ?? '')).width), 0) / uPlot.pxRatio;
    u.ctx.restore();
    return Math.max(Y_GUTTER_PX, Math.ceil((axis.ticks.show === false ? 0 : axis.ticks.size) + axis.gap + widest));
  };

  /** The x of the marks: they widen the x data so the plot has data where only marks are. */
  const markXs = (): number[] => (untrack(() => marks) ?? []).map((m) => m.x);

  /**
   * What changes the look of the plot but not its data or size: a change rebuilds the plot. Whether there are marks or
   * bands decides the y range's function, so it is structure; the marks and bands themselves are data.
   */
  const structure = $derived(
    JSON.stringify([
      series.map((s) => [s.label, s.colour, s.fresh, s.band !== undefined]),
      (marks ?? []).length > 0,
      bands,
      ySteps,
      xLabel,
      yLabel,
      x.kind,
    ]),
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
      const markRadius = cssNumber(el, '--pw-chart-mark-r', tokens.markRadius);
      const ringRadius = cssNumber(el, '--pw-chart-ring-r', tokens.ringRadius);
      const ringWidth = cssNumber(el, '--pw-chart-ring-width', tokens.ringWidth);
      const ringDash = dashToken(el, '--pw-chart-ring-dash', tokens.ringDash);
      const bandAlpha = cssNumber(el, '--pw-chart-band-alpha', tokens.bandAlpha);
      const font = `${cssVar(el, '--pw-font-px')} ${cssVar(el, '--pw-font')}`;
      const fontPx = cssNumber(el, '--pw-font-px', DEFAULT_THEME.fontPx);
      const boldWeight = cssNumber(el, '--pw-weight-bold', DEFAULT_THEME.table.boldWeight);
      // The labels sit one column gap right of the plot; the plot leaves room for the gap and the longest label.
      const cellPx = cellBox(fontPx, DEFAULT_THEME.density.lineHeight).width;
      const labelGapPx = cssNumber(el, '--pw-col-gap-cols', DEFAULT_THEME.density.columnGapCols) * cellPx;
      const labelRoomPx = labelGapPx + cellPx * series.reduce((m, s) => Math.max(m, s.label.length), 0);
      const grid = resolveRole(el, 'grid');
      const axis = { stroke: resolveRole(el, 'textDim'), font, labelFont: font, grid: { stroke: grid }, ticks: { stroke: grid } };
      // Each axis label is the form that fits the plot's length along its axis at draw time (canvas px), so it never clips:
      // uPlot has set the axis' label font on its context (rounded at the pixel ratio), so each form is measured as drawn.
      const labelForms = (forms: AxisLabel, along: 'width' | 'height') => (u: uPlot): string =>
        fitAxisLabel(forms, u.bbox[along], (form) => u.ctx.measureText(form).width);

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
      const data = buildData(plotted, markXs());
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

      /** Paints the phase bands behind everything, clipped to the visible range. */
      const drawPhaseBands = (u: uPlot): void => {
        u.ctx.save();
        for (const b of clipBands(bandList, visibleXRange(xs, cols, x.kind, xPerCell))) {
          u.ctx.fillStyle = b.kind === 'red' ? redFill : bandFill;
          u.ctx.globalAlpha = b.kind === 'red' ? redAlpha : 1;
          const left = u.valToPos(b.from, 'x', true);
          u.ctx.fillRect(left, u.bbox.top, u.valToPos(b.to, 'x', true) - left, u.bbox.height);
        }
        u.ctx.restore();
      };

      /** Paints each series' ±sd band behind the lines: one translucent polygon in the line's colour. */
      const drawSdBands = (u: uPlot): void => {
        u.ctx.save();
        untrack(() => series).forEach((s, i) => {
          const line = lines[i];
          const outline = bandOutline(s.band ?? []);
          if (!line || outline.length === 0) return;
          u.ctx.beginPath();
          outline.forEach(([bx, by], k) => {
            const px = u.valToPos(bx, 'x', true);
            const py = u.valToPos(by, 'y', true);
            if (k === 0) u.ctx.moveTo(px, py);
            else u.ctx.lineTo(px, py);
          });
          u.ctx.closePath();
          u.ctx.fillStyle = line.stroke;
          u.ctx.globalAlpha = bandAlpha * line.alpha;
          u.ctx.fill();
        });
        u.ctx.restore();
      };

      /**
       * Paints the marks over the lines: a dot filled, a ring stroked solid, a dotted ring stroked dashed, each in its
       * role (resolved at the chart's element). A pinned mark off the y scale sits just inside the plot's edge on its side.
       */
      const drawMarks = (u: uPlot): void => {
        const list = untrack(() => marks) ?? [];
        if (list.length === 0) return;
        const ratio = uPlot.pxRatio;
        // Each role is resolved once per draw.
        const colours: Partial<Record<Role, string>> = {};
        const colourOf = (r: Role): string => (colours[r] ??= resolveRole(el, r));
        const yScale = u.scales['y'];
        const top = u.bbox.top;
        const bottom = u.bbox.top + u.bbox.height;
        u.ctx.save();
        for (const m of list) {
          const ring = m.shape !== 'dot';
          const r = (ring ? ringRadius : markRadius) * ratio;
          const inset = r + ringWidth * ratio;
          let cy = u.valToPos(m.y, 'y', true);
          if (m.pinned === true && yScale?.max != null && m.y > yScale.max) cy = top + inset;
          else if (m.pinned === true && yScale?.min != null && m.y < yScale.min) cy = bottom - inset;
          u.ctx.beginPath();
          u.ctx.arc(u.valToPos(m.x, 'x', true), cy, r, 0, 2 * Math.PI);
          if (ring) {
            u.ctx.setLineDash(m.shape === 'dottedRing' ? ringDash.map((d) => d * ratio) : []);
            u.ctx.lineWidth = ringWidth * ratio;
            u.ctx.strokeStyle = colourOf(m.role);
            u.ctx.stroke();
          } else {
            u.ctx.fillStyle = colourOf(m.role);
            u.ctx.fill();
          }
        }
        u.ctx.restore();
      };

      // With marks or bands the y range covers exactly what must show (`yExtent`): a pinned mark never widens it.
      const fitsMarks = untrack(() => (marks ?? []).length > 0 || series.some((s) => s.band !== undefined));
      const yRange = (_u: uPlot, min: number | null, max: number | null): uPlot.Range.MinMax => {
        const [lo, hi] = yExtent(untrack(() => series), untrack(() => marks) ?? []) ?? [min ?? 0, max ?? 1];
        return uPlot.rangeNum(lo, hi, 0.1, true);
      };

      plot = new uPlot(
        {
          width: size.px.width,
          height: size.px.height,
          legend: { show: false },
          padding: [null, labelRoomPx, null, null],
          cursor: { show: false },
          scales: {
            x: { time: false, range: () => visibleXRange(xs, cols, x.kind, xPerCell) },
            ...(fitsMarks ? { y: { range: yRange } } : {}),
          },
          axes: [{ ...axis, label: labelForms(xLabel, 'width'), ...(x.kind === 'tyreAge' ? { incrs: WHOLE_LAPS } : {}) }, { ...axis, label: labelForms(yLabel, 'height'), size: yGutter, ...(ySteps ? { incrs: [...ySteps] } : {}), ...(yFormat ? { values: (_u: uPlot, splits: number[]) => splits.map(yFormat) } : {}) }],
          series: [{}, ...lines, ...liveLines],
          hooks: {
            draw: [drawMarks, drawLabels, () => ondraw?.()],
            drawClear: [...(bandList.length ? [drawPhaseBands] : []), drawSdBands],
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

  // Data effect: new points, marks and bands go to the same plot (setData redraws it, and the hooks read them).
  $effect(() => {
    const data = buildData(plotLines(series), (marks ?? []).map((m) => m.x));
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
      plot.setData(buildData(plotLines(untrack(() => series)), markXs()) as uPlot.AlignedData);
    }
  });
</script>

<div class="chart" style:background-color="var(--pw-bg)" bind:this={host}></div>

<style>
  .chart {
    display: block;
  }
</style>
