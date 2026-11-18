<script lang="ts">
  // The top bar between sessions (SP4.3f spec §4.4; mockup topbar-planning): with an open round
  // `Planning · P 17 Nov · Q 17 Nov · 56 laps · fresh · rain 1–12 %`, the days of the round's picks from `plans.sessions`
  // by ref, the rain chance's range over the round's forecast rows (its unknown mark while they are unknown, C3) and a
  // dim `edited` once a row is overridden; `rebuilding` in place of the race while a pick is rebuilt (C61). Without a
  // round the quiet `Plan…` button. Both run `basis.pick`. Formatting only (C65); in a session nothing shows.
  import type { SessionRef } from '@pitwall/domain';
  import * as text from '../../../kit/text.ts';
  import { formatCount, formatDay } from '../../../kit/values/format.ts';
  import { role } from '../../../theme/index.ts';
  import type { TopBarModel } from '../model.svelte.ts';

  let { bar }: { bar: TopBarModel } = $props();

  const sameRef = (a: SessionRef, b: SessionRef): boolean => a.sessionUid === b.sessionUid && a.weekendId === b.weekendId;

  const shown = $derived.by(() => {
    const round = bar.round;
    if (round === undefined) return undefined;
    const stored = bar.storedSessions?.sessions ?? [];
    const day = (ref: SessionRef): string => {
      const entry = stored.find((e) => sameRef(e.ref, ref) && e.team === round.team) ?? stored.find((e) => sameRef(e.ref, ref));
      const formatted = entry === undefined ? '' : formatDay(entry.startedAt);
      return formatted === '' ? text.basis.unknownDay : formatted;
    };
    const practice = text.planning.practice(round.practice.length === 0 ? text.basis.none : text.basis.days(round.practice.map(day)));
    const qualifying = text.planning.qualifying(day(round.qualifying));
    if (round.rebuilding) return { head: text.planning.segment([practice, qualifying, text.planning.rebuilding]), rain: undefined, edited: false };
    const laps = text.topBar.laps(round.race.laps === null ? text.unknownMark.notReceived : formatCount(round.race.laps));
    const rows = round.forecast.rows;
    const rain = rows.known ? rows.value.map((row) => row.sample.rainPct) : [];
    return {
      head: text.planning.segment([practice, qualifying, laps, text.planning.sets[round.race.sets]]),
      rain: rows.known
        ? rain.length === 0
          ? { text: text.unknownMark.insufficientData, known: false }
          : { text: text.planning.rainRange(formatCount(Math.min(...rain)), formatCount(Math.max(...rain))), known: true }
        : { text: text.unknownMark[rows.reason], known: false },
      edited: rows.known && rows.value.some((row) => row.overridden),
    };
  });
</script>

{#if bar.betweenSessions}
  {#if shown !== undefined}
    <button type="button" class="pw-button" title={text.commandTitles.basisPick} onclick={() => bar.pickBasis()}
      >{shown.head}{#if shown.rain !== undefined}{text.separator}{text.planning.rain} <span style:color={shown.rain.known ? undefined : role('textFaint')}
          >{shown.rain.text}</span
        >{/if}{#if shown.edited} <span style:color={role('textDim')}>{text.planning.edited}</span>{/if}</button
    >
  {:else}
    <button type="button" class="pw-button" title={text.commandTitles.basisPick} onclick={() => bar.pickBasis()}>{text.planning.plan}</button>
  {/if}
{/if}
