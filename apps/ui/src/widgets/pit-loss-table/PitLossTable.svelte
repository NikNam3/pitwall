<script lang="ts">
  // The pit loss per condition with its source, and this session's stops newest first (spec 6; mockup
  // docs/design/2026-11-06-sp4.1a/source-badge.html). The source's kind is the calculator's (C43); the badge maps it (C65).
  import type { WidgetProps } from '../../kit/types.ts';
  import { fitCell } from '../../kit/grid/grid.ts';
  import { fitColumns } from '../../kit/size/size.ts';
  import SourceBadge from '../../kit/values/SourceBadge.svelte';
  import TextCell from '../../kit/values/TextCell.svelte';
  import { roleOrUndefined } from '../../theme/index.ts';
  import { CONDITION_COLUMNS, STOP_COLUMNS } from './columns.ts';
  import { conditionRole, stopCodeRole, stopRole } from './emphasis.ts';
  import { buildConditionRows, buildStopRows } from './rows.ts';
  import * as text from './text.ts';
  import type { widget } from './widget.ts';

  let { data, size }: WidgetProps<typeof widget> = $props();

  /** Lines of the full mode above the stops: the header, three conditions, the blank line, the title, the stop header. */
  const LINES_ABOVE_STOPS = 7;

  const full = $derived(size.mode === 'full');
  const conditionRows = $derived(buildConditionRows(data.losses));
  const kept = $derived(fitColumns(CONDITION_COLUMNS, size.cols, 1));
  const columns = $derived(CONDITION_COLUMNS.filter((c) => kept.includes(c.key)));
  // While SOURCE shows the source in words, the loss carries no badge mark; without it, the badge follows the loss.
  const sourceInWords = $derived(kept.includes('source'));
  const stopKept = $derived(fitColumns(STOP_COLUMNS, size.cols, 1));
  const stopColumns = $derived(STOP_COLUMNS.filter((c) => stopKept.includes(c.key)));
  const stops = $derived(
    full ? buildStopRows({ losses: data.losses, cars: data.cars, session: data.session }).slice(0, Math.max(0, size.rows - LINES_ABOVE_STOPS)) : [],
  );
</script>

<div class="block">
  {#if full}
    <div class="line faint">{columns.map((c) => fitCell(text.conditionHeaders[c.key], c.widthCols, c.align)).join(' ')}</div>
  {/if}
  {#each conditionRows as r (r.condition)}
    <div class="line" style:color={roleOrUndefined(conditionRole(r.source.kind))}>{#each columns as c, i (c.key)}{i === 0 ? '' : ' '}{#if c.key === 'cond'}<TextCell
            text={text.conditions[r.condition]}
            width={c.widthCols}
            align={c.align}
          />{:else if c.key === 'loss'}{#if sourceInWords}<TextCell {...r.loss} width={c.widthCols} align={c.align} />{:else}<TextCell
              {...r.loss}
              width={c.widthCols - 1}
              align={c.align}
            /><SourceBadge source={r.source} />{/if}{:else if c.key === 'stat'}<TextCell {...r.stat} width={c.widthCols} align={c.align} />{:else if c.key === 'n'}<TextCell
            text={r.n}
            width={c.widthCols}
            align={c.align}
          />{:else}<TextCell text={text.sourceWord[r.source.kind]} width={c.widthCols} align={c.align} />{/if}{/each}</div>
  {/each}
  {#if full}
    <div class="line"></div>
    <div class="line faint">{text.stopsTitle}</div>
    <div class="line faint">{stopColumns.map((c) => fitCell(text.stopHeaders[c.key], c.widthCols, c.align)).join(' ')}</div>
    {#each stops as s, n (n)}
      <div
        class="line"
        style:color={roleOrUndefined(stopRole(s.use))}
        title={s.use === 'used' ? undefined : text.unused[s.use]}
      >{#each stopColumns as c, i (c.key)}{i === 0 ? '' : ' '}{#if c.key === 'lap'}{fitCell(s.lap, c.widthCols, c.align)}{:else if c.key === 'drv'}<TextCell
              {...s.code}
              role={stopCodeRole(s.ours, s.use)}
              width={c.widthCols}
              align={c.align}
            />{:else if c.key === 'cond'}{fitCell(text.conditions[s.condition], c.widthCols, c.align)}{:else if c.key === 'loss'}<TextCell
              {...s.loss}
              width={c.widthCols}
              align={c.align}
            />{:else}{fitCell(s.stat, c.widthCols, c.align)}{/if}{/each}</div>
    {/each}
  {/if}
</div>

<style>
  .block {
    white-space: nowrap;
  }
  .line {
    white-space: pre;
  }
  .faint {
    color: var(--pw-textFaint);
  }
</style>
