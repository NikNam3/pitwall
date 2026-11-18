<script lang="ts">
  // The basis and plan in use (SP4.3e spec §4.2, §4.3): `Practice 17 Nov · Qualifying 17 Nov · Plan: <name>`, `none` per
  // part, and `56 / 20 laps` when the plan was computed for other race laps than the race's; both numbers are
  // `basis.active`'s, shown, not judged (C65). A quiet button that runs `basis.pick`.
  import * as text from '../../../kit/text.ts';
  import { formatCount, formatDay } from '../../../kit/values/format.ts';
  import { role } from '../../../theme/index.ts';
  import { keysOf } from '../../basis/candidates.ts';
  import type { TopBarModel } from '../model.svelte.ts';

  let { bar }: { bar: TopBarModel } = $props();

  const shown = $derived.by(() => {
    const b = bar.basis;
    if (b === undefined) return undefined;
    const day = (key: string): string => {
      const date = b.sessions[key]?.date;
      const formatted = date === undefined ? '' : formatDay(date);
      return formatted === '' ? text.basis.unknownDay : formatted;
    };
    const practice = keysOf(b.basis, 'practice').map(day);
    const qualifying = keysOf(b.basis, 'qualifying').map(day);
    return {
      practice: practice.length === 0 ? text.basis.none : text.basis.days(practice),
      qualifying: qualifying[0] ?? text.basis.none,
      plan: b.plan?.name ?? text.basis.none,
      laps: b.plan !== null && b.raceLaps !== null && b.plan.laps !== b.raceLaps ? text.basis.laps(formatCount(b.plan.laps), formatCount(b.raceLaps)) : undefined,
    };
  });
</script>

{#if shown !== undefined}
  <button type="button" class="pw-button" title={text.commandTitles.basisPick} onclick={() => bar.pickBasis()}
    >{text.basis.segment(shown.practice, shown.qualifying, shown.plan)}{#if shown.laps !== undefined}
      <span style:color={role('text')}>{shown.laps}</span>{/if}</button
  >
{/if}
