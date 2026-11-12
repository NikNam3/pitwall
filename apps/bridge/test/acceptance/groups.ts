// The acceptance groups: which whole recordings each group file replays, and the per-group test bodies. Not a test file:
// each `*.acceptance.test.ts` group file calls one body with its group, so the files run in parallel and the gate's wall
// time is bounded by the slowest single recording. `groups.acceptance.test.ts` pins that the groups together are exactly
// the old sets (every race recording of `fixtures/index.json`; the seven determinism recordings).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CROSSOVER,
  CROSSOVER_CONFIG,
  crossoverCalculator,
  LAP_CLASSES_CONFIG,
  LAP_OVERVIEW,
  lapOverviewCalculator,
  PIT_LOSS,
  pitLossCalculator,
  type CrossoverOutput,
  type LapOverviewOutput,
  type PitLossOutput,
} from '@pitwall/analysis';
import { currentLaps, unknown, type LapRecord, type PitStopRecord } from '@pitwall/domain';
import { CalculatorRegistry, Scheduler, situationOf, type DeepReadonly, type EngineState, type StepResult } from '@pitwall/engine';
import { expect, it } from 'vitest';
import { IDLE_FEED, NO_DRIVERS, NO_PRIORS } from '../../../../test-support/builders/index.ts';
import { describeWithFixture, FIXTURES, type FixtureName } from '../../../../test-support/fixtures.ts';
import { topicStreamHash } from '../../src/pipeline/stream-hash.ts';
import { replayScheduled } from '../fixtures/engine-replay.ts';

// User ruling 2026-11-12: the acceptance gate must not grow; raceSpaSc (646 MB) is a fixture for segments and `pitwall score` only.
/** Race recordings of `fixtures/index.json` that no acceptance test replays. */
export const NOT_IN_ACCEPTANCE: readonly FixtureName[] = ['raceSpaSc'];

/** Every race recording of `fixtures/index.json`, except those not in acceptance. */
const index = JSON.parse(readFileSync(join(import.meta.dirname, '../../../../fixtures/index.json'), 'utf8')) as {
  fixtures: Array<{ id: string; sessionType: string | null }>;
};
export const RACES = index.fixtures.filter((f) => f.sessionType === 'race').map((f) => f.id as FixtureName).filter((id) => !NOT_IN_ACCEPTANCE.includes(id));

/** The race groups, one file each: each of the two heaviest races alone, the other six together. */
export const RACE_GROUPS = {
  singaporeWet: ['raceSingaporeWet'],
  wetVscMexico: ['raceWetVscMexico'],
  others: ['raceFriendWet', 'raceLiveTest', 'raceZandvoortUidReuse', 'raceLiveTestAbandoned', 'raceZandvoortOnline', 'raceSingapore'],
} as const satisfies Record<string, readonly FixtureName[]>;

// User ruling 2026-10-30: the time trial is too special a case, and the big races (raceSingaporeWet, raceZandvoortUidReuse, raceWetVscMexico, raceFriendWet) and practiceFriendWings (55 MB) cost too long.
/** The determinism recordings, as one list (the old file's seven). */
export const DETERMINISM: readonly FixtureName[] = ['raceSingapore', 'menuOnly', 'qualifyingSingapore', 'practiceZandvoortOnline', 'raceZandvoortOnline', 'practiceZandvoortUidReuse', 'lobbyOnly'];

/** The determinism groups, one file each: each of the two heaviest with a light one, the other three together; at least two each, so the hashes can differ. */
export const DETERMINISM_GROUPS = {
  qualifyingSingapore: ['qualifyingSingapore', 'menuOnly'],
  practiceZandvoortOnline: ['practiceZandvoortOnline', 'lobbyOnly'],
  others: ['raceSingapore', 'raceZandvoortOnline', 'practiceZandvoortUidReuse'],
} as const satisfies Record<string, readonly FixtureName[]>;

const { maxNeutralisedMs } = LAP_CLASSES_CONFIG.defaults;
const { line110 } = CROSSOVER_CONFIG.defaults;

