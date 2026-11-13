<script lang="ts">
  // The strategy chart (mockup strategy-table-b.html, gen.mjs `chartSvgB`): one line per policy over P1 … Pn, the faint
  // vertical at our place now, the highlighted policy's points and E[pos] tick. chart.ts places and colours; this draws
  // with theme roles only (C65, C68). A click on a line toggles the highlight through `onpick`.
  import type { McRow } from '@pitwall/domain';
  import { DEFAULT_THEME, role } from '../../theme/index.ts';
  import { chartAxes, chartLines, chartMarks, drawnRows, type Box } from './chart.ts';
  import { stopsText } from './rows.ts';

  /** `limit`: draw only the best-ranked lines (and the committed one), compact's rule (gen.mjs `prepRows`). */
  type Props = { rows: readonly McRow[]; highlight: number | null; box: Box; currentPosition: number; limit?: number; onpick: (i: number) => void };
  let { rows, highlight, box, currentPosition, limit, onpick }: Props = $props();

  const { markRadius, liveDash } = DEFAULT_THEME.chart;
  /** Px the E[pos] tick reaches above and below the place axis, and its stroke (gen.mjs). */
  const TICK_UP = 5;
  const TICK_DOWN = 3;
  const TICK_WIDTH = 2;
  /** Px between a chance label and the plot; above the bottom edge for a place label. */
  const LABEL_GAP = 6;
  const PLACE_LIFT = 4;
  /** Width of the invisible stroke that makes a line easy to click. */
  const HIT_WIDTH = 10;

  const state = $derived({ highlight });
  const lines = $derived(chartLines(rows, state, box));
  const marks = $derived(chartMarks(rows, state, box, currentPosition));
  const axes = $derived(chartAxes(rows, box));
  /** Draw order: the others, then the committed line, the highlighted one last (on top). */
  const layer = (i: number): number => (i === highlight ? 2 : rows[i]?.committed === true ? 1 : 0);
  const order = $derived(
    drawnRows(rows, limit)
      .flatMap((i) => {
        const r = rows[i];
        const l = lines[i];
        return r === undefined || l === undefined ? [] : [{ i, l, title: `${r.rank} · ${stopsText(r.policy)}` }];
      })
      .sort((a, b) => layer(a.i) - layer(b.i)),
  );
  const pointsOf = (pts: [number, number][]): string => pts.map(([x, y]) => `${x},${y}`).join(' ');
</script>

<svg data-testid="chart" width={box.width} height={box.height}>
  {#each axes.grid as g, n (n)}
    <line x1={axes.x0} x2={axes.x1} y1={g.y} y2={g.y} stroke-width="1" style:stroke={role('grid')} />
    <text x={axes.x0 - LABEL_GAP} y={g.y} text-anchor="end" dominant-baseline="central" style:fill={role('textDim')}>{g.label}</text>
  {/each}
  {#each axes.places as p, n (n)}
    <text x={p.x} y={box.height - PLACE_LIFT} text-anchor="middle" style:fill={role('textDim')}>{p.label}</text>
  {/each}
  <line data-testid="now-line" x1={marks.now.x} x2={marks.now.x} y1={axes.y0} y2={axes.y1} stroke-width="1" style:stroke={role(marks.now.role)} />
  {#each order as { i, l, title } (i)}
    <g
      data-testid="line-{i}"
      data-role={l.role}
      data-width={l.widthPx}
      data-dotted={String(l.dotted)}
      role="button"
      tabindex="-1"
      onclick={() => onpick(i)}
      onkeydown={(e) => e.key === 'Enter' && onpick(i)}
    >
      <title>{title}</title>
      <polyline
        points={pointsOf(l.points)}
        fill="none"
        stroke-width={l.widthPx}
        stroke-linejoin="round"
        stroke-dasharray={l.dotted ? liveDash.join(' ') : undefined}
        style:stroke={role(l.role)}
      />
      {#if l.dots}
        {#each l.points as [x, y], k (k)}
          <circle cx={x} cy={y} r={markRadius} style:fill={role(l.role)} />
        {/each}
      {/if}
      <polyline points={pointsOf(l.points)} fill="none" stroke-opacity="0" stroke-width={HIT_WIDTH} pointer-events="stroke" class="hit" style:stroke={role('bg')} />
    </g>
  {/each}
  {#if marks.tick !== null}
    <line
      data-testid="epos-tick"
      x1={marks.tick.x}
      x2={marks.tick.x}
      y1={axes.y1 - TICK_UP}
      y2={axes.y1 + TICK_DOWN}
      stroke-width={TICK_WIDTH}
      style:stroke={role(marks.tick.role)}
    />
  {/if}
</svg>

<style>
  svg {
    display: block;
    font-variant-ligatures: none;
  }
  text {
    font-family: var(--pw-font);
    font-size: var(--pw-font-px);
  }
  .hit {
    cursor: pointer;
  }
</style>
