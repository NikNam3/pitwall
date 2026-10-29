<script lang="ts">
  // Damage per part and per corner, the faults and the jumps with their lap-time loss (spec 8.2, V31).
  import type { WidgetProps } from '../../kit/types.ts';
  import CornerGrid from '../../kit/corners/CornerGrid.svelte';
  import { fitCell } from '../../kit/grid/grid.ts';
  import { cornerNames, unknownReason } from '../../kit/text.ts';
  import { role, roleOrUndefined } from '../../theme/index.ts';
  import { damageRows, FULL_WIDTHS as W } from './rows.ts';
  import type { Cell, JumpRow } from './rows.ts';
  import * as text from './text.ts';
  import type { widget } from './widget.ts';

  let { data, size }: WidgetProps<typeof widget> = $props();

  const rows = $derived(damageRows(data.damage));
  const full = $derived(size.mode === 'full');
  const hint = (c: { reason?: keyof typeof unknownReason }): string | undefined => (c.reason === undefined ? undefined : unknownReason[c.reason]);
  const pad = (c: Cell): string => fitCell(c.text, W.value, 'right');
  const wingWidth = (i: number): number => (i === 2 ? W.wingRear : W.wing);
</script>

{#snippet jump(j: JumpRow)}<span style:color={roleOrUndefined(j.role)}>{fitCell(j.text, W.jump)}  <span title={hint(j)}>{j.loss}</span></span>{/snippet}

<div class="card">
  {#if full}
    <div class="line faint">{fitCell('', W.label)}{#each text.wingHeader as h, i (h)}{fitCell(h, wingWidth(i), 'right')}{/each}</div>
    <div class="line">{fitCell(text.labels.wing, W.label)}{#each ['wingL', 'wingR', 'wingRear'] as const as k, i (k)}<span title={hint(rows.parts[k])}>{fitCell(rows.parts[k].text, wingWidth(i), 'right')}</span>{/each}</div>
    <div class="line">{fitCell(text.labels.floor, W.label)}<span title={hint(rows.parts.floor)}>{pad(rows.parts.floor)}</span>  {fitCell(text.labels.diffuser, W.shortLabel)}<span title={hint(rows.parts.diffuser)}>{pad(rows.parts.diffuser)}</span>  {fitCell(text.labels.sidepod, W.sidepodLabel)}<span title={hint(rows.parts.sidepod)}>{pad(rows.parts.sidepod)}</span></div>
    <div class="line">{fitCell(text.labels.gearbox, W.label)}<span title={hint(rows.parts.gearbox)}>{pad(rows.parts.gearbox)}</span>  {fitCell(text.labels.engine, W.shortLabel)}<span title={hint(rows.parts.engine)}>{pad(rows.parts.engine)}</span>{#each rows.faults as fault (fault)}  <span style:color={role('critical')}>{fault}</span>{/each}</div>
    <CornerGrid corners={rows.corners}>
      {#snippet cell(c, name)}<div class="line">{cornerNames[name]}  <span class="faint">{text.cornerLabels.tyre}</span> <span title={hint(c.tyre)}>{pad(c.tyre)}</span>  <span class="faint">{text.cornerLabels.brake}</span> <span title={hint(c.brake)}>{pad(c.brake)}</span></div>{/snippet}
    </CornerGrid>
    {#each rows.jumps.slice(0, 2) as j (j.at)}<div class="line">{@render jump(j)}</div>{/each}
  {:else}
    <div class="line"><span title={hint(rows.parts.wingL)}>{rows.compact.parts}</span></div>
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
