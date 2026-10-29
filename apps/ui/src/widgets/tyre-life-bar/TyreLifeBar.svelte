<script lang="ts">
  // Tyre life (V21, spec 8.2): per corner the wear bar with the limit and the game's life span, the wear now, its rate
  // and the laps to the limit. The compound of the set and its age stand in the first line (the shell header has no slot for them).
  import type { UnknownReason } from '@pitwall/domain';
  import type { WidgetProps } from '../../kit/types.ts';
  import CompoundMark from '../../kit/compound/CompoundMark.svelte';
  import Bar from '../../kit/bar/Bar.svelte';
  import { unknownReason } from '../../kit/text.ts';
  import { roleOrUndefined } from '../../theme/index.ts';
  import { formatPercent } from '../../kit/values/format.ts';
  import { lapsToLimitRole } from './emphasis.ts';
  import { AGE_MIN_BAR_COLUMNS, ageText, barColumns, tyreLifeRows } from './rows.ts';
  import * as text from './text.ts';
  import type { widget } from './widget.ts';

  let { data, size }: WidgetProps<typeof widget> = $props();

  const rows = $derived(tyreLifeRows(data.wear, barColumns(size.cols)));
  const tyres = $derived(data.car?.tyres);
  // The age in words needs room beside WEAR; the compact bar has none (it stays on hover).
  const showAge = $derived(barColumns(size.cols) >= AGE_MIN_BAR_COLUMNS);

  const sp = ' ';
  const hover = (reason: UnknownReason | undefined): string | undefined => (reason === undefined ? undefined : unknownReason[reason]);
</script>

<div class="life" style:--bar="{barColumns(size.cols)}ch">
  <div class="line faint">{sp}<span class="label">{#if tyres}<CompoundMark compound={tyres.visualCompound} />{/if}</span>{sp}<span class="bar head" title={tyres === undefined ? undefined : ageText(tyres.age)}><span>{text.headers.wear}</span>{#if tyres && showAge}<span>{ageText(tyres.age)}</span>{/if}</span>{sp}<span class="now">{text.headers.now}</span>{sp}<span class="rate">{text.headers.rate}</span>{sp}<span class="laps">{text.lapsHeader(formatPercent(data.wear.limitPct))}</span>
  </div>
  {#each rows as row (row.corner)}
    {@const light = lapsToLimitRole(row.lapsToLimit, data.wear.warnLaps)}
    <div class="line">{sp}<span class="label">{row.label}</span>{sp}<span class="bar" title={hover(row.reasons.wear)}><Bar {...row.barInput} role="text" /></span>{sp}<span class="now" title={hover(row.reasons.wear)}>{row.wearText}</span>{sp}<span class="rate" title={hover(row.reasons.rate)}>{row.rateText}</span>{sp}<span class="laps" title={hover(row.reasons.laps)} style:color={roleOrUndefined(light)}>{row.lapsText}</span>
    </div>
  {/each}
</div>

<style>
  .life {
    font-variant-numeric: tabular-nums;
  }
  .line {
    white-space: pre;
  }
  .line > span {
    display: inline-block;
    vertical-align: top;
  }
  .faint {
    color: var(--pw-textFaint);
  }
  .label {
    width: 2ch;
  }
  .bar {
    width: var(--bar);
  }
  .line > .head {
    display: inline-flex;
    justify-content: space-between;
  }
  .now {
    width: 4ch;
    text-align: right;
  }
  .rate {
    width: 5ch;
    text-align: right;
  }
  .laps {
    width: 11ch;
    text-align: right;
  }
</style>
