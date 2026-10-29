<script lang="ts">
  // The field in position order with gaps, last lap, sectors and tyres (spec 8.3, V29).
  import type { WidgetProps } from '../../kit/types.ts';
  import Table from '../../kit/table/Table.svelte';
  import CarLabel from '../../kit/car/CarLabel.svelte';
  import { gapToCarCell } from '../../kit/car/gap-to-car.ts';
  import CompoundMark from '../../kit/compound/CompoundMark.svelte';
  import Value from '../../kit/values/Value.svelte';
  import { unknownReason } from '../../kit/text.ts';
  import { positionMarkText } from '../../kit/values/position-mark.ts';
  import { formatCount, formatDeltaMs, formatGap, formatLapNumber, formatLapsDown, formatLapTime, formatPenaltyMs, formatPlace, formatSector, formatWarnings } from '../../kit/values/format.ts';
  import { sectorStatusRole } from '../../emphasis/index.ts';
  import { roleOrUndefined } from '../../theme/index.ts';
  import type { Role } from '../../theme/roles.ts';
  import type { SectorStatus } from '@pitwall/domain';
  import { TOWER_COLUMNS } from './columns.ts';
  import { incidentRole, penaltyRole } from './emphasis.ts';
  import { buildRows, visibleRows, type TowerRow } from './rows.ts';
  import * as text from './text.ts';
  import type { widget } from './widget.ts';

  let { data, options, size }: WidgetProps<typeof widget> = $props();

  // One line of the body is the header; the rest shows as many cars as fit.
  const rows = $derived(visibleRows(buildRows({ ...data, showRetired: options.showRetired }), size.rows - 1, data.session.playerCar));
  const player = $derived(String(data.session.playerCar));

  const colourOf = (status: SectorStatus, ours: boolean): string | undefined => roleOrUndefined(sectorStatusRole(status, { ours }));
  // the amber left bar of an incident car, in the role the emphasis gives
  const bar = (r: Role | undefined): string | undefined => {
    const colour = roleOrUndefined(r);
    return colour === undefined ? undefined : `inset 2px 0 0 ${colour}`;
  };
  const penalty = (r: TowerRow) => (r.penaltyMs > 0 ? formatPenaltyMs(r.penaltyMs) : r.warnings > 0 ? formatWarnings(r.warnings) : '');
</script>

{#snippet position(r: TowerRow)}
  <span class="mark" style:box-shadow={bar(incidentRole(r.involved))}
    >{formatPlace(r.position)}</span
  >
{/snippet}
{#snippet change(r: TowerRow)}{r.change === undefined ? '' : positionMarkText({ change: r.change })}{/snippet}
{#snippet car(r: TowerRow)}<CarLabel identity={r.overview.identity} ours={r.ours} />{/snippet}
{#snippet gap(r: TowerRow)}{#if r.retired}{text.dnf}{:else if r.lapsDown > 0}{formatLapsDown(r.lapsDown)}{:else}<Value value={r.gapToLeader} format={formatGap} />{/if}{/snippet}
{#snippet interval(r: TowerRow)}{#if r.retired}{formatLapNumber(r.retiredAtLap ?? NaN)}{:else if r.lapsDown === 0}<Value value={r.interval} format={formatDeltaMs} />{/if}{/snippet}
{#snippet toUs(r: TowerRow)}{#if !r.retired}{@const c = gapToCarCell(r.toUs)}<span title={c.reason === undefined ? undefined : unknownReason[c.reason]}>{c.text}</span>{/if}{/snippet}
{#snippet last(r: TowerRow)}<span style:color={colourOf(r.lastLapStatus, r.ours)}><Value value={r.lastLap} format={formatLapTime} /></span>{/snippet}
{#snippet sector(r: TowerRow, i: number)}{@const s = r.sectors[i]}{#if s}<span style:color={colourOf(s.status, r.ours)}><Value value={s.timeMs} format={formatSector} /></span>{/if}{/snippet}
{#snippet compound(r: TowerRow)}<CompoundMark compound={r.compound} />{/snippet}
{#snippet age(r: TowerRow)}{formatCount(r.age)}{/snippet}
{#snippet stops(r: TowerRow)}{formatCount(r.stops)}{/snippet}
{#snippet pen(r: TowerRow)}<span style:color={roleOrUndefined(penaltyRole(r.penaltyMs))}>{penalty(r)}</span>{/snippet}
{#snippet pit(r: TowerRow)}{r.pit === undefined ? '' : text.pit[r.pit]}{/snippet}

{#snippet s1(r: TowerRow)}{@render sector(r, 0)}{/snippet}
{#snippet s2(r: TowerRow)}{@render sector(r, 1)}{/snippet}
{#snippet s3(r: TowerRow)}{@render sector(r, 2)}{/snippet}

<div class="tower">
<Table
  columns={TOWER_COLUMNS.map((c) => ({ ...c, cell: { position, change, car, gap, interval, toUs, last, s1, s2, s3, compound, age, stops, penalty: pen, pit }[c.key] }))}
  {rows}
  rowKey={(r) => String(r.carId)}
  inactive={(r) => r.retired}
  {size}
  highlight={player}
/>
</div>

<style>
  .tower {
    height: 100%;
  }
  .mark {
    display: block;
  }
</style>
