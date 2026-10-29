// `pace-delta` (spec 4): time lost per lap after an event. A function, imported by the analyses that use it.
import { known, unknown, type Known, type LapRecord, type Ms, type SessionTime } from '@pitwall/domain';
import type { DeepReadonly } from '@pitwall/engine';
import { classifyLap } from '../lap-classes/index.ts';

const MIN_LAPS = 2;

const mean = (values: Ms[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * Time lost per lap after an event (positive = slower after): the mean of the pace laps after it minus the mean of
 * those before it. At least two laps on each side, otherwise `unknown('insufficientData')`. A known result carries
 * `at`, the session time it is valid for.
 */
export function paceDelta(beforeMs: Ms[], afterMs: Ms[], at: SessionTime): Known<Ms> {
  if (beforeMs.length < MIN_LAPS || afterMs.length < MIN_LAPS) return unknown('insufficientData');
  return known(mean(afterMs) - mean(beforeMs), at);
}

/**
 * `paceDelta` around lap `lap` of one car: its last `window` pace laps before the lap against its first `window` pace
 * laps after it (the lap itself in neither), as of the newest lap used. `laps` holds one record per lap (see the
 * domain's `currentLaps`), in any order.
 */
export function paceDeltaAround(
  laps: readonly DeepReadonly<LapRecord>[],
  lap: number,
  opts: { window: number; isRace: boolean },
): Known<Ms> {
  const pace = laps.filter((l) => classifyLap(l, opts).forPace).sort((a, b) => a.lapNumber - b.lapNumber);
  const before = pace.filter((l) => l.lapNumber < lap).slice(-opts.window);
  const after = pace.filter((l) => l.lapNumber > lap).slice(0, opts.window);
  const last = after[after.length - 1];
  if (last === undefined) return unknown('insufficientData');
  return paceDelta(
    before.map((l) => l.lapTimeMs),
    after.map((l) => l.lapTimeMs),
    last.completedAt,
  );
}
