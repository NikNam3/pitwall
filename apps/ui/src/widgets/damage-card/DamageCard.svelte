<script lang="ts">
  // Damage per part and per corner, the faults and the jumps with their lap-time loss (spec 8.2, V31).
  import type { WidgetProps } from '../../kit/types.ts';
  import CornerGrid from '../../kit/corners/CornerGrid.svelte';
  import { fitCell, type CellPart } from '../../kit/grid/grid.ts';
  import { cornerNames } from '../../kit/text.ts';
  import TextCell from '../../kit/values/TextCell.svelte';
  import { role, roleOrUndefined } from '../../theme/index.ts';
  import { damageRows, FULL_WIDTHS as W } from './rows.ts';
  import type { JumpRow } from './rows.ts';
  import * as text from './text.ts';
  import type { widget } from './widget.ts';

  let { data, size }: WidgetProps<typeof widget> = $props();

  const rows = $derived(damageRows(data.damage));
  const full = $derived(size.mode === 'full');
  const wingWidth = (i: number): number => (i === 2 ? W.wingRear : W.wing);
</script>

{#snippet value(c: CellPart, width: number = W.value)}<TextCell {...c} {width} align="right" />{/snippet}
{#snippet jump(j: JumpRow)}<span style:color={roleOrUndefined(j.role)}>{fitCell(j.text, W.jump)}  <TextCell text={j.loss} reason={j.reason} title={j.title} /></span>{/snippet}

<div class="card">
  {#if full}
    <div class="line faint">{fitCell('', W.label)}{#each text.wingHeader as h, i (h)}{fitCell(h, wingWidth(i), 'right')}{/each}</div>
    <div class="line">{fitCell(text.labels.wing, W.label)}{#each ['wingL', 'wingR', 'wingRear'] as const as k, i (k)}{@render value(rows.parts[k], wingWidth(i))}{/each}</div>
    <div class="line">{fitCell(text.labels.floor, W.label)}{@render value(rows.parts.floor)}  {fitCell(text.labels.diffuser, W.shortLabel)}{@render value(rows.parts.diffuser)}  {fitCell(text.labels.sidepod, W.sidepodLabel)}{@render value(rows.parts.sidepod)}</div>
    <div class="line">{fitCell(text.labels.gearbox, W.label)}{@render value(rows.parts.gearbox)}  {fitCell(text.labels.engine, W.shortLabel)}{@render value(rows.parts.engine)}{#each rows.faults as fault (fault)}  <span style:color={role('critical')}>{fault}</span>{/each}</div>
    <CornerGrid corners={rows.corners}>
      {#snippet cell(c, name)}<div class="line">{cornerNames[name]}  <span class="faint">{text.cornerLabels.tyre}</span> {@render value(c.tyre)}  <span class="faint">{text.cornerLabels.brake}</span> {@render value(c.brake)}</div>{/snippet}
    </CornerGrid>
    {#each rows.jumps.slice(0, 2) as j (j.at)}<div class="line">{@render jump(j)}</div>{/each}
  {:else}
    <!-- The parts are known or unknown together: one mark stands for the whole line. -->
    <div class="line"><TextCell text={rows.compact.parts} reason={rows.parts.wingL.reason} /></div>
    <!-- Two rows only: a fault outranks the newest jump. -->
    {#if rows.faults.length > 0}<div class="line" style:color={role('critical')}>{rows.faults.join(text.faultSeparator)}</div>
    {:else if rows.compact.jump}<div class="line" style:color={roleOrUndefined(rows.compact.jump.role)} title={rows.compact.jump.loss}>{rows.compact.jump.text}</div>{/if}
  {/if}
</div>

<style>
  .line {
    white-space: pre;
  }
  .faint {
    color: var(--pw-textFaint);
  }
</style>
