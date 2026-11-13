<script lang="ts">
  // The kit parts with sample data (spec 9.2): value cell states, icon and table, each in a cell of its own.
  // `data-ready` marks a cell whose parts have rendered (the e2e harness waits for it); only the chart loads lazily.
  // No kit part has a screenshot baseline of its own: the widget baselines pin the parts they use (SP4.1b Task 14), and
  // the last three (insight line, position mark, sector status) were retired for SP4.2's displays (budget K13).
  import { known, unknown, type SessionTime } from '@pitwall/domain';
  import Bar from '../kit/bar/Bar.svelte';
  import CarLabel from '../kit/car/CarLabel.svelte';
  import CompoundMark from '../kit/compound/CompoundMark.svelte';
  import CornerGrid from '../kit/corners/CornerGrid.svelte';
  import InsightLine from '../kit/insight/InsightLine.svelte';
  import PositionMark from '../kit/values/PositionMark.svelte';
  import CellParts from '../kit/values/CellParts.svelte';
  import { positionPairParts } from '../kit/values/position-mark.ts';
  import { sectorStatusRole } from '../emphasis/index.ts';
  import Gear from '../kit/icons/Gear.svelte';
  import Square from '../kit/icons/Square.svelte';
  import Star from '../kit/icons/Star.svelte';
  import StarOutline from '../kit/icons/StarOutline.svelte';
  import DistStrip from '../kit/dist/DistStrip.svelte';
  import { sharedScale } from '../kit/dist/dist.ts';
  import Table from '../kit/table/Table.svelte';
  import Value from '../kit/values/Value.svelte';
  import { formatLapTime, formatPct } from '../kit/values/format.ts';
  import { role, roleOrUndefined } from '../theme/index.ts';
  import { KIT_SIZE } from './layout.ts';
  import { snapGrid } from './snap.ts';
  import { KIT_INSIGHTS } from './kit-insights.ts';

  type Row = { driver: string; lapMs: number; gripPct: number };
  const rows: Row[] = [
    { driver: 'VER', lapMs: 71910, gripPct: 98 },
    { driver: 'HAM', lapMs: 72345, gripPct: 94 },
    { driver: 'LEC', lapMs: 72801, gripPct: 91 },
  ];
  const size = KIT_SIZE;
  /** Loaded on demand: uPlot needs `matchMedia` when its module loads. */
  const loadChart = () => import('../kit/chart/Chart.svelte');
  const series = [
    { label: 'own', points: [[1, 72.4], [2, 72.1], [3, 71.9], [4, 72.0], [5, 71.8]] as Array<[number, number]> },
    { label: 'rival', points: [[1, 72.9], [2, 72.6], [3, 72.5], [4, 72.4], [5, 72.6]] as Array<[number, number]> },
  ];
  const bands = [{ from: 2, to: 3, kind: 'sc' as const }, { from: 4, to: 4.5, kind: 'vsc' as const }, { from: 4.5, to: 5, kind: 'red' as const }];
  let bandsDrawn = $state(false);
  const sectors = [['sessionBest', true], ['sessionBest', false], ['personalBest', true], ['personalBest', false], ['none', true]] as const;
  const at = 0 as SessionTime;
  /** The kit's before/after position pair (`positionPairParts`): both known, and an unknown after with its mark. */
  const pairs = [[known(7, at), known(9, at)], [known(7, at), unknown('notReceived')]] as const;
  let chartDrawn = $state(false);
  /** The distribution strip (SP4.3b2): a 20-place pmf, a gain over eight 1 s bins, a gain over whole places −3 … +3. */
  const pmf = [0, 0.01, 0.02, 0.04, 0.08, 0.12, 0.16, 0.2, 0.14, 0.1, 0.06, 0.04, 0.02, 0.01, 0, 0, 0, 0, 0, 0];
  const gainSeconds = [0.02, 0.05, 0.1, 0.2, 0.3, 0.2, 0.1, 0.03];
  const gainPlaces = [0.05, 0.1, 0.25, 0.3, 0.2, 0.08, 0.02];
  const distScale = sharedScale([pmf, gainSeconds, gainPlaces]);
</script>

