// `race-hazard` (SP4.3b spec §5.2, plan 4.3b1 Task 16; C3, C14, C41, C44, C47, C62b): per remaining lap the chance an
// SC and a VSC starts on it, from the track file's hazard by race fraction (ruling R22), scaled by the lobby's SC setting;
// the duration pmfs; and the neutralisation out now with the pmf of its laps left. Rows 1 to 6 and 9 of the brief, and
// R1 (rewind). Every output is computed both ways, the scheduled run and the as-of form, through the guarded view
// (`hazardOf`, C41).
//
// The views are built by hand: the leader (car 0) completes lap i on frame 100 i, a second car (car 1, position 2) on
// frame 100 i + 10, so a span opened or closed on frame 100 i + 50 lies inside the leader's lap i + 1. A neutralisation
// has run k laps when the leader crossed the line k times since the frame it opened on.
import { carId, known, unknown, type LapRecord, type OpenSpan, type Span, type WeekendPhase } from '@pitwall/domain';
import { asOfNow, CalculatorRegistry, type ChangeTag, type EngineView, type HistoryDelta } from '@pitwall/engine/readers';
import { Scheduler } from '@pitwall/engine';
import { describe, expect, it } from 'vitest';
import { engineView, lap, neutralisation, openNeutralisation, phaseSpans, RACE_PHASES, RACING } from '../../../../test-support/builders/index.ts';
import { generateRace, GENERATOR_DEFAULTS, type GeneratorCar } from '../../../../test-support/race-generator/index.ts';
import { guarded } from '../../../engine/test/support/scheduler.ts';
import { RACE_HAZARD, RACE_HAZARD_CONFIG, raceHazardAsOf, type RaceHazardOutput } from '../../src/race-hazard/index.ts';
import {
  chanceOn,
  conditioned,
  expectPmf,
  HAZARD,
  hazardOf,
  inputOfView,
  raceHazardCalculator,
  READS,
  TRACK,
  trackWith,
  withLobby,
} from './support.ts';

type Level = 'off' | 'reduced' | 'standard' | 'increased';

/** The leader's (car 0) laps 1..n, each on frame 100 i, and a second car's (position 2) on frame 100 i + 10, in frame order. */
const leaderLaps = (n: number): LapRecord[] =>
  Array.from({ length: n }, (_, k) => k + 1).flatMap((i) => [
    lap({ carId: carId(0), lapNumber: i, positionAtEnd: 1, frame: 100 * i, completedAt: 90_000 * i }),
    lap({ carId: carId(1), lapNumber: i, positionAtEnd: 2, frame: 100 * i + 10, completedAt: 90_000 * i + 900 }),
  ]);

/** A session-phase span of `kind` open since `startFrame`. */
const openPhase = (kind: string, startFrame = 0, detail: unknown = undefined): OpenSpan => ({
  machine: RACE_PHASES,
  id: 0,
  kind,
  start: startFrame * 900,
  confirmed: true,
  detail,
  startFrame,
});

type ViewOver = {
  /** Laps the leader has completed. */
  done?: number;
  total?: number;
  level?: Level;
  /** The open session-phase span; default `racing` since frame 0. */
  open?: OpenSpan;
  closed?: Span[];
  weekendPhase?: WeekendPhase;
  track?: EngineView['track'];
  config?: EngineView['config'];
};

/** A race view: the leader has completed `done` laps of `total`, the lobby's SC setting is `level`. */
function view({ done = 0, total = 44, level = 'standard', open = openPhase('racing'), closed = [], weekendPhase, track = TRACK, config = {} }: ViewOver = {}): EngineView {
  const situation = weekendPhase === undefined ? RACING : { ...RACING, weekendPhase };
  const { spans, situation: withOpen } = phaseSpans(closed, open, situation);
  return engineView({
    history: { laps: leaderLaps(done), spans },
    situation: withOpen,
    session: { totalLaps: total, settings: { safetyCar: level } },
    track,
    config,
    sessionTime: 90_000 * done + 1_000,
  });
}

