// `pit-loss` as of frame N (SP4.3a spec 6.1, plan Task 15b; rows R2 and R3 of Tasks 9–12; C26, C33, C41): the form
// `pitLossAsOf(view: AsOfView)` over the projection cut at N and the situation at N gives the output the scheduled run
// gives on the view after frame N, and after a flashback the output equals a run that never received the undone frames.
//
// The generator's projection keeps no append frames (`appendedAt`); `withAppendFrames` adds them by the generator's own
// rule (`test-support/race-generator/record.ts`): every fact is appended on the frame it describes, a confirmed lap on the
// frame after its provisional's crossing, a closed span on the frame it closed on. The R2 row checks that rule first: the
// cut at N holds the laps, pit stops and weekend phase of the view after N.
import { carId, known, type FrameNumber, type LapRecord, type Ms, type PitStopRecord, type PriorsSnapshot } from '@pitwall/domain';
import {
  asOfNow,
  projectionAsOf,
  projectionLengths,
  type AsOfView,
  type EngineView,
  type MembershipSource,
  type Projection,
} from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { guardedView } from '../../../engine/test/support/scheduler.ts';
import { engineView, history, lap } from '../../../../test-support/builders/index.ts';
import { generateRace, GENERATOR_DEFAULTS } from '../../../../test-support/race-generator/index.ts';
import { zandvoortTrack } from '../../../../test-support/track.ts';
import { engineShaped } from '../engine-shaped.ts';
import { pitLossCalculator } from '../../src/pit-loss/calculator.ts';
import { PIT_LOSS, pitLossAsOf, type PitLossOutput } from '../../src/pit-loss/index.ts';

/** The track file: its pit-loss defaults are the prior of a condition the priors snapshot has no entry for. */
const TRACK: EngineView['track'] = known(zandvoortTrack(), 0);

/** A calibration with a green pit loss only: green blends with it, VSC and SC with the track file's defaults. */
const PRIORS: EngineView['priors'] = known(
  {
    fingerprint: 'fp-zandvoort-green',
    setId: 'zandvoort-green',
    setName: 'Zandvoort green',
    sources: 2,
    entries: { 'pitLoss.ms.green': known(21_000, 0) },
  } satisfies PriorsSnapshot,
  0,
);

/** The scheduled run on `view`: `compute` through the guarded view (C41). */
const compute = (view: EngineView): PitLossOutput =>
  pitLossCalculator.compute(guardedView(view, pitLossCalculator.reads, { unit: PIT_LOSS })) as PitLossOutput;

/** The fact lists of the projection (the log's, `FACT_LISTS`). */
const FACT_LISTS = ['laps', 'stints', 'pitStops', 'crossings', 'events', 'penalties', 'decisions', 'clock'] as const;

/** `p` with the append frame of every entry, by the generator's rule (above). */
function withAppendFrames(p: Projection): Projection {
  const appendedAt: Record<string, FrameNumber[]> = {};
  for (const list of FACT_LISTS) {
    appendedAt[list] = (p[list] as readonly { frame: FrameNumber; status?: LapRecord['status'] }[]).map((fact) =>
      list === 'laps' && fact.status !== 'provisional' ? fact.frame + 1 : fact.frame,
    );
  }
  for (const [machine, spans] of Object.entries(p.spans)) appendedAt[`spans:${machine}`] = spans.map((s) => s.endFrame);
  return { ...p, appendedAt } as Projection;
}

/** A 30-lap generated race whose safety car (leader's laps 19 to 21) falls among the stops (laps 18 to 22): green and SC stops. */
const generated = (() => {
  const { race } = generateRace({ ...GENERATOR_DEFAULTS, laps: 30, sc: { fromLap: 19, toLap: 21 } }, 15);
  /** The view after frame N with the run's fixed inputs. */
  const viewAt = (frame: FrameNumber, from?: FrameNumber): EngineView => ({
    ...race.viewAt(frame, from === undefined ? {} : { from }),
    track: TRACK,
    priors: PRIORS,
  });
  const final = viewAt(race.lastFrame);
  const source: MembershipSource = { history: withAppendFrames(final.history as Projection), situation: final.situation };
  /** The as-of view at N: the run's projection cut at N, the situation at N, the run's fixed inputs; no upstream unit. */
  const asOfAt = (frame: FrameNumber): AsOfView => {
    const now = viewAt(frame);
    return {
      ...projectionAsOf(source, frame),
      frame,
      fixed: asOfNow(now).fixed,
      at: now.live.sessionTime,
      config: now.config,
      priors: now.priors,
      drivers: now.drivers,
      track: now.track,
      weekend: now.weekend,
      outputs: new Map(),
    };
  };
  /** The frames the leader crosses the line on (the first of each of its laps from lap 2), and the race's last frame. */
  const crossings: FrameNumber[] = [];
  for (let n = 2; n <= race.laps; n++) {
    const first = race.framesOfLap(n)[0];
    if (first !== undefined) crossings.push(first);
  }
  crossings.push(race.lastFrame);
  return { race, viewAt, asOfAt, crossings };
})();

