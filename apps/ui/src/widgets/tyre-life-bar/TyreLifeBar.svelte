<script lang="ts">
  // Tyre life (V21, spec 8.2): per corner the wear bar with the limit and the game's life span, the wear now, its rate
  // and the laps to the limit. The compound of the set and its age stand in the first line (the shell header has no slot for them).
  import type { UnknownReason } from '@pitwall/domain';
  import type { WidgetProps } from '../../kit/types.ts';
  import CompoundMark from '../../kit/compound/CompoundMark.svelte';
  import type { BarCellKind } from '../../kit/bar/bar.ts';
  import { unknownReason } from '../../kit/text.ts';
  import { role, type Role } from '../../theme/index.ts';
  import { lapsToLimitRole } from './emphasis.ts';
  import { ageText, barColumns, tyreLifeRows } from './rows.ts';
  import * as text from './text.ts';
  import type { widget } from './widget.ts';

  let { data, size }: WidgetProps<typeof widget> = $props();

  const rows = $derived(tyreLifeRows(data.wear, barColumns(size.cols)));
  const tyres = $derived(data.car?.tyres);
  // The age in words needs room beside WEAR; the compact bar has none (it stays on hover).
  const showAge = $derived(barColumns(size.cols) >= 16);

  const KIND_ROLE: Record<BarCellKind, Role> = { fill: 'text', empty: 'textFaint', limit: 'textDim', marker: 'textDim', reserve: 'textDim' };
  /** The bar's cells grouped into runs of one colour. */
  function runs(kinds: BarCellKind[], chars: string): { text: string; role: Role }[] {
    const out: { text: string; role: Role }[] = [];
    kinds.forEach((kind, i) => {
      const r = KIND_ROLE[kind];
      const last = out[out.length - 1];
      if (last?.role === r) last.text += chars[i];
      else out.push({ text: chars[i] ?? '', role: r });
    });
    return out;
  }
  const sp = ' ';
  const hover = (reason: UnknownReason | undefined): string | undefined => (reason === undefined ? undefined : unknownReason[reason]);
</script>

<div class="life" style:--bar="{barColumns(size.cols)}ch">
  <div class="line faint">{sp}<span class="label">{#if tyres}<CompoundMark compound={tyres.visualCompound} />{/if}</span>{sp}<span class="bar head" title={tyres === undefined ? undefined : ageText(tyres.age)}><span>{text.headers.wear}</span>{#if tyres && showAge}<span>{ageText(tyres.age)}</span>{/if}</span>{sp}<span class="now">{text.headers.now}</span>{sp}<span class="rate">{text.headers.rate}</span>{sp}<span class="laps">{text.headers.laps}</span>
  </div>
  {#each rows as row (row.corner)}
    {@const light = lapsToLimitRole(row.lapsToLimit, data.wear.warnLaps)}
    <div class="line">{sp}<span class="label">{row.label}</span>{sp}<span class="bar" title={hover(row.reasons.wear)}>{#each runs(row.bar.kinds, row.bar.text) as run, i (i)}<span style:color={role(run.role)}>{run.text}</span>{/each}</span>{sp}<span class="now" title={hover(row.reasons.wear)}>{row.wearText}</span>{sp}<span class="rate" title={hover(row.reasons.rate)}>{row.rateText}</span>{sp}<span class="laps" title={hover(row.reasons.laps)} style:color={light === undefined ? undefined : role(light)}>{row.lapsText}</span>
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
