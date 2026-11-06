// `lap-times`, the newest sectors over random fields (Task A1, live polish spec 3.4): at most one car per sector column is
// sessionBest at any frame, and a sessionBest newest time is no slower than any time its column's session best counts:
// the completed laps' session best and every valid live sector a car's current pass has finished.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { passScene, PRACTICE, Q3, RACE, run, sectorLap, type PassSpec } from './scene.ts';

/** Sector times from a small set, so equal times are common. */
const time = fc.integer({ min: 0, max: 6 }).map((k) => 28_000 + 100 * k);

/** One car: perhaps a completed lap 1, and its current pass (lap 2 after a completed lap, else lap 1). */
const arbCar = fc.record({
  completed: fc.option(fc.tuple(time, time, time), { nil: undefined }),
  sector: fc.constantFrom(1 as const, 2 as const, 3 as const),
  s1: time,
  s2: time,
  lineAt: fc.integer({ min: 100_000, max: 100_400 }),
  invalid: fc.boolean(),
});

const arbField = fc.record({
  phase: fc.constantFrom(PRACTICE, Q3, RACE),
  cars: fc.array(arbCar, { minLength: 2, maxLength: 6 }),
});

describe('lap-times newest sectors over random fields', () => {
  it('at most one car per column is sessionBest, and it is no slower than any time the session best counts', () => {
    fc.assert(
      fc.property(arbField, ({ phase, cars }) => {
        const laps = cars.flatMap((c, i) => (c.completed === undefined ? [] : [sectorLap(i, 1, c.completed, c.lineAt)]));
        const passes = cars.map(
          (c): PassSpec => ({
            lap: c.completed === undefined ? 1 : 2,
            sector: c.sector,
            s1: c.sector > 1 ? c.s1 : 0,
            s2: c.sector > 2 ? c.s2 : 0,
            lineAt: c.lineAt,
            invalid: c.invalid,
          }),
        );
        const out = run(passScene({ passes, laps, phase }));
        for (const i of [0, 1, 2] as const) {
          const pink = out.rows.filter((r) => r.newestSectorStatus[i] === 'sessionBest');
          expect(pink.length, `column S${i + 1}`).toBeLessThanOrEqual(1);
          if (pink.length === 0) continue;
          const ms = pink[0]!.newestSectorsMs[i];
          expect(ms.known).toBe(true);
          const pinkMs = (ms as { value: number }).value;
          const record = out.sessionBest.sectors[i];
          if (record.known) expect(pinkMs).toBeLessThanOrEqual(record.value.ms);
          const live = i === 2 ? [] : cars.filter((c) => !c.invalid && c.sector > i + 1).map((c) => (i === 0 ? c.s1 : c.s2));
          for (const t of live) expect(pinkMs).toBeLessThanOrEqual(t);
        }
      }),
      { numRuns: 300 },
    );
  });
});
