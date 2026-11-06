// SP4.1b spec 3.2, 3.4, 6.1 (plan Task 13): the real-data check of `lap-overview` and `crossover` as properties over every
// race recording at the session's end, since `crossover` spans several laps and fits no segment (C84; user ruling in the
// plan review, 2026-11-06). Only properties, no fact of a recording (C84). After the replay's last frame a scheduler that
// needs both units (and `pit-loss`, which `crossover` reads) runs them on the final view: a newly needed unit runs at once
// against the current view (C49); all three are quick or equal from scratch (C31.3).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CROSSOVER,
  CROSSOVER_CONFIG,
  crossoverCalculator,
  LAP_CLASSES_CONFIG,
  LAP_OVERVIEW,
  lapOverviewCalculator,
  pitLossCalculator,
  type CrossoverOutput,
  type LapOverviewOutput,
} from '@pitwall/analysis';
import { currentLaps, unknown, type LapRecord } from '@pitwall/domain';
import { CalculatorRegistry, Scheduler, situationOf, type DeepReadonly, type EngineState, type StepResult } from '@pitwall/engine';
import { expect, it } from 'vitest';
import { IDLE_FEED, NO_PRIORS } from '../../../../test-support/builders/index.ts';
import { describeWithFixture, FIXTURES, type FixtureName } from '../../../../test-support/fixtures.ts';
import { replayRunner } from '../fixtures/engine-replay.ts';

/** Every race recording of `fixtures/index.json`. */
const index = JSON.parse(readFileSync(join(import.meta.dirname, '../../../../fixtures/index.json'), 'utf8')) as {
  fixtures: Array<{ id: string; sessionType: string | null }>;
};
const races = index.fixtures.filter((f) => f.sessionType === 'race').map((f) => f.id as FixtureName);

const { maxNeutralisedMs } = LAP_CLASSES_CONFIG.defaults;
const { line110 } = CROSSOVER_CONFIG.defaults;

/** Per race, the laps whose status was checked and our cars whose crossover was, so the pin below fails instead of passing vacuously. */
const checked = new Map<FixtureName, { laps: number; ourCars: number }>();

for (const name of races) {
  describeWithFixture(name, `long-run units on real races: ${name}`, (path) => {
    let overview: LapOverviewOutput = {};
    let crossover: CrossoverOutput = {};
    let state: DeepReadonly<EngineState> | undefined;
    const entry = { laps: 0, ourCars: 0 };

    it('replays and runs lap-overview and crossover at the session end without an error', async () => {
      let last: StepResult | undefined;
      await replayRunner(path, (r) => {
        last = r;
      });
      expect(last).toBeDefined();
      if (last === undefined) return;
      state = last.state;
      const scheduler = new Scheduler(CalculatorRegistry.build([pitLossCalculator, lapOverviewCalculator, crossoverCalculator]), { freezeOutputs: true });
      scheduler.setNeeded([LAP_OVERVIEW, CROSSOVER]);
      const { changed, delta } = last;
      const scheduled = scheduler.run({ live: state, situation: situationOf(state), history: state.history, changed, delta, weekend: state.weekend, feed: IDLE_FEED, config: {}, priors: NO_PRIORS, track: unknown('notApplicable') });
      expect(scheduled.errors).toEqual([]);
      expect(scheduled.ran).toEqual(expect.arrayContaining([LAP_OVERVIEW, CROSSOVER]));
      overview = scheduled.outputs.get(LAP_OVERVIEW) as LapOverviewOutput;
      crossover = scheduled.outputs.get(CROSSOVER) as CrossoverOutput;
      checked.set(name, entry);
    });

    it("every lap that is not `red` is `sc` iff its neutralised time reaches `maxNeutralisedMs` with `scShare` > 0, `vsc` iff it reaches it with `scShare` = 0, else `green`", () => {
      const records = new Map(currentLaps((state?.history.laps ?? []) as LapRecord[]).map((l) => [`${l.carId}:${l.lapNumber}`, l]));
      const violations: unknown[] = [];
      for (const [carId, car] of Object.entries(overview)) {
        for (const lap of car.laps) {
          if (lap.status === 'red') continue;
          const record = records.get(`${carId}:${lap.lapNumber}`);
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

it('every race recording was checked, and together they have laps and our cars checked (not vacuous)', () => {
  expect(races.length).toBeGreaterThan(0);
  expect(races.every((r) => r in FIXTURES)).toBe(true);
  expect([...checked.keys()].sort()).toEqual([...races].sort());
  expect([...checked.values()].reduce((a, b) => a + b.laps, 0)).toBeGreaterThan(0);
  expect([...checked.values()].every((c) => c.ourCars > 0)).toBe(true);
});
