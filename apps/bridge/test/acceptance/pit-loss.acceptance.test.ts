// spec 8 (`pit-loss`, supervisor ruling 2026-11-06), plan Task 19: the real-data check of `pit-loss` as a property over
// every race recording, since a stop with its reference laps is beyond C84's segment limit. Only properties, no fact of a
// recording (C84): every counted green loss exceeds its stop's pit-lane time; every stop is classed by its record's flag.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pitLossCalculator, PIT_LOSS, type PitLossOutput } from '@pitwall/analysis';
import type { PitStopRecord } from '@pitwall/domain';
import type { DeepReadonly } from '@pitwall/engine';
import { expect, it } from 'vitest';
import { describeWithFixture, FIXTURES, type FixtureName } from '../../../../test-support/fixtures.ts';
import { replayScheduled } from '../fixtures/engine-replay.ts';

/** Every race recording of `fixtures/index.json`. */
const index = JSON.parse(readFileSync(join(import.meta.dirname, '../../../../fixtures/index.json'), 'utf8')) as {
  fixtures: Array<{ id: string; sessionType: string | null }>;
};
const races = index.fixtures.filter((f) => f.sessionType === 'race').map((f) => f.id as FixtureName);

/** The used green stops checked per race, so the pin below fails instead of passing vacuously. */
const checked = new Map<FixtureName, number>();

for (const name of races) {
  describeWithFixture(name, `pit-loss on real races: ${name}`, (path) => {
    let output: PitLossOutput | undefined;
    let records: readonly DeepReadonly<PitStopRecord>[] = [];
    const errors: unknown[] = [];

    it('replays without a pit-loss error', async () => {
      const runner = await replayScheduled(path, [pitLossCalculator], (_r, scheduled) => {
        errors.push(...scheduled.errors.map((e) => e.error));
        output = scheduled.outputs.get(PIT_LOSS) as PitLossOutput | undefined;
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

    it("every used green stop's loss is known and exceeds its stop's pit-lane time", () => {
      const stops = output?.stops ?? [];
      expect(stops).toHaveLength(records.length);
      const green = stops.filter((s) => s.use === 'used' && s.condition === 'green');
      checked.set(name, green.length);
      // every violating stop at once, with its numbers
      const violations = green.flatMap((stop) => {
        const pitLaneTimeMs = recordOf(stop).pitLaneTimeMs;
        const lossMs = stop.lossMs.known ? stop.lossMs.value : 'unknown';
        return lossMs === 'unknown' || lossMs <= pitLaneTimeMs ? [{ carId: stop.carId, lap: stop.lap, lossMs, pitLaneTimeMs }] : [];
      });
      expect(violations, `${green.length} used green stops`).toEqual([]);
    });

    it("every stop's condition equals its record's flag", () => {
      for (const stop of output?.stops ?? []) expect(stop.condition, `car ${stop.carId} lap ${stop.lap}`).toBe(recordOf(stop).flag);
    });
  });
}

it('every race recording was checked, and together they have a used green stop (not vacuous)', () => {
  expect(races.length).toBeGreaterThan(0);
  expect(races.every((r) => r in FIXTURES)).toBe(true);
  expect([...checked.keys()].sort()).toEqual([...races].sort());
  expect([...checked.values()].reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
});
