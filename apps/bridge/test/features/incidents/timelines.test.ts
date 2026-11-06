// `incidents` stays incremental = from scratch where the session time is no timeline (spec 3.3): across a
// neutralisation the status never confirms (dropped 3 s after its SCAR; the dropping step discards a timeline,
// `delta.rewound`, review 2 B2), and across an unexplained mid-race fall of the clock (the engine keeps its race clock
// monotonic by an offset, user ruling 2026-10-30). Builder frames, the engine and the calculator under a scheduler that
// restarts on a truncated step, as the bridge's does. The player laps a 1000 m track in 25 frames and stands still for
// 2.3 s in lap 5: a time loss.
import { describe, expect, it } from 'vitest';
import { unknown, type IncidentEntry } from '@pitwall/domain';
import { INCIDENTS, incidentsCalculator, type IncidentsOutput } from '@pitwall/analysis';
import { CalculatorRegistry, Scheduler, SessionRunner, situationOf, type Frame } from '@pitwall/engine';
import { IDLE_FEED, NO_PRIORS } from '../../../../../test-support/builders/index.ts';
import { initFor } from '../../../../../packages/engine/test/support/run.ts';
import { gridStart, lap, scar, script, status, STEP, type Beat } from '../../../../../packages/engine/test/situations/script.ts';

const TRACK_M = 1000;
/** Race frame of the stop, mid-way through a mini-sector of lap 5. */
const STOP = 112;
/** Frames the player stands still: 2.3 s, more than the 2 s that make a mini-sector a time loss. */
const STALL = Math.ceil(2_300 / STEP);

/** The player's distance driven at race frame k: 40 m a frame, none while it stands. */
const distanceAt = (k: number): number => 10 + 40 * (k < STOP ? k : k < STOP + STALL ? STOP : k - STALL);

/** `n` race frames of the player's laps; `beat` adds to race frame k. */
const frames = (n: number, beat: (k: number) => Beat = () => ({})): Frame[] =>
  script(
    gridStart(n, (k) => ({
      ...beat(k),
      cars: (d) => {
        const m = distanceAt(k);
        lap(d, 0, { currentLapNum: 1 + Math.floor(m / TRACK_M), lapDistance: m % TRACK_M, ...(m >= TRACK_M && { lastLapTimeInMs: 25 * STEP }) });
      },
    })),
    { session: { trackLength: TRACK_M, sector2LapDistanceStart: 333, sector3LapDistanceStart: 666 } },
  );

/** Every scheduled output of `incidents`, each with a fresh `init` over the same view. */
function incidentsRuns(all: Frame[]): Array<{ frame: number; scheduled: IncidentEntry[]; fresh: IncidentEntry[] }> {
  const runner = new SessionRunner(initFor(all));
  const scheduler = new Scheduler(CalculatorRegistry.build([incidentsCalculator]), { freezeOutputs: true });
  scheduler.setNeeded([INCIDENTS]);
  const runs: Array<{ frame: number; scheduled: IncidentEntry[]; fresh: IncidentEntry[] }> = [];
  all.forEach((f, frame) => runner.apply(f, (r) => {
    if (r.delta.rewound !== undefined) scheduler.reset();
    const input = { live: r.state, situation: situationOf(r.state), history: r.state.history, changed: r.changed, delta: r.delta, weekend: r.state.weekend, feed: IDLE_FEED, config: {}, priors: NO_PRIORS, track: unknown('notApplicable') };
    const { ran, outputs } = scheduler.run(input);
    if (!ran.includes(INCIDENTS)) return;
    const view = { ...input, priors: unknown('notApplicable'), outputs: new Map() };
    const fresh = incidentsCalculator.output(incidentsCalculator.init(view), view);
    runs.push({ frame, scheduled: (outputs.get(INCIDENTS) as IncidentsOutput).feed, fresh: fresh.feed });
  }));
  return runs;
}

/** Scheduled and fresh feeds are equal on every run, and the last feed has the player's time loss. */
const expectFreshAndTheLoss = (all: Frame[]) => {
  const runs = incidentsRuns(all);
  expect(runs.map((r) => ({ frame: r.frame, feed: r.scheduled }))).toEqual(runs.map((r) => ({ frame: r.frame, feed: r.fresh })));
  expect(runs.at(-1)!.scheduled.filter((e) => e.kind === 'timeLoss').map((e) => e.carIds)).toEqual([[0]]);
};

describe('incidents across a neutralisation dropped unconfirmed', () => {
  it('equals a fresh run on every scheduled step, and reports the time loss made while the deployment waited', () => {
    // the SC is deployed on the frame the player stops; the status never shows it
    expectFreshAndTheLoss(frames(STOP + STALL + 100, (k) => (k === STOP ? { events: [scar(1, 0)] } : {})));
  });
});

describe('incidents across a mid-race fall of the session time', () => {
  it('equals a fresh run on every scheduled step, and keeps the time loss made before the fall when an SC opens after it', () => {
    // 30 frames after the loss the clock falls to 0.5 s; 20 frames later an SC is deployed and confirmed, at a raw
    // session time below the loss's
    const fall = STOP + STALL + 30;
    expectFreshAndTheLoss(frames(fall + 60, (k) => ({
      ...(k >= fall && { at: 500 + (k - fall) * STEP }),
      ...(k === fall + 20 && { events: [scar(1, 0)], session: status(1) }),
    })));
  });
});