<div class="parts" use:snapGrid>
  <figure data-gallery-id="kit/value" data-ready>
    <figcaption style:color={role('textFaint')}>kit/value</figcaption>
    <div><Value value={71910} format={formatLapTime} /></div>
    <div><Value value={unknown('notReceived')} format={formatLapTime} widthCols={8} /></div>
    <div><Value value={94} format={formatPct} estimated /></div>
  </figure>
  <!-- No baseline: the gear is in every panel header, so the widget baselines cover it (budget). -->
  <figure data-gallery-id="kit/icon" data-ready>
    <figcaption style:color={role('textFaint')}>kit/icon</figcaption>
    <span style:color={role('textDim')}><Gear label="gear" /> <Star label="star" /> <StarOutline label="star outline" /> <Square label="square" /></span>
  </figure>
  <!-- No baseline: the call cards' baselines pin the strip (budget). -->
  <figure data-gallery-id="kit/dist" data-ready>
    <figcaption style:color={role('textFaint')}>kit/dist</figcaption>
    <div><DistStrip form="places" {pmf} scale={distScale} ourPlace={8} /></div>
    <div><DistStrip form="gain" bins={gainSeconds} scale={distScale} zero={{ between: 4 }} markAtBin={6.2} /></div>
    <div><DistStrip form="gain" bins={gainPlaces} scale={distScale} zero={{ underBin: 3 }} /></div>
    <div><DistStrip form="places" {pmf} scale={distScale} lit /></div>
  </figure>
  <figure data-gallery-id="kit/table" data-ready>
    <figcaption style:color={role('textFaint')}>kit/table</figcaption>
    <Table
      {rows}
      {size}
      rowKey={(r: Row) => r.driver}
      highlight="VER"
      columns={[
        { key: 'driver', label: 'Drv', widthCols: 4, priority: 1, align: 'left', cell: driver },
        { key: 'lap', label: 'Lap', widthCols: 8, priority: 2, cell: lap },
        { key: 'grip', label: 'Grip', widthCols: 5, priority: 3, cell: grip },
      ]}
    />
  </figure>
  <figure data-gallery-id="kit/corner-grid" data-ready>
    <figcaption style:color={role('textFaint')}>kit/corner-grid</figcaption>
    <CornerGrid corners={{ fl: 31, fr: 28, rl: 22, rr: 25 }} {cell} />
  </figure>
  <figure data-gallery-id="kit/bar" data-ready>
    <figcaption style:color={role('textFaint')}>kit/bar</figcaption>
    <div><Bar value={known(40, at)} min={0} max={100} cols={20} role="text" /></div>
    <div><Bar value={known(55, at)} min={0} max={100} cols={20} limit={70} marker={known(80, at)} reserve={30} role="text" /></div>
    <div><Bar value={known(120, at)} min={0} max={100} cols={20} limit={70} role="warning" /></div>
    <div><Bar value={unknown('restricted')} min={0} max={100} cols={20} role="text" /></div>
  </figure>
  <figure data-gallery-id="kit/compound-mark" data-ready>
    <figcaption style:color={role('textFaint')}>kit/compound-mark</figcaption>
    <div><CompoundMark compound="soft" age={4} /> <CompoundMark compound="medium" age={12} /> <CompoundMark compound="hard" age={0} /> <CompoundMark compound="inter" /></div>
  </figure>
  <figure data-gallery-id="kit/insight-line" data-ready>
    <figcaption style:color={role('textFaint')}>kit/insight-line</figcaption>
    {#each KIT_INSIGHTS as line (line.insight.key)}<div><InsightLine insight={line.insight} acknowledged={line.acknowledged} /></div>{/each}
  </figure>
  <figure data-gallery-id="kit/chart" data-ready={chartDrawn || undefined}>
    <figcaption style:color={role('textFaint')}>kit/chart</figcaption>
    <div style:width="{size.px.width}px" style:height="{size.px.height}px">
      {#await loadChart() then { default: Chart }}
        <Chart {series} xLabel={['lap']} yLabel={['s']} x={{ kind: 'lap' }} {size} ondraw={() => (chartDrawn = true)} />
      {/await}
    </div>
  </figure>
  <figure data-gallery-id="kit/chart-bands" data-ready={bandsDrawn || undefined}>
    <figcaption style:color={role('textFaint')}>kit/chart-bands</figcaption>
    <div style:width="{size.px.width}px" style:height="{size.px.height}px">
      {#await loadChart() then { default: Chart }}
        <Chart {series} {bands} xLabel={['lap']} yLabel={['s']} x={{ kind: 'lap' }} {size} ondraw={() => (bandsDrawn = true)} />
      {/await}
    </div>
  </figure>
  <figure data-gallery-id="kit/car-label" data-ready>
    <figcaption style:color={role('textFaint')}>kit/car-label</figcaption>
    <div><CarLabel identity={{ name: 'Max Verstappen', raceNumber: 1 }} ours={true} /></div>
    <div><CarLabel identity={{ name: 'Lewis Hamilton', raceNumber: 44 }} ours={false} /></div>
    <div><CarLabel identity={{ name: '', raceNumber: 44 }} ours={false} /></div>
  </figure>
  <figure data-gallery-id="kit/position-mark" data-ready>
    <figcaption style:color={role('textFaint')}>kit/position-mark</figcaption>
    <div><PositionMark change={2} /></div>
    <div><PositionMark change={-1} /></div>
    {#each pairs as [from, to], i (i)}
      <div><CellParts parts={positionPairParts(from, to)} /></div>
    {/each}
  </figure>
  <figure data-gallery-id="kit/sector-status" data-ready>
    <figcaption style:color={role('textFaint')}>kit/sector-status</figcaption>
    {#each sectors as [status, ours] (status + ours)}
      {@const r = sectorStatusRole(status, { ours })}
      <div style:color={roleOrUndefined(r, 'textDim')}>{status} · {ours ? 'ours' : 'rival'}</div>
    {/each}
  </figure>
</div>

{#snippet cell(value: number, name: string)}{name.toUpperCase()} {value}{/snippet}
{#snippet driver(r: Row)}{r.driver}{/snippet}
{#snippet lap(r: Row)}<Value value={r.lapMs} format={formatLapTime} />{/snippet}
{#snippet grip(r: Row)}<Value value={r.gripPct} format={formatPct} />{/snippet}

<style>
  .parts {
    display: flex;
    flex-wrap: wrap;
    /* Each part at its own height, not stretched to the tallest (the chart). */
    align-items: flex-start;
    gap: var(--pw-panel-gap);
  }
  figure {
    margin: 0;
  }
</style>