// spec 8 (`pit-loss`, supervisor ruling 2026-11-06), plan Task 19: the real-data check of `pit-loss` as a property over
// every race recording, since a stop with its reference laps is beyond C84's segment limit. Only properties, no fact of a
// recording (C84): every counted green loss lies in the sanity band 0 < loss < 2 × the stop's pit-lane time (supervisor
// ruling R18); every stop is classed by its record's flag. The band, not "loss > pit-lane time": the TUM loss is roughly the
// pit-lane time minus the on-track time for the same stretch, plus the stationary time, so real stops lie on both sides of
// the pit-lane time; a loss at or below 0, or at twice the pit-lane time and more, is no plausible stop.
//
// SP4.1b spec 3.2, 3.4, 6.1 (plan Task 13): the real-data check of `lap-overview` and `crossover` as properties over every
// race recording at the session's end, since `crossover` spans several laps and fits no segment (C84; user ruling in the
// plan review, 2026-11-06). Only properties, no fact of a recording (C84). After the replay's last frame a scheduler that
// needs both units (and `pit-loss`, which `crossover` reads) runs them on the final view: a newly needed unit runs at once
// against the current view (C49); all three are quick or equal from scratch (C31.3).
//
// One replay per race serves both: `pit-loss` scheduled on every frame, and the long-run units on its last step.
/** The pit-loss and long-run checks over the races of one group, each race replayed once. */
export function racesAcceptance(group: readonly FixtureName[]): void {
  /** The used green stops checked per race, so the pin below fails instead of passing vacuously. */
  const checkedStops = new Map<FixtureName, number>();
  /** Per race, the laps whose status was checked and our cars whose crossover was, so the pin below fails instead of passing vacuously. */
  const checkedLongRun = new Map<FixtureName, { laps: number; ourCars: number }>();

  for (const name of group) {
    describeWithFixture(name, `pit-loss and long-run units on real races: ${name}`, (path) => {
      let output: PitLossOutput | undefined;
      let records: readonly DeepReadonly<PitStopRecord>[] = [];
      const errors: unknown[] = [];
      let last: StepResult | undefined;
      let overview: LapOverviewOutput = {};
      let crossover: CrossoverOutput = {};
      let state: DeepReadonly<EngineState> | undefined;
      const entry = { laps: 0, ourCars: 0 };

      it('replays without a pit-loss error', async () => {
        const runner = await replayScheduled(path, [pitLossCalculator], (r, scheduled) => {
          errors.push(...scheduled.errors.map((e) => e.error));
          output = scheduled.outputs.get(PIT_LOSS) as PitLossOutput | undefined;
          last = r;
        });
        records = runner.state.history.pitStops;
        expect(errors).toEqual([]);
      });

      /** The record of `stop`: same car, lap and stationary time (a car stops at most once per lap and stationary time). */
      const recordOf = (stop: PitLossOutput['stops'][number]) => {
        const matches = records.filter((r) => r.carId === stop.carId && r.lap === stop.lap && r.stationaryTimeMs === stop.stationaryMs);
        expect(matches, `the record of car ${stop.carId}'s stop on lap ${stop.lap}`).toHaveLength(1);
        return matches[0]!;
      };

      it("every used green stop's loss is known and lies between 0 and twice its stop's pit-lane time", () => {
        const stops = output?.stops ?? [];
        expect(stops).toHaveLength(records.length);
        const green = stops.filter((s) => s.use === 'used' && s.condition === 'green');
        checkedStops.set(name, green.length);
        // every violating stop at once, with its numbers
        const violations = green.flatMap((stop) => {
          const pitLaneTimeMs = recordOf(stop).pitLaneTimeMs;
          const lossMs = stop.lossMs.known ? stop.lossMs.value : 'unknown';
          const inBand = lossMs !== 'unknown' && lossMs > 0 && lossMs < 2 * pitLaneTimeMs;
          return inBand ? [] : [{ carId: stop.carId, lap: stop.lap, lossMs, pitLaneTimeMs }];
        });
        expect(violations, `${violations.length} of ${green.length} used green stops outside the band: ${JSON.stringify(violations)}`).toEqual([]);
      });

      it("every stop's condition equals its record's flag", () => {
        for (const stop of output?.stops ?? []) expect(stop.condition, `car ${stop.carId} lap ${stop.lap}`).toBe(recordOf(stop).flag);
      });

      it('replays and runs lap-overview and crossover at the session end without an error', () => {
        expect(last).toBeDefined();
        if (last === undefined) return;
        state = last.state;
        const scheduler = new Scheduler(CalculatorRegistry.build([pitLossCalculator, lapOverviewCalculator, crossoverCalculator]), { freezeOutputs: true });
        scheduler.setNeeded([LAP_OVERVIEW, CROSSOVER]);
        const { changed, delta } = last;
        const scheduled = scheduler.run({ live: state, situation: situationOf(state), history: state.history, changed, delta, weekend: state.weekend, feed: IDLE_FEED, config: {}, priors: NO_PRIORS, drivers: NO_DRIVERS, track: unknown('notApplicable') });
        expect(scheduled.errors).toEqual([]);
        expect(scheduled.ran).toEqual(expect.arrayContaining([LAP_OVERVIEW, CROSSOVER]));
        overview = scheduled.outputs.get(LAP_OVERVIEW) as LapOverviewOutput;
        crossover = scheduled.outputs.get(CROSSOVER) as CrossoverOutput;
        checkedLongRun.set(name, entry);
      });

      it("every lap that is not `red` is `sc` iff its neutralised time reaches `maxNeutralisedMs` with `scShare` > 0, `vsc` iff it reaches it with `scShare` = 0, else `green`", () => {
        const laps = new Map(currentLaps((state?.history.laps ?? []) as LapRecord[]).map((l) => [`${l.carId}:${l.lapNumber}`, l]));
        const violations: unknown[] = [];
        for (const [carId, car] of Object.entries(overview)) {
          for (const lap of car.laps) {
            if (lap.status === 'red') continue;
            const record = laps.get(`${carId}:${lap.lapNumber}`);
            expect(record, `the record of car ${carId} lap ${lap.lapNumber}`).toBeDefined();
            if (record === undefined) continue;
            const neutralisedMs = (record.scShare + record.vscShare) * record.lapTimeMs;
            const expected = neutralisedMs < maxNeutralisedMs ? 'green' : record.scShare > 0 ? 'sc' : 'vsc';
            if (lap.status !== expected) violations.push({ carId, lap: lap.lapNumber, status: lap.status, expected, neutralisedMs, scShare: record.scShare });
            entry.laps++;
          }
        }
        expect(violations, `${violations.length} laps with another status: ${JSON.stringify(violations)}`).toEqual([]);
      });

      it('every known heat lies in [0, 1]', () => {
        const outside = Object.entries(overview).flatMap(([carId, car]) =>
          car.laps.flatMap((l) => (l.heat.known && !(l.heat.value >= 0 && l.heat.value <= 1) ? [{ carId, lap: l.lapNumber, heat: l.heat.value }] : [])),
        );
        expect(outside).toEqual([]);
      });

      it('at most one lap is the session best', () => {
        const bests = Object.entries(overview).flatMap(([carId, car]) => car.laps.filter((l) => l.best === 'session').map((l) => ({ carId, lap: l.lapNumber })));
        expect(bests.length, JSON.stringify(bests)).toBeLessThanOrEqual(1);
      });

      it('for our cars: the dry reference is at most every known slick median, the 110 % line is round(dryRefMs × line110), a known payback is positive, the first faster car is on a type other than ours', () => {
        const ours = Object.entries(crossover);
        expect(ours.length).toBeGreaterThan(0);
        for (const [carId, c] of ours) {
          const label = `car ${carId}`;
          if (c.dryRefMs.known) {
            for (const row of c.byLap) {
              const slick = row.medianMs.slick;
              if (slick.known) expect(c.dryRefMs.value, `${label} lap ${row.lapNumber}`).toBeLessThanOrEqual(slick.value);
            }
            expect(c.line110Ms, label).toMatchObject({ known: true, value: Math.round(c.dryRefMs.value * line110) });
          } else {
            expect(c.line110Ms.known, label).toBe(false);
          }
          if (c.payback.known) expect(c.payback.value.laps, label).toBeGreaterThan(0);
          if (c.firstFaster.known) {
            expect(c.ourType.known, label).toBe(true);
            if (c.ourType.known) expect(c.firstFaster.value.type, label).not.toBe(c.ourType.value);
          }
          entry.ourCars++;
        }
      });
    });
  }

  // Per group, stronger than the old pin over all races: every group has a used green stop of its own and laps checked.
  it('every race of the group was checked, and together they have a used green stop (not vacuous)', () => {
    expect(group.length).toBeGreaterThan(0);
    expect(group.every((r) => r in FIXTURES)).toBe(true);
    expect([...checkedStops.keys()].sort()).toEqual([...group].sort());
    expect([...checkedStops.values()].reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });

  it('every race of the group was checked, and together they have laps and our cars checked (not vacuous)', () => {
    expect(group.length).toBeGreaterThan(0);
    expect(group.every((r) => r in FIXTURES)).toBe(true);
    expect([...checkedLongRun.keys()].sort()).toEqual([...group].sort());
    expect([...checkedLongRun.values()].reduce((a, b) => a + b.laps, 0)).toBeGreaterThan(0);
    expect([...checkedLongRun.values()].every((c) => c.ourCars > 0)).toBe(true);
  });
}

// spec 3.4 / 10.2, acceptance criterion 3
/** The determinism check over the recordings of one group: each replayed twice, and the group's hashes pairwise different. */
export function determinismAcceptance(group: readonly FixtureName[]): void {
  const hashes = new Map<FixtureName, string>();
  for (const name of group) {
    describeWithFixture(name, `determinism: ${name}`, (path) => {
      it('replaying twice gives an identical topic stream', async () => {
        const a = await topicStreamHash(path);
        expect(a).toMatch(/^[0-9a-f]{64}$/);
        expect(await topicStreamHash(path)).toBe(a);
        hashes.set(name, a);
      });
    });
  }
  it('different recordings give different streams (the hash is not constant)', () => {
    // pinned: when a fixture was skipped or failed, `hashes` is short and this fails instead of passing vacuously
    expect(group.length).toBeGreaterThanOrEqual(2);
    expect([...hashes.keys()].sort()).toEqual([...group].sort());
    expect(new Set(hashes.values()).size).toBe(group.length);
  });
}
