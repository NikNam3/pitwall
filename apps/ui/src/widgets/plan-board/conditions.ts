// The plan board's race conditions (SP4.3f Task 7; spec §4.3, §4.4; mockup docs/design/2026-11-18-sp4.3f/
// plan-board-conditions.html): the editor's rows from the round's forecast rows (the bridge's: imported or entered,
// each marked overridden), and a changed row to the `entered` list `plans.race.set` sends. An entered row is time,
// weather and rain only; the bridge fills the temperatures (C3: never a made-up value). Pure, no DOM; the editor's
// draft rows (a typed rain chance, a row not committed yet) are window-local (C73).
import type { RoundForecast } from '@pitwall/contracts';
import type { EnteredSample, Known, Ms, RaceConditions, Weather } from '@pitwall/domain';
import { known } from '@pitwall/domain';

/** One row of the editor: the time after the race start, its weather and rain chance, and whether the user changed it. */
export type ConditionRow = { offsetMs: Ms; weather: Weather; rainPct: number; overridden: boolean };

/** A row of the editor's draft: its rain chance `null` until the user types one (never 0, C3). */
export type DraftRow = { offsetMs: Ms; weather: Weather; rainPct: number | null };

/** A row's change: its weather, its rain chance, or both. */
export type RowChange = { weather?: Weather; rainPct?: number };

/** The weathers in the weather field's order (the game's, driest first). */
export const WEATHERS = ['clear', 'lightCloud', 'overcast', 'lightRain', 'heavyRain', 'storm'] as const satisfies readonly Weather[];

/** A row added by `+ row`: this long after the last one (5 min), at +0 when there is none. */
export const ADDED_ROW_AFTER_MS = 300_000;
/** An added row's weather until the user picks one. */
export const ADDED_ROW_WEATHER: Weather = 'clear';

/** The editor's rows from the round's forecast rows, in their order; unknown rows stay unknown with their reason (C3). */
export function conditionRows(f: RoundForecast): Known<ConditionRow[]> {
  if (!f.rows.known) return f.rows;
  return known(
    f.rows.value.map(({ sample, overridden }) => ({ offsetMs: sample.offsetMs, weather: sample.weather, rainPct: sample.rainPct, overridden })),
    f.rows.at,
  );
}

/** Whether any of the round's rows is overridden (the source label reads `edited`); `false` while the rows are unknown. */
export const anyOverridden = (f: RoundForecast): boolean => f.rows.known && f.rows.value.some((r) => r.overridden);

/** An entered row: time, weather and rain only. */
const enteredOf = (r: { offsetMs: Ms; weather: Weather; rainPct: number }): EnteredSample => ({ offsetMs: r.offsetMs, weather: r.weather, rainPct: r.rainPct });

/**
 * The race's conditions after a change of row `index`: the round's whole list as `entered`, that row changed, every
 * other row's time, weather and rain as the round holds them. With the rows unknown, the editor's one row at +0 changed;
 * `null` while its rain chance is still to enter (C3: nothing is sent).
 */
export function enteredWith(f: RoundForecast, index: number, change: RowChange): RaceConditions | null {
  return enteredFrom(changeRow(draftOf(f), index, change));
}

/** The draft rows the editor starts from: the round's rows, or with none known one row to enter at +0. */
export function draftOf(f: RoundForecast): DraftRow[] {
  return f.rows.known ? f.rows.value.map(({ sample }) => enteredOf(sample)) : withAdded([]);
}

/** `rows` with one row added `ADDED_ROW_AFTER_MS` after the last (at +0 when there is none), its rain still to enter. */
export function withAdded(rows: readonly DraftRow[]): DraftRow[] {
  const last = rows.at(-1);
  const offsetMs = last === undefined ? 0 : last.offsetMs + ADDED_ROW_AFTER_MS;
  return [...rows, { offsetMs, weather: ADDED_ROW_WEATHER, rainPct: null }];
}

/** `rows` with row `index` changed. */
export function changeRow(rows: readonly DraftRow[], index: number, change: RowChange): DraftRow[] {
  return rows.map((r, i) => (i === index ? { ...r, ...change } : r));
}

/** The `entered` conditions of the draft rows; `null` while a row's rain chance is still to enter (nothing is sent). */
export function enteredFrom(rows: readonly DraftRow[]): RaceConditions | null {
  const samples: EnteredSample[] = [];
  for (const r of rows) {
    if (r.rainPct === null) return null;
    samples.push(enteredOf({ offsetMs: r.offsetMs, weather: r.weather, rainPct: r.rainPct }));
  }
  return { kind: 'entered', samples };
}
