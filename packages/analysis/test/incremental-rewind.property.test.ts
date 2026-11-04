// Every incremental unit is incremental = from scratch at every step of random races with rewinds (contract C31.3, C33;
// ruling Task 22 round 6). The races are made once for the file: 8 random races of 300 frames whose run rewinds (once, or
// twice back to back), which appends a void fact (C27), run once through the engine and every step's projection recorded
// frozen. Each unit then runs a scheduler over the recorded steps and, at every step it ran, also after every rewind,
// its accumulator equals `init` over that step's view (ruling Task 22 round 7): the projection and the config alone,
// the live state and the situation throwing on any read (C31.2), no guard (C41 is the guarded-view completeness test's
// and the units' own tests').
import fc from 'fast-check';
import type { SchedulerInput } from '@pitwall/engine/readers';
import { beforeAll, describe, expect, it } from 'vitest';
import { arbRace, raceFrames, type RaceParams } from '../../engine/test/support/arb-race.ts';
import { expectIncrementalOverSteps, recordRun } from '../../engine/test/support/scheduler.ts';
import { CALCULATORS } from './units.ts';

/** The races: as many and as long as the property ran per unit before (Task 22). */
const RACES = 8;
const FRAMES = 300;

/** The generated races with a rewind (perhaps two back to back): each appends a void fact (C27). */
const WITH_REWINDS = arbRace.filter((p) => p.flashback !== undefined);

/** The incremental units of the package, by id. */
const INCREMENTAL = CALCULATORS.filter((c) => c.kind === 'incremental');

/** The seed of this run's races: reported on a failure, so the races can be made again (`fc.sample` with it). */
const SEED = fc.sample(fc.integer(), 1)[0]!;

const races: Array<{ params: RaceParams; steps: SchedulerInput[] }> = [];

/** Races drawn at most, to find `RACES` whose run rewinds (a drawn rewind lands before the race start and is dropped). */
const DRAWN = 4 * RACES;

beforeAll(() => {
  for (const params of fc.sample(WITH_REWINDS, { numRuns: DRAWN, seed: SEED })) {
    if (races.length === RACES) break;
    const { frames } = raceFrames({ ...params, frames: FRAMES });
    // a drawn rewind that lands before the race start is dropped: its frames never go back
    if (!frames.some((f, i) => i > 0 && f.frameId <= frames[i - 1]!.frameId)) continue;
    const steps = recordRun(frames);
    if (steps.some((step) => step.delta.rewound !== undefined)) races.push({ params, steps });
  }
});

describe('every incremental unit is incremental = from scratch across random rewinds (C31.3)', () => {
  it('covers the five incremental units, each race with its rewind run through the engine', () => {
    expect(INCREMENTAL.map((c) => c.id).sort()).toEqual(['damage', 'gaps', 'incidents', 'lap-times', 'pace']);
    expect(races.length, `races of seed ${SEED} that rewind`).toBe(RACES);
  });

  for (const calc of INCREMENTAL) {
    it(`${calc.id}: its accumulator equals init over the projection at every step of every race, each with a void fact`, () => {
      if (calc.kind !== 'incremental') throw new Error(`${calc.id} is not incremental`);
      races.forEach(({ params, steps }, i) => expectIncrementalOverSteps(calc, steps, `race ${i} (seed ${SEED}, ${JSON.stringify(params)}), `));
    });
  }
});
