// `race-hazard`'s budget (plan 4.3b1 Task 16 row 10): under 0.1 ms per run on the long-race builder (20 cars, 70 laps),
// on the views it runs on that cost most: at the leader's lap 70 (the projection largest) and under the lap-30 safety car
// (an open neutralised span), with Zandvoort's track file and the lobby's SC setting Standard. Its cadence is on change
// only, so a run is the unit of the budget. Each view counts its best of several warm passes, so machine load cannot
// flake it (docs/testing.md 6).
import { describe, expect, it } from 'vitest';
import { longRace } from '../../../../test-support/builders/long-race.ts';
import { raceHazardCalculator, withLobby } from './support.ts';

const PASSES = 25;
const TARGET_MS_PER_RUN = 0.1;

describe('race-hazard budget', () => {
  it(`budget: under ${TARGET_MS_PER_RUN} ms per run`, () => {
    const calc = raceHazardCalculator();
    const race = longRace();
    const views = [race.framesOfLap(31)[5]!, race.framesOfLap(70)[0]!, race.framesOfLap(70).at(-1)!].map((frame) => withLobby(race.viewAt(frame), 'standard'));
    // the SC view has its neutralisation open
    expect(views[0]!.situation.byMachine['session-phase-race']?.[0]?.kind).toBe('neutralised');
    for (const view of views) calc.compute(view); // warm
    let worst = 0;
    for (const view of views) {
      let best = Infinity;
      for (let k = 0; k < PASSES; k++) {
        const start = performance.now();
        calc.compute(view);
        best = Math.min(best, performance.now() - start);
      }
      worst = Math.max(worst, best);
    }
    console.info(`[race-hazard budget] worst of ${views.length} views: ${worst.toFixed(4)} ms per run (target ${TARGET_MS_PER_RUN} ms)`);
    expect(worst).toBeLessThan(TARGET_MS_PER_RUN);
  });
});
