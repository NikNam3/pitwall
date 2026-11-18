// `weekend-pace` follows the basis as it changes in a session (SP4.3e Task 7a-2, plan Step 1 row (f); contract C31,
// C39, C41, C62): `view.basis` is the context of the projection's newest `basisChosen` decision, else the session-start
// basis, so it changes within a session. weekend-pace declares `decisions` in its `reads` (C62), the scheduler runs it
// on the frame the decision appears, and its output there equals the output computed from scratch on that frame's view:
// it holds nothing derived from the earlier basis across frames (C31: quick, no accumulator holds the basis). A rewind
// that voids the decision gives the session-start basis's output back.
import { carId, type DecisionRecord, type FrameNumber, type WeekendPace } from '@pitwall/domain';
import { Scheduler } from '@pitwall/engine';
import { CalculatorRegistry, projectionLengths, type BasisContext, type ChangeTag, type EngineView, type SchedulerInput } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { NO_DRIVERS, NO_PRIORS } from '../../../../test-support/builders/index.ts';
import { guarded } from '../../../engine/test/support/scheduler.ts';
import { degradationCalculator, WEEKEND_PACE, weekendPaceCalculator } from '../../src/index.ts';
import { calc, KEY, qualiLap, qualifying, seats, valueOf, viewOf } from './support.ts';

const CARS = 4;
const SEATS = seats(CARS);

/** A qualifying of the four cars: car k's best lap `baseMs + k * stepMs`, with a slower lap before it. */
const qualifyingOf = (uid: string, baseMs: number, stepMs: number) =>
  qualifying(
    uid,
    Array.from({ length: CARS }, (_, k) => [qualiLap(k, 1, baseMs + k * stepMs + 900), qualiLap(k, 2, baseMs + k * stepMs)]).flat(),
    SEATS,
  );

/** The session-start basis: qualifying `qa`. */
const START: BasisContext = { basis: { practice: [], qualifying: { sessionUid: 'qa', weekendId: 'w1' } }, player: KEY(0), sessions: [qualifyingOf('qa', 90_000, 100)] };
/** The basis a `basisChosen` decision names: qualifying `qb`, other laps. */
const CHOSEN: BasisContext = { basis: { practice: [], qualifying: { sessionUid: 'qb', weekendId: 'w1' } }, player: KEY(0), sessions: [qualifyingOf('qb', 95_000, 250)] };
const DECISION: DecisionRecord = { kind: 'basisChosen', basis: CHOSEN.basis, frame: 3 as FrameNumber };

/** The view of one frame: its basis and its projected decisions. */
const frameView = (basis: BasisContext, decisions: DecisionRecord[]): EngineView => viewOf({ seats: SEATS, basis, lists: { decisions } });

/** The scheduler input of `view` on its frame: its change tags, its delta from `previous`, no priors, no profiles. */
function inputOf(view: EngineView, o: { at: number; changed: ChangeTag[]; previous?: EngineView; rewound?: boolean }): SchedulerInput {
  const { outputs: _outputs, priors: _priors, drivers: _drivers, ...rest } = view;
  const after = projectionLengths(view.history);
  const before = o.previous === undefined ? { ...after, decisions: 0, laps: 0 } : projectionLengths(o.previous.history);
  return {
    ...rest,
    live: { ...rest.live, sessionTime: o.at as EngineView['live']['sessionTime'] },
    changed: new Set(o.changed),
    delta: { before, after, ...(o.rewound === true && { rewound: { frameId: 2, at: 2_000 as never } }) },
    priors: NO_PRIORS,
    drivers: NO_DRIVERS,
  } as SchedulerInput;
}

describe('weekend-pace follows a basisChosen (SP4.3e Task 7a-2)', () => {
  it('(f) weekend-pace\'s output follows a basisChosen at that frame and holds nothing across frames (C31)', () => {
    // C62: a unit that reads view.basis declares `decisions`, and runs on its change
    expect(weekendPaceCalculator.reads).toContain('decisions');
    const scheduler = new Scheduler(CalculatorRegistry.build([guarded(degradationCalculator), guarded(weekendPaceCalculator)]), { freezeOutputs: true });
    scheduler.setNeeded([WEEKEND_PACE]);
    /** From scratch on `view` at race-clock time `at`. */
    const fresh = (view: EngineView, at: number): WeekendPace => calc.compute({ ...view, live: { ...view.live, sessionTime: at as EngineView['live']['sessionTime'] } });
    const paces = (out: WeekendPace): number[] => Array.from({ length: CARS }, (_, k) => valueOf(out, k).paceMs);

    // frame 1: the session-start basis
    const start = frameView(START, []);
    const first = scheduler.run(inputOf(start, { at: 1_000, changed: ['laps', 'identity', 'decisions', 'spans:weekend-phase'] }));
    expect(first.errors).toEqual([]);
    expect(first.ran).toContain(WEEKEND_PACE);
    const startOutput = first.outputs.get(WEEKEND_PACE) as WeekendPace;
    expect(startOutput).toEqual(fresh(start, 1_000));
    // precondition: the two bases give different paces
    expect(paces(fresh(start, 0))).not.toEqual(paces(fresh(frameView(CHOSEN, [DECISION]), 0)));

    // frame 2: a timing-only frame on the same basis
    const timing = scheduler.run(inputOf(start, { at: 2_000, changed: ['timing'], previous: start }));
    expect(timing.errors).toEqual([]);
    expect(timing.outputs.get(WEEKEND_PACE)).toEqual(startOutput);

    // frame 3: the decision appears, the view's basis is the chosen one: the output follows on that frame
    const chosen = frameView(CHOSEN, [DECISION]);
    const atDecision = scheduler.run(inputOf(chosen, { at: 3_000, changed: ['decisions'], previous: start }));
    expect(atDecision.errors).toEqual([]);
    expect(atDecision.ran).toContain(WEEKEND_PACE);
    expect(atDecision.outputs.get(WEEKEND_PACE)).toEqual(fresh(chosen, 3_000));
    expect(paces(atDecision.outputs.get(WEEKEND_PACE) as WeekendPace)).toEqual(paces(fresh(chosen, 0)));

    // frame 4: a rewind voids the decision: the session-start basis's output, as from scratch
    const rewound = scheduler.run(inputOf(start, { at: 2_500, changed: ['decisions'], previous: chosen, rewound: true }));
    expect(rewound.errors).toEqual([]);
    expect(rewound.outputs.get(WEEKEND_PACE)).toEqual(fresh(start, 2_500));
    expect(paces(rewound.outputs.get(WEEKEND_PACE) as WeekendPace)).toEqual(paces(startOutput));
    // the car of the player's seat is the one of slot 0 throughout
    expect(Object.keys(rewound.outputs.get(WEEKEND_PACE) as WeekendPace)).toContain(String(carId(0)));
  });
});
