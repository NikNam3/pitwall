<script lang="ts">
  // The undercut card (SP4.3b spec §9.1, §10, V13; mockup docs/design/2026-11-12-sp4.3b/undercut-card.html): the rivals
  // ahead, our line, the rivals behind; full per rival and N = 1–3 ΔGAP, P(AH), the gain strip and our rejoin place,
  // compact ΔGAP per N. Every number is `undercut`'s; rows.ts formats and orders them (C65).
  import { UNDERCUT_GAIN_BINS } from '@pitwall/domain';
  import DistStrip from '../../kit/dist/DistStrip.svelte';
  import type { CellPart } from '../../kit/grid/grid.ts';
  import type { WidgetProps } from '../../kit/types.ts';
  import TextCell from '../../kit/values/TextCell.svelte';
  import { role } from '../../theme/index.ts';
  import { lineEmphasis } from './emphasis.ts';
  import { compactLines, fullLines, GAIN_ZERO, gainAxis, NS, stripScale, type Cars } from './rows.ts';
  import * as text from './text.ts';
  import type { widget } from './widget.ts';

  let { data, size }: WidgetProps<typeof widget> = $props();

  /** Cells per column (gen.mjs `ucSpec`; compact `spec`): one space between columns. */
  const W = { car: 3, pos: 3, gap: 3, n: 1, dGap: 4, pAhead: 5, strip: UNDERCUT_GAIN_BINS.count, rej: 3, compactDGap: 4 } as const;

  const full = $derived(size.mode === 'full');
  // The job's topic before its first result has no value: the panel frame shows its computing state.
  const call = $derived(data.undercut as typeof data.undercut | undefined);
  const cars = $derived<Cars>((data.cars as Cars | undefined) ?? []);
  const value = $derived(call?.value.known === true ? call.value.value : undefined);
  const scale = $derived(value === undefined ? 1 : stripScale(value));
  const lines = $derived(value === undefined || !full ? [] : fullLines(value, cars));
  const compact = $derived(value === undefined || full ? [] : compactLines(value, cars));
  const empty: CellPart = { text: '' };
  /** One character cell of space: Svelte trims whitespace at a block's edges, so the lines spell theirs out. */
  const SP = ' ';
</script>

{#snippet part(p: CellPart, width: number, align: 'left' | 'right')}<TextCell text={p.text} reason={p.reason} {width} {align} />{/snippet}

{#if call === undefined}
  <!-- computing: the panel frame's state -->
{:else if !call.value.known}
  <div class="line"><TextCell text="" reason={call.value.reason} /></div>
{:else if value !== undefined}
  {#if full}
    <div class="line" style:color={role('textDim')}> <TextCell text="" width={W.car} /> <TextCell text={text.headers.pos} width={W.pos} align="right" /> <TextCell
        text={text.headers.gap}
        width={W.gap}
        align="right"
      /> <TextCell text={text.headers.n} width={W.n} align="right" /> <TextCell text={text.headers.dGap} width={W.dGap} align="right" /> <TextCell
        text={text.headers.pAhead}
        width={W.pAhead}
        align="right"
      /> {#each gainAxis as a, i (i)}<TextCell text={a.text} width={a.width} />{/each} <TextCell text={text.headers.rej} width={W.rej} align="right" /></div>
    {#each lines as l, i (i)}
      {#if l.own}
        {@const e = lineEmphasis(true)}
        <div
          class="line"
          class:bold={e.bold}
          style:color={role(e.role)}
          data-car={l.carId}
          data-own="true"
          data-role={e.role}
          data-bold={e.bold}
          title={l.noneInRange ? text.noneHover(value.rangeMs) : undefined}
        > {@render part(l.car, W.car, 'left')} <TextCell text={l.pos} width={W.pos} align="right" /></div>
      {:else}
        <div class="line" data-car={l.carId} data-n={l.n} data-role={lineEmphasis(false).role}
          > <span data-testid="car">{@render part(l.car, W.car, 'left')}</span> <span data-testid="pos"><TextCell text={l.pos} width={W.pos} align="right" /></span> <span
            data-testid="gap"><TextCell text={l.gap} width={W.gap} align="right" /></span
          > <span data-testid="n"><TextCell text={String(l.n)} width={W.n} align="right" /></span> <span data-testid="dgap"
            >{@render part(l.dGap, W.dGap, 'right')}</span
          > <span data-testid="pah">{@render part(l.pAhead, W.pAhead, 'right')}</span> {#if l.strip.known}<DistStrip
              form="gain"
              bins={l.strip.bins}
              {scale}
              zero={GAIN_ZERO}
              markAtBin={l.strip.markAtBin}
            />{:else}{@render part(l.strip.part, W.strip, 'left')}{/if} <span data-testid="rej">{@render part(l.rej, W.rej, 'right')}</span></div>
      {/if}
    {/each}
  {:else}
    <div class="line" style:color={role('textDim')}> <TextCell text="" width={W.car} /> <TextCell text="" width={W.pos} />{#each NS as n (n)}{SP}<TextCell
          text={text.nHeader[n]}
          width={W.compactDGap}
          align="right"
        />{/each}</div>
    {#each compact as l (l.carId)}
      {@const e = lineEmphasis(l.own)}
      <div
        class="line"
        class:bold={e.bold}
        style:color={l.own ? role(e.role) : undefined}
        data-car={l.carId}
        data-own={l.own ? 'true' : undefined}
        data-role={e.role}
        data-bold={l.own ? e.bold : undefined}
        title={l.own && value.rivals.length === 0 ? text.noneHover(value.rangeMs) : undefined}
      > {@render part(l.car, W.car, 'left')} <TextCell text={l.pos} width={W.pos} align="right" />{#if !l.own}{#each NS as n (n)}{SP}<span data-testid="dgap-{n}"
              >{@render part(l.dGap[n] ?? empty, W.compactDGap, 'right')}</span
            >{/each}{/if}</div>
    {/each}
  {/if}
{/if}

<style>
  .line {
    white-space: pre;
  }
  .bold {
    font-weight: var(--pw-weight-bold);
  }
</style>
