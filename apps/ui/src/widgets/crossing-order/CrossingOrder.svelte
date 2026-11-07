<script lang="ts">
  // Per condition the crossing order around the rejoin ghost (SP4.2 spec §4; mockup
  // docs/design/2026-10-30-sp4a-displays/1-ghost-views.html): full the three conditions side by side, compact the one
  // that is out, else green. The order is the `rejoin` analysis's (C43); the display selects and formats (C65).
  import type { WidgetProps } from '../../kit/types.ts';
  import GhostRow from '../../kit/ghost/GhostRow.svelte';
  import { fitCell } from '../../kit/grid/grid.ts';
  import SourceBadge from '../../kit/values/SourceBadge.svelte';
  import TextCell from '../../kit/values/TextCell.svelte';
  import { roleOrUndefined } from '../../theme/index.ts';
  import { rowRole, titleRole } from './emphasis.ts';
  import { buildBlocks, type Block, type OrderRow } from './rows.ts';
  import * as text from './text.ts';
  import type { widget } from './widget.ts';

  let { data, size }: WidgetProps<typeof widget> = $props();

  /** The columns of an order: P, DRV, INT (one cell gap; 15 cells). */
  const COLS = { p: 2, drv: 4, int: 7 } as const;
  const BLOCK_COLS = COLS.p + COLS.drv + COLS.int + 2;
  /** Cells before the first block and between two blocks (the mockup's spaces). */
  const LEAD_COLS = 1;
  const GAP_COLS = 3;

  const blocks = $derived(buildBlocks({ rejoin: data.rejoin, cars: data.cars, session: data.session, phase: data.phase }, size.mode === 'full'));
  const header = [fitCell(text.headers.p, COLS.p, 'right'), fitCell(text.headers.drv, COLS.drv), fitCell(text.headers.int, COLS.int, 'right')].join(' ');
</script>

{#snippet title(b: Block)}<span>{text.conditions[b.condition]}</span> <TextCell {...b.loss} />{#if b.source !== undefined}<SourceBadge
      source={b.source}
    />{/if}{/snippet}

{#snippet cells(r: OrderRow)}{fitCell(r.p, COLS.p, 'right')} <TextCell {...r.code} width={COLS.drv} /> <TextCell
    {...r.int}
    width={COLS.int}
    align="right"
  />{/snippet}

<div class="blocks">
  {#each blocks as b, i (b.condition)}
    <div class="spacer" style:width="{i === 0 ? LEAD_COLS : GAP_COLS}ch"></div>
    <div class="block" data-condition={b.condition} style:width="{BLOCK_COLS}ch">
      <div class="line">{#if b.active}<strong style:color={roleOrUndefined(titleRole(true))}>{@render title(b)}</strong>{:else}{@render
            title(b)}{/if}</div>
      <div class="line faint">{header}</div>
      {#if 'reason' in b.order}
        <div class="line"><TextCell text="" reason={b.order.reason} /></div>
      {:else}
        {#each b.order.rows as r (r.key)}
          {#if r.ghost}
            <GhostRow><div class="line">{@render cells(r)}</div></GhostRow>
          {:else}
            <div class="line" style:color={roleOrUndefined(rowRole(r.ours, r.ghost))}>{#if r.near}<strong>{@render cells(r)}</strong>{:else}{@render
                  cells(r)}{/if}</div>
          {/if}
        {/each}
      {/if}
    </div>
  {/each}
</div>

<style>
  .blocks {
    display: flex;
    white-space: nowrap;
  }
  .spacer,
  .block {
    flex: none;
  }
  .line {
    white-space: pre;
  }
  .faint {
    color: var(--pw-textFaint);
  }
</style>
