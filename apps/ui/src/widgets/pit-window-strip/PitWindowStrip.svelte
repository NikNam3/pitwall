<script lang="ts">
  // The race's lap axis with the fitted set and, per new set, its pit window (SP4.2 spec §4; mockup
  // docs/design/2026-11-07-sp4.2/pit-window.html). Every lap and the window state are `pit-window`'s (C43); layout.ts
  // places them, rows.ts and emphasis.ts format and map them (C65). Full: the chart; compact: text only.
  import type { WidgetProps } from '../../kit/types.ts';
  import TextCell from '../../kit/values/TextCell.svelte';
  import { role } from '../../theme/index.ts';
  import { cellOf, layoutStrip } from './layout.ts';
  import { compactRows } from './rows.ts';
  import type { widget } from './widget.ts';

  let { data, options, size }: WidgetProps<typeof widget> = $props();

  /** Cells of a compact row's lap text, right-aligned (`L23–31`). */
  const LAP_COLS = 7;

  const full = $derived(size.mode === 'full');
  const layout = $derived(
    data.window.known && full ? layoutStrip({ cols: size.cols, window: data.window.value, showOther: options.otherType }, cellOf(size)) : undefined,
  );
  const rows = $derived(data.window.known && !full ? compactRows(data.window.value, options.otherType).slice(0, size.rows) : []);
</script>

{#if !data.window.known}
  <div class="line"><TextCell text="" reason={data.window.reason} /></div>
{:else if layout !== undefined}
  <div class="chart" style:width="{layout.width}px" style:height="{layout.height}px">
    <svg width={layout.width} height={layout.height}>
      {#each layout.bands as b, n (n)}
        <rect x={b.x} y={b.y} width={b.width} height={b.height} style:fill={role('bgRowBand')} />
      {/each}
      {#each layout.letters as l, n (n)}
        <text x={l.x} y={l.y} dominant-baseline="central" style:fill={role('textDim')}>{l.text}</text>
      {/each}
      {#each layout.bars as b, n (n)}
        {#if b.hollow}
          <rect x={b.rect.x} y={b.rect.y} width={b.rect.width} height={b.rect.height} fill="none" style:stroke={role(b.role)} />
        {:else}
          <rect x={b.rect.x} y={b.rect.y} width={b.rect.width} height={b.rect.height} style:fill={role(b.role)} />
        {/if}
      {/each}
      {#each layout.lines as l, n (n)}
        <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke-width="1" style:stroke={role(l.role)} />
      {/each}
      {#each layout.knockouts as k, n (n)}
        <rect x={k.x} y={k.y} width={k.width} height={k.height} style:fill={role(k.role)} />
      {/each}
      {#each layout.labels as l, n (n)}
        <text
          x={l.x}
          y={l.y}
          text-anchor={l.anchor}
          dominant-baseline="central"
          class:bold={l.bold}
          style:fill={role(l.role)}>{l.text}</text>
      {/each}
    </svg>
    {#if layout.unknown !== undefined}
      <div class="mark" style:left="{layout.unknown.x}px" style:top="{layout.unknown.y}px"><TextCell text="" reason={layout.unknown.reason} /></div>
    {/if}
  </div>
{:else}
  <div class="block">
    {#each rows as r, n (n)}
      <div class="line"> <span style:color={role('textDim')}>{r.letter}</span>      <span class:bold={r.bold}><TextCell
            {...r.lap}
            role={r.role}
            width={LAP_COLS}
            align="right"
          /></span></div>
    {/each}
  </div>
{/if}

<style>
  .chart {
    position: relative;
    overflow: hidden;
  }
  svg {
    display: block;
    font-variant-ligatures: none;
  }
  .mark {
    position: absolute;
  }
  .block {
    white-space: nowrap;
  }
  .line {
    white-space: pre;
  }
  .bold {
    font-weight: var(--pw-weight-bold);
  }
</style>