/** The known value of an output. */
const valueOf = (out: RaceHazardOutput) => {
  if (!out.known) throw new Error(`race-hazard: unknown (${out.reason})`);
  return out.value;
};

/** The output's entry for lap `lap`. */
const entry = (out: RaceHazardOutput, lap: number) => valueOf(out).byLap.find((e) => e.lap === lap);

/** Every remaining lap from `from` to `total` is the table's chance times `factor`. */
function expectTable(out: RaceHazardOutput, from: number, total: number, factor = 1, label = ''): void {
  for (let lap = from; lap <= total; lap++) {
    const e = entry(out, lap);
    expect(e, `${label} lap ${lap}`).toBeDefined();
    expect(e!.sc, `${label} sc on lap ${lap}`).toBeCloseTo(chanceOn(HAZARD, lap, total, 'sc', factor), 12);
    expect(e!.vsc, `${label} vsc on lap ${lap}`).toBeCloseTo(chanceOn(HAZARD, lap, total, 'vsc', factor), 12);
  }
}

/** The SC neutralisation detail with these stages. */
const scDetail = (...stages: Array<'deployed' | 'returning'>) => ({ car: 'SC' as const, stages: stages.map((stage, i) => ({ stage, at: 495_000 + i * 1_000 })) });

describe('race-hazard', () => {
  it('byLap: lap 1 from lapOne, later laps from byFraction by race fraction, times the lobby factor', () => {
    // before the start: every lap of the 44, lap 1 from lapOne, lap n from the bin of (n − 0.5) / 44 (ruling R22)
    const start = hazardOf(view());
    expect(valueOf(start).byLap.map((e) => e.lap)).toEqual(Array.from({ length: 44 }, (_, i) => i + 1));
    expect(valueOf(start).lobbyFactor).toBe(1);
    expect(entry(start, 1)).toEqual({ lap: 1, sc: HAZARD.lapOne.sc, vsc: HAZARD.lapOne.vsc });
    expectTable(start, 1, 44, 1, 'at the start');
    // the bin edge: lap 11 is at 10.5 / 44 = 0.239 (the first bin), lap 12 at 11.5 / 44 = 0.261 (the second)
    expect(entry(start, 11)).toEqual({ lap: 11, sc: HAZARD.byFraction[0]!.sc, vsc: HAZARD.byFraction[0]!.vsc });
    expect(entry(start, 12)).toEqual({ lap: 12, sc: HAZARD.byFraction[1]!.sc, vsc: HAZARD.byFraction[1]!.vsc });
    // the durations are the table's
    expect(valueOf(start).durationLaps).toEqual(HAZARD.durationLaps);
    expect(valueOf(start).active).toBeNull();

    // the leader has completed 10 laps: the remaining laps are 11 to 44, by the leader's laps (not car 1's)
    const later = hazardOf(view({ done: 10 }));
    expect(valueOf(later).byLap.map((e) => e.lap)).toEqual(Array.from({ length: 34 }, (_, i) => i + 11));
    expectTable(later, 11, 44, 1, 'after lap 10');

    // on the grid, in the formation and under the start lights: the chances from lap 1 (spec §5.2's behaviour table)
    for (const kind of ['grid', 'formation', 'startLights']) {
      const before = hazardOf(view({ open: openPhase(kind) }));
      expect(valueOf(before).byLap.map((e) => e.lap), kind).toEqual(Array.from({ length: 44 }, (_, i) => i + 1));
      expectTable(before, 1, 44, 1, kind);
    }
  });

  it('an open neutralised span gives active with the duration pmf conditioned on its laps run; returning ends it this lap', () => {
    // an SC opened in the leader's lap 6 (frame 550)
    const sc = (stages: Array<'deployed' | 'returning'> = ['deployed']) => ({ ...openNeutralisation({ kind: 'SC', start: 495_000, startFrame: 550 }), detail: scDetail(...stages) });
    // no crossing since it opened: it has run 0 laps, the pmf itself
    const fresh = valueOf(hazardOf(view({ done: 5, open: sc() }))).active;
    expect(fresh?.condition).toBe('sc');
    expectPmf(fresh?.remainingLaps, conditioned(HAZARD.durationLaps.sc, 0), 'run 0');
    // two crossings since (laps 6 and 7 completed on frames 600 and 700): run 2, the pmf from index 2 renormalised
    const run2 = valueOf(hazardOf(view({ done: 7, open: sc() }))).active;
    expect(run2?.condition).toBe('sc');
    expectPmf(run2?.remainingLaps, [0.4 / 0.7, 0.3 / 0.7], 'run 2');
    // a VSC that has run one lap
    const vsc = openNeutralisation({ kind: 'VSC', start: 495_000, startFrame: 550 });
    const vscRun1 = valueOf(hazardOf(view({ done: 6, open: vsc }))).active;
    expect(vscRun1?.condition).toBe('vsc');
    expectPmf(vscRun1?.remainingLaps, [0.4 / 0.5, 0.1 / 0.5], 'vsc run 1');
    // returning: it ends this lap
    const returning = valueOf(hazardOf(view({ done: 7, open: sc(['deployed', 'returning']) }))).active;
    expect(returning?.condition).toBe('sc');
    expectPmf(returning?.remainingLaps, [1], 'returning');
    // the durations stay the table's
    expect(valueOf(hazardOf(view({ done: 7, open: sc() }))).durationLaps).toEqual(HAZARD.durationLaps);
  });

  it('no start on the laps while one is out and the lap after', () => {
    // an SC out since frame 550 (leader's lap 6), the leader on lap 7 (run 1, at most 3 laps left: it ends by lap 9)
    const out = hazardOf(view({ done: 6, open: openNeutralisation({ kind: 'SC', start: 495_000, startFrame: 550 }) }));
    expect(valueOf(out).byLap[0]?.lap).toBe(7);
    // this lap it is out, and the next lap it is either still out or it is the lap after it ended
    expect(entry(out, 7)).toEqual({ lap: 7, sc: 0, vsc: 0 });
    expect(entry(out, 8)).toEqual({ lap: 8, sc: 0, vsc: 0 });
    // past its longest duration and the lap after it, the table's chances
    expectTable(out, 11, 44, 1, 'past the SC');

    // an SC that closed in the leader's current lap 7 (frame 650): laps 7 and 8 no start, the table from lap 9
    const SC_THIS_LAP = neutralisation({ kind: 'SC', start: 315_000, end: 585_000, startFrame: 350, endFrame: 650 });
    const endedNow = hazardOf(view({ done: 6, closed: [SC_THIS_LAP], open: openPhase('racing', 650) }));
    expect(valueOf(endedNow).active).toBeNull();
    expect(entry(endedNow, 7)).toEqual({ lap: 7, sc: 0, vsc: 0 });
    expect(entry(endedNow, 8)).toEqual({ lap: 8, sc: 0, vsc: 0 });
    expectTable(endedNow, 9, 44, 1, 'ended in lap 7');

    // an SC that closed in the leader's lap 6 (frame 550), the leader now on lap 7: lap 7 is the lap after, lap 8 the table's
    const SC_LAST_LAP = neutralisation({ kind: 'SC', start: 225_000, end: 495_000, startFrame: 250, endFrame: 550 });
    const endedBefore = hazardOf(view({ done: 6, closed: [SC_LAST_LAP], open: openPhase('racing', 550) }));
    expect(entry(endedBefore, 7)).toEqual({ lap: 7, sc: 0, vsc: 0 });
    expectTable(endedBefore, 8, 44, 1, 'ended in lap 6');
  });

  it('Reduced ×0.5, Increased ×1.5, Off → every chance 0', () => {
    expect(RACE_HAZARD_CONFIG.defaults).toEqual({ reducedFactor: 0.5, increasedFactor: 1.5 });
    const reduced = hazardOf(view({ level: 'reduced' }));
    expect(valueOf(reduced).lobbyFactor).toBe(0.5);
    expectTable(reduced, 1, 44, 0.5, 'reduced');
    const increased = hazardOf(view({ level: 'increased' }));
    expect(valueOf(increased).lobbyFactor).toBe(1.5);
    expectTable(increased, 1, 44, 1.5, 'increased');
    const off = hazardOf(view({ level: 'off' }));
    expect(valueOf(off).lobbyFactor).toBe(0);
    expect(valueOf(off).byLap).toHaveLength(44);
    expect(valueOf(off).byLap.every((e) => e.sc === 0 && e.vsc === 0)).toBe(true);
    // the durations do not scale
    for (const out of [reduced, increased, off]) expect(valueOf(out).durationLaps).toEqual(HAZARD.durationLaps);
    // the factors are config (C47): an override is read through view.config
    const overridden = hazardOf(view({ level: 'reduced', config: { [RACE_HAZARD_CONFIG.key]: { reducedFactor: 0.25 } } }));
    expect(valueOf(overridden).lobbyFactor).toBe(0.25);
    expectTable(overridden, 1, 44, 0.25, 'reduced 0.25');
  });

  it('no track file or no hazard → notApplicable; totalLaps unknown → insufficientData', () => {
    expect(hazardOf(view({ track: unknown('notApplicable') }))).toEqual(unknown('notApplicable'));
    expect(hazardOf(view({ track: trackWith(unknown('notApplicable')) }))).toEqual(unknown('notApplicable'));
    // totalLaps not yet received (0 in the live state, C3: never a 0-lap race)
    expect(hazardOf(view({ total: 0 }))).toEqual(unknown('insufficientData'));
    // the as-of form with the session's totalLaps unknown (a stored session without it)
    const now = asOfNow(view());
    expect(raceHazardAsOf({ ...now, fixed: { ...now.fixed, totalLaps: unknown('notReceived') } })).toEqual(unknown('insufficientData'));
  });

  it('outside the race phase → notApplicable (C14)', () => {
    const phases: WeekendPhase[] = [
      { kind: 'pending' },
      { kind: 'none' },
      { kind: 'practice', format: 'practice', segment: 1 },
      { kind: 'qualifying', format: 'grandPrix', segment: 1 },
    ];
    for (const weekendPhase of phases) expect(hazardOf(view({ weekendPhase })), weekendPhase.kind).toEqual(unknown('notApplicable'));
    // the race over or stopped (spec §5.2's behaviour table): suspended, finished, post-session
    for (const kind of ['suspended', 'finished', 'postSession']) {
      expect(hazardOf(view({ done: 20, open: openPhase(kind, 2_050) })), kind).toEqual(unknown('notApplicable'));
    }
  });

  it('runs only on its changes: a frame without a new leader lap, span change or settings change does not run it', () => {
    const calc = raceHazardCalculator();
    expect([...calc.reads].sort()).toEqual([...READS].sort());
    const scheduler = new Scheduler(CalculatorRegistry.build([guarded(calc)]), { freezeOutputs: true });
    scheduler.setNeeded([RACE_HAZARD]);

    // the frames: each the view of a race moment, with the change tags and the delta of that frame
    type Step = { label: string; view: EngineView; changed: ChangeTag[]; laps: [before: number, after: number]; runs: boolean };
    const at = (v: EngineView, t: number): EngineView => ({ ...v, live: { ...v.live, sessionTime: t } });
    /**
     * The race at one of its moments: `first` the leader has completed 5 laps and car 1 4 (9 laps); `car1` car 1's lap 5
     * appended (10, position 2); `leader` the leader's lap 6 appended after it (11, position 1).
     */
    const racing = (moment: 'first' | 'car1' | 'leader', o: { level?: Level; open?: OpenSpan } = {}): EngineView => {
      const base = view({ done: 5, ...(o.level !== undefined && { level: o.level }), ...(o.open !== undefined && { open: o.open }) });
      const laps = base.history.laps.slice(0, 9);
      if (moment !== 'first') laps.push(base.history.laps[9]!);
      if (moment === 'leader') laps.push(lap({ carId: carId(0), lapNumber: 6, positionAtEnd: 1, frame: 600, completedAt: 540_000 }));
      return { ...base, history: { ...base.history, laps } };
    };
    const sc = openNeutralisation({ kind: 'SC', start: 560_000, startFrame: 640 });
    const steps: Step[] = [
      { label: 'the first frame', view: racing('first'), changed: ['session', 'laps', 'spans:session-phase-race'], laps: [0, 9], runs: true },
      { label: 'a timing-only frame', view: racing('first'), changed: ['timing'], laps: [9, 9], runs: false },
      { label: "car 1's lap, not the leader's", view: racing('car1'), changed: ['timing', 'laps'], laps: [9, 10], runs: false },
      { label: 'a session packet without a settings change', view: racing('car1'), changed: ['session'], laps: [10, 10], runs: false },
      { label: "the leader's lap", view: racing('leader'), changed: ['laps'], laps: [10, 11], runs: true },
      { label: 'an SC span opened', view: racing('leader', { open: sc }), changed: ['spans:session-phase-race'], laps: [11, 11], runs: true },
      { label: 'the lobby setting changed', view: racing('leader', { open: sc, level: 'reduced' }), changed: ['session'], laps: [11, 11], runs: true },
      { label: 'a timing-only frame under the SC', view: racing('leader', { open: sc, level: 'reduced' }), changed: ['timing'], laps: [11, 11], runs: false },
    ];
    steps.forEach((step, i) => {
      const delta: HistoryDelta = { before: { ...step.view.delta.after, laps: step.laps[0] }, after: { ...step.view.delta.after, laps: step.laps[1] } };
      const v = at({ ...step.view, delta, changed: new Set(step.changed) }, 1_000_000 + 100 * i);
      const result = scheduler.run(inputOfView(v));
      expect(result.errors, step.label).toEqual([]);
      expect(result.ran.includes(RACE_HAZARD), step.label).toBe(step.runs);
    });
  });

  it('R1: rewind: output equals a run without the undone frames (C33)', () => {
    // a lone car under a hazard high enough that the undone frames hold neutralisations; back from lap 9 to lap 6
    const car: GeneratorCar = { paceMs: 90_000, human: false, sigmaMs: 0, rho: 0, mistakeRate: 0, mistakeMedianMs: 1_000, mistakeSigmaLog: 0.5, wearFactor: 1, stops: [] };
    const hazard = { ...HAZARD, lapOne: { sc: 0.5, vsc: 0 }, byFraction: [{ upTo: 1, sc: 0.3, vsc: 0.3 }] };
    const track = trackWith(known({ value: hazard, source: 'test' }, 0));
    const { race } = generateRace({ ...GENERATOR_DEFAULTS, cars: 1, field: [car], laps: 12, hazard }, 7);
    const viewAt = (frame: number, from?: number) => withLobby(race.viewAt(frame, from === undefined ? {} : { from }), 'standard', track);
    const target = race.framesOfLap(6)[2]!;
    const undone = race.framesOfLap(9)[1]!;
    const make = () => {
      const s = new Scheduler(CalculatorRegistry.build([guarded(raceHazardCalculator())]), { freezeOutputs: true });
      s.setNeeded([RACE_HAZARD]);
      return s;
    };
    // the run that rewinds: frames 1 to `undone`, then back to `target`
    const rewinding = make();
    for (let f = 1; f <= undone; f++) rewinding.run(inputOfView(viewAt(f)));
    const back = rewinding.run(inputOfView(viewAt(target, undone)));
    expect(back.errors).toEqual([]);
    expect(back.ran).toContain(RACE_HAZARD);
    // the run that never received the undone frames
    const straight = make();
    let last;
    for (let f = 1; f <= target; f++) last = straight.run(inputOfView(viewAt(f)));
    expect(back.outputs.get(RACE_HAZARD)).toEqual(last!.outputs.get(RACE_HAZARD));
    expect((back.outputs.get(RACE_HAZARD) as RaceHazardOutput).known).toBe(true);
  });
});
