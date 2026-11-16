// `pace-delta` (spec 4): time lost per lap after an event, and the reference pace before one (SP4.3c O12: `pit-loss`'s
// reference lap). Functions, imported by the units that use them.
import { known, unknown, type Known, type LapRecord, type Ms, type SessionTime } from '@pitwall/domain';
import type { DeepReadonly } from '@pitwall/engine/readers';
import { classifyLap, type LapClassOptions } from '../lap-classes/index.ts';

export * from './config.ts';

/** The pace laps `paceDelta` needs on each side of the event. */
export const MIN_LAPS = 2;

/** `paceDeltaAround`'s options: the pace window and the caller's `lap-classes` options (its config, never a default). */
export type PaceDeltaOptions = { window: number } & LapClassOptions;

const mean = (values: Ms[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * Time lost per lap after an event (positive = slower after): the mean of the pace laps after it minus the mean of
 * those before it, rounded to whole ms. At least two laps on each side: with fewer before it the delta can never be known
 * (`unknown('notApplicable')`, checked first); with fewer after it it is still waiting for laps
 * (`unknown('insufficientData')`). A known result carries `at`, the session time it is valid for.
 */
export function paceDelta(beforeMs: Ms[], afterMs: Ms[], at: SessionTime): Known<Ms> {
  if (beforeMs.length < MIN_LAPS) return unknown('notApplicable');
  if (afterMs.length < MIN_LAPS) return unknown('insufficientData');
  // whole ms (C4); `+ 0` turns a −0 into 0
  return known(Math.round(mean(afterMs) - mean(beforeMs)) + 0, at);
}

/** One car's pace laps among `laps` (by `opts`' lap-class options), by lap number. */
const paceLaps = (laps: readonly DeepReadonly<LapRecord>[], opts: PaceDeltaOptions): DeepReadonly<LapRecord>[] =>
  laps.filter((l) => classifyLap(l, opts).forPace).sort((a, b) => a.lapNumber - b.lapNumber);

/**
 * The reference pace before lap `beforeLap` of one car (SP4.3c O12, C43): the mean of its last `window` pace laps before
 * the lap (the lap itself not among them), rounded to whole ms, as of the newest lap used. Fewer pace laps than the
 * window: the mean of those there are; none: `unknown('insufficientData')`. `laps` holds one record per lap (see the
 * domain's `currentLaps`), in any order.
 */
export function referencePaceMs(laps: readonly DeepReadonly<LapRecord>[], beforeLap: number, opts: PaceDeltaOptions): Known<Ms> {
  const before = paceLaps(laps, opts)
    .filter((l) => l.lapNumber < beforeLap)
    .slice(-opts.window);
  const last = before[before.length - 1];
  if (last === undefined) return unknown('insufficientData');
  return known(Math.round(mean(before.map((l) => l.lapTimeMs))), last.completedAt);
}

/**
 * `paceDelta` around lap `lap` of one car: its last `window` pace laps before the lap against its first `window` pace
 * laps after it (the lap itself in neither), as of the newest lap used. `laps` holds one record per lap (see the
 * domain's `currentLaps`), in any order. Too few pace laps before the lap is `notApplicable` even with no laps after.
 * Which laps are pace laps follows `opts`' lap-class options.
 */
export function paceDeltaAround(
  laps: readonly DeepReadonly<LapRecord>[],
  lap: number,
  opts: PaceDeltaOptions,
): Known<Ms> {
  const pace = paceLaps(laps, opts);
  const before = pace.filter((l) => l.lapNumber < lap).slice(-opts.window);
  const after = pace.filter((l) => l.lapNumber > lap).slice(0, opts.window);
  const last = after[after.length - 1];
  if (before.length < MIN_LAPS) return unknown('notApplicable');
  if (last === undefined) return unknown('insufficientData');
  return paceDelta(
    before.map((l) => l.lapTimeMs),
    after.map((l) => l.lapTimeMs),
    last.completedAt,
  );
}
