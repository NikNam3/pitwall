// `race-hazard` against the race generator (plan 4.3b1 Task 16 row 7; Task 15's `hazard`): over 500 seeded lone-car races
// of 12 laps drawn from a known `TrackHazard`, the unit's chances recover the generator's. At the leader's last frame of
// lap L − 1 (for lap 1 its first frame, before any start), the unit's entry for lap L is each race's predicted chance;
// per lap and kind the observed starts on lap L over the races match the mean predicted chance within 3 SE, and a lap
// predicted 0 (one out, or the lap after it ended) sees no start. The durations: at the first frame a neutralisation is
// open (run 0 laps) the unit's `remainingLaps` is predicted; the observed laps left (its length − 1) match the mean
// within 3 SE per index. Seeded, so the verdict is fixed (C2).
import { known, type MachineId, type OpenSpan, type Span, type TrackHazard } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import type { BuilderRace } from '../../../../test-support/builders/long-race.ts';
import { generateRace, GENERATOR_DEFAULTS, type GeneratorCar } from '../../../../test-support/race-generator/index.ts';
import type { RaceHazardOutput } from '../../src/race-hazard/index.ts';
import { hazardOf, trackWith, withLobby } from './support.ts';

const RACES = 500;
const LAPS = 12;
const PHASES = 'session-phase-race' as MachineId;

/** High chances, so 500 races of 12 laps give every lap and duration enough draws (the generator test's table). */
const HAZARD: TrackHazard = {
  races: 50,
  lapOne: { sc: 0.12, vsc: 0.08 },
  byFraction: [
    { upTo: 0.37, sc: 0.05, vsc: 0.04 },
    { upTo: 0.71, sc: 0.03, vsc: 0.06 },
    { upTo: 1, sc: 0.07, vsc: 0.03 },
  ],
  durationLaps: { sc: [0.25, 0.45, 0.3], vsc: [0.55, 0.45] },
};
const TRACK = trackWith(known({ value: HAZARD, source: 'test' }, 0));

const CAR: GeneratorCar = { paceMs: 90_000, human: false, sigmaMs: 0, rho: 0, mistakeRate: 0, mistakeMedianMs: 1_000, mistakeSigmaLog: 0.5, wearFactor: 1, stops: [] };

type Start = { kind: 'sc' | 'vsc'; startLap: number; startFrame: number; /** `Infinity` while still out at the flag. */ endLap: number };

/** The race's neutralisations, each with the leader laps it was deployed and in during. */
function startsOf(race: BuilderRace): Start[] {
  const lapOf = new Map<number, number>();
  for (let lap = 1; lap <= race.laps; lap++) for (const frame of race.framesOfLap(lap)) lapOf.set(frame, lap);
  const { history, situation } = race.viewAt(race.lastFrame);
  const spans: Array<Span | OpenSpan> = [...(history.spans[PHASES] ?? []), ...(situation.byMachine[PHASES] ?? [])];
  return spans
    .filter((s) => s.kind === 'neutralised')
    .map((s) => ({
      kind: (s.detail as { car: 'SC' | 'VSC' }).car === 'SC' ? ('sc' as const) : ('vsc' as const),
      startLap: lapOf.get(s.startFrame) ?? Number.NaN,
      startFrame: s.startFrame,
      endLap: 'endFrame' in s ? (lapOf.get(s.endFrame) ?? Infinity) : Infinity,
    }));
}

const within3Se = (observed: number, n: number, p: number, label: string): void => {
  const se = Math.sqrt((p * (1 - p)) / n);
  expect(Math.abs(observed / n - p), `${label}: ${observed}/${n} against ${p.toFixed(4)} (SE ${se.toFixed(4)})`).toBeLessThanOrEqual(3 * se);
};

const valueOf = (out: RaceHazardOutput) => {
  if (!out.known) throw new Error(`race-hazard: unknown (${out.reason})`);
  return out.value;
};

describe('race-hazard against the generator (Task 15)', () => {
  it("recovers the generator's hazard within 3 SE over 500 races", { timeout: 180_000 }, () => {
    // per lap and kind: the races, the sum of their predicted chances, the observed starts
    const perLap = Array.from({ length: LAPS + 1 }, () => ({ sc: { n: 0, p: 0, starts: 0 }, vsc: { n: 0, p: 0, starts: 0 } }));
    let zeroWithStart = 0;
    // per kind and laps-left index: the predicted probability summed, the observed count, the neutralisations
    const left = { sc: { n: 0, p: [0, 0, 0], seen: [0, 0, 0] }, vsc: { n: 0, p: [0, 0], seen: [0, 0] } };
    const params = { ...GENERATOR_DEFAULTS, cars: 1, field: [CAR], laps: LAPS, hazard: HAZARD };
    for (let seed = 1; seed <= RACES; seed++) {
      const { race } = generateRace(params, seed);
      const starts = startsOf(race);
      const at = (frame: number): EngineView => withLobby(race.viewAt(frame), 'standard', TRACK);
      for (let lap = 1; lap <= LAPS; lap++) {
        const frame = lap === 1 ? race.framesOfLap(1)[0]! : race.framesOfLap(lap - 1).at(-1)!;
        // lap 1's first frame: no start counted that is already open then
        if (lap === 1 && starts.some((s) => s.startFrame <= frame)) continue;
        const e = valueOf(hazardOf(at(frame))).byLap.find((x) => x.lap === lap);
        expect(e, `seed ${seed} lap ${lap}`).toBeDefined();
        for (const kind of ['sc', 'vsc'] as const) {
          const started = starts.some((s) => s.kind === kind && s.startLap === lap);
          const cell = perLap[lap]![kind];
          cell.n++;
          cell.p += e![kind];
          if (started) cell.starts++;
          if (e![kind] === 0 && started) zeroWithStart++;
        }
      }
      for (const s of starts) {
        const max = HAZARD.durationLaps[s.kind].length;
        // only those the flag cannot cut short
        if (s.startLap + max - 1 > LAPS) continue;
        const active = valueOf(hazardOf(at(s.startFrame))).active;
        expect(active?.condition, `seed ${seed}`).toBe(s.kind);
        const cell = left[s.kind];
        cell.n++;
        active!.remainingLaps.forEach((p, i) => (cell.p[i] = (cell.p[i] ?? 0) + p));
        cell.seen[s.endLap - s.startLap]!++;
      }
    }
    expect(zeroWithStart, 'starts on a lap predicted 0').toBe(0);
    let checked = 0;
    for (let lap = 1; lap <= LAPS; lap++) {
      for (const kind of ['sc', 'vsc'] as const) {
        const { n, p, starts } = perLap[lap]![kind];
        if (n === 0 || p === 0) continue;
        within3Se(starts, n, p / n, `${kind} on lap ${lap}`);
        checked++;
      }
    }
    expect(checked).toBe(2 * LAPS);
    for (const kind of ['sc', 'vsc'] as const) {
      const { n, p, seen } = left[kind];
      expect(n, `${kind} neutralisations`).toBeGreaterThan(50);
      seen.forEach((count, i) => within3Se(count, n, p[i]! / n, `${kind} with ${i} laps left`));
    }
  });
});
