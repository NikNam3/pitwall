<script lang="ts">
  // The kit parts with sample data (spec 9.2): value cell states, icon and table, each in a cell of its own.
  import { unknown } from '@pitwall/domain';
  import Gear from '../kit/icons/Gear.svelte';
  import Table from '../kit/table/Table.svelte';
  import type { WidgetSize } from '../kit/types.ts';
  import Value from '../kit/values/Value.svelte';
  import { formatLapTime, formatPct } from '../kit/values/format.ts';
  import { role } from '../theme/index.ts';

  type Row = { driver: string; lapMs: number; gripPct: number };
  const rows: Row[] = [
    { driver: 'VER', lapMs: 71910, gripPct: 98 },
    { driver: 'HAM', lapMs: 72345, gripPct: 94 },
    { driver: 'LEC', lapMs: 72801, gripPct: 91 },
  ];
  const size: WidgetSize = { mode: 'sample', cols: 40, rows: 8, px: { width: 400, height: 200 }, dpr: 1 };
  // The chart is left out: uPlot needs a real canvas and `matchMedia` when its module loads, which jsdom lacks.
</script>

<div class="parts">
  <figure data-gallery-id="kit/value">
    <figcaption style:color={role('textFaint')}>kit/value</figcaption>
    <div><Value value={71910} format={formatLapTime} /></div>
    <div><Value value={unknown('notReceived')} format={formatLapTime} widthCols={8} /></div>
    <div><Value value={94} format={formatPct} estimated /></div>
  </figure>
  <figure data-gallery-id="kit/icon">
    <figcaption style:color={role('textFaint')}>kit/icon</figcaption>
    <span style:color={role('textDim')}><Gear label="gear" /></span>
  </figure>
  <figure data-gallery-id="kit/table">
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
</div>

{#snippet driver(r: Row)}{r.driver}{/snippet}
{#snippet lap(r: Row)}<Value value={r.lapMs} format={formatLapTime} />{/snippet}
{#snippet grip(r: Row)}<Value value={r.gripPct} format={formatPct} />{/snippet}

<style>
  .parts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--pw-panel-gap);
  }
  figure {
    margin: 0;
  }
</style>