describe('pit-loss as of frame N (Task 15b)', () => {
  it('as of frame N equals the scheduled run at every leader crossing frame', () => {
    const { race, viewAt, asOfAt, crossings } = generated;
    expect(crossings.length).toBe(race.laps);
    // the race has counted stops under green and under the SC, with their priors from the calibration and the track file
    const last = compute(viewAt(race.lastFrame));
    expect(last.conditions.green.sessionStops).toBeGreaterThan(0);
    expect(last.conditions.sc.sessionStops).toBeGreaterThan(0);

    for (const frame of crossings) {
      const cut = asOfAt(frame);
      const now = viewAt(frame);
      // the append-frame rule: the cut at N is the view after N
      expect([cut.history.laps, cut.history.pitStops, cut.situation.weekendPhase], `cut at frame ${frame}`).toEqual([
        now.history.laps,
        now.history.pitStops,
        now.situation.weekendPhase,
      ]);
      expect(pitLossAsOf(cut), `frame ${frame}`).toEqual(compute(now));
    }
  });

  it('rewind: after a flashback the output equals a run without the undone frames (C33)', () => {
    // engine-shaped laps (each provisional, then confirmed): car 0 stops on lap 10, car 1 on lap 18; the flashback goes
    // back to lap 15 (frame 1500), so car 1's laps from 15 and its stop never happened
    const lapOf = (car: number, n: number, lapTimeMs: Ms, over: Partial<LapRecord> = {}): LapRecord =>
      lap({ carId: carId(car), lapNumber: n, lapTimeMs, completedAt: n * 90_000, frame: n * 100, ...over });
    const stopOf = (car: number, n: number, inMs: Ms, outMs: Ms): { laps: LapRecord[]; stop: PitStopRecord } => ({
      laps: [
        lapOf(car, n - 3, 80_000),
        lapOf(car, n - 2, 80_200),
        lapOf(car, n - 1, 80_400),
        lapOf(car, n, inMs, { inLap: true }),
        lapOf(car, n + 1, outMs, { outLap: true }),
      ],
      stop: {
        carId: carId(car),
        lap: n,
        pitLaneEntry: n * 90_000 - 5_000,
        pitLaneExit: n * 90_000 + 15_000,
        pitLaneTimeMs: 20_000,
        stationaryTimeMs: 2_500,
        flag: 'green',
        penaltyServed: false,
        frame: n * 100 + 50,
      },
    });
    const ours = stopOf(0, 10, 92_000, 93_000);
    const rival = stopOf(1, 18, 94_000, 95_000);
    const projectionOf = (stops: { laps: LapRecord[]; stop: PitStopRecord }[]): Projection =>
      history({
        laps: engineShaped(stops.flatMap((s) => s.laps).sort((a, b) => a.frame - b.frame || a.carId - b.carId)),
        pitStops: stops.map((s) => s.stop),
      });
    const before = projectionOf([ours, rival]);
    const kept = projectionOf([ours]);
    const viewOf = (h: Projection, delta?: EngineView['delta']): EngineView =>
      engineView({ history: h, track: TRACK, priors: PRIORS, sessionTime: 1_350_000, ...(delta !== undefined && { delta }) });

    const rewound = viewOf(kept, { before: projectionLengths(before), after: projectionLengths(kept), rewound: { frameId: 1500, at: 1_350_000 } });
    const fresh = compute(viewOf(kept));
    // the rewind undid a counted stop
    expect(compute(viewOf(before)).conditions.green.sessionStops).toBe(2);
    expect(fresh.conditions.green.sessionStops).toBe(1);

    expect(compute(rewound)).toEqual(fresh);
    expect(pitLossAsOf(asOfNow(rewound))).toEqual(fresh);

    // and on a generated race: back from its last frame to the leader's lap 20, among the stops
    const { race, viewAt } = generated;
    const target = race.framesOfLap(20)[0]!;
    const back = viewAt(target, race.lastFrame);
    expect(back.delta.rewound).toBeDefined();
    expect(compute(viewAt(race.lastFrame)).stops.length).toBeGreaterThan(compute(back).stops.length);
    expect(compute(back)).toEqual(compute(viewAt(target)));
    expect(pitLossAsOf(asOfNow(back))).toEqual(compute(viewAt(target)));
  });
});
