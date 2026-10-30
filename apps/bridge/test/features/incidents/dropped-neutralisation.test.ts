// A neutralisation the safety car status never confirms is dropped 3 s after its SCAR, and the step that drops it
// discards a timeline (`delta.truncated`, review 2 B2): `incidents` starts over from the history, so a time loss it had
// excluded while the deployment waited is reported, as in a run from scratch. Builder frames, the engine and the
// calculator under a scheduler that restarts on a truncated step, as the bridge's does. The player laps a 1000 m track
// in 25 frames, stands still for 2.3 s in lap 5 from the frame of an SC deployment, then drives on.
import { describe, expect, it } from 'vitest';
import { INCIDENTS, incidentsCalculator, type IncidentsOutput } from '@pitwall/analysis';
import { activeFlagPhaseOf, CalculatorRegistry, Scheduler, SessionRunner, situationOf, type Frame } from '@pitwall/engine';
import { IDLE_FEED } from '../../../../../test-support/builders/index.ts';
import { initFor } from '../../../../../packages/engine/test/support/run.ts';
import { gridStart, lap, scar, script, STEP } from '../../../../../packages/engine/test/situations/script.ts';

const TRACK_M = 1000;
/** Race frame of the stop and of the SC deployment, mid-way through a mini-sector of lap 5. */
const STOP = 112;
/** Frames the player stands still: 2.3 s, more than the 2 s that make a mini-sector a time loss. */
const STALL = Math.ceil(2_300 / STEP);
const RACE_FRAMES = STOP + STALL + 100;

/** The player's distance driven at race frame k: 40 m a frame, none while it stands. */
const distanceAt = (k: number): number => 10 + 40 * (k < STOP ? k : k < STOP + STALL ? STOP : k - STALL);

const frames = (): Frame[] =>
  script(
    gridStart(RACE_FRAMES, (k) => ({
      ...(k === STOP && { events: [scar(1, 0)] }),
      cars: (d) => {
        const m = distanceAt(k);
        lap(d, 0, { currentLapNum: 1 + Math.floor(m / TRACK_M), lapDistance: m % TRACK_M, ...(m >= TRACK_M && { lastLapTimeInMs: 25 * STEP }) });
      },
    })),
    { session: { trackLength: TRACK_M, sector2LapDistanceStart: 333, sector3LapDistanceStart: 666 } },
  );

/** Every scheduled output of `incidents`, each with a fresh `init` over the same view. */
function incidentsRuns(all: Frame[]): Array<{ frame: number; scheduled: IncidentsOutput; fresh: IncidentsOutput }> {
  const runner = new SessionRunner(initFor(all));
  const scheduler = new Scheduler(CalculatorRegistry.build([incidentsCalculator]));
  scheduler.setNeeded([INCIDENTS]);
  return all.flatMap((f, frame) => {
    const r = runner.apply(f);
    if (r.delta.truncated) scheduler.reset();
    const input = { state: r.state, activeFlagPhase: activeFlagPhaseOf(r.state), situation: situationOf(r.state), changed: r.changed, delta: r.delta, feed: IDLE_FEED, config: {} };
    const { ran, outputs } = scheduler.run(input);
    if (!ran.includes(INCIDENTS)) return [];
    const fresh = incidentsCalculator.output(incidentsCalculator.init({ ...input, outputs: new Map() }));
    return [{ frame, scheduled: outputs.get(INCIDENTS) as IncidentsOutput, fresh }];
  });
}

describe('incidents across a neutralisation dropped unconfirmed', () => {
  it('equals a fresh run on every scheduled step, and reports the time loss made while the deployment waited', () => {
    const runs = incidentsRuns(frames());
    expect(runs.map((r) => ({ frame: r.frame, feed: r.scheduled }))).toEqual(runs.map((r) => ({ frame: r.frame, feed: r.fresh })));
    expect(runs.at(-1)!.scheduled.filter((e) => e.kind === 'timeLoss').map((e) => e.carIds)).toEqual([[0]]);
  });
});
