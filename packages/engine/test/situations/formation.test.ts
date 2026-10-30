// The formation lap is discarded at lights out (spec 3.2; diagnosis t1-diagnosis.md P2/P3, shape S2 of
// raceSingaporeWet). The script: the grid from 0 s; the formation status at frame 10; the formation lap (car 0 and
// car 1 drive, an overtake, car 1's retirement and disqualification transient); the clock reset to 0 at frame 110 with
// the formation's resume and the grid re-ordering overtake; the clock holds at 0 through a DRS notice, five start
// lights and lights out at frame 209; the race runs from the frame after it, both cars complete lap 1 and an overtake
// comes at race frame 40. Car 1 stands past the line with its lap timer at 510 ms from the reset on, as raceZandvoortOnline's
// cars 1-7 do.
import { describe, expect, it } from 'vitest';
import type { EventDetails } from '@pitwall/protocol';
import type { SessionRunner } from '../../src/index.ts';
import { after } from '../support/runner.ts';
import { beats, fuel, lap, LGOT, ovtk, run, scar, script, status, STEP, stlg, TRACK, type Beat } from './script.ts';

const FORMATION = 10;
const RESET = 110;
const LIGHTS = [120, 130, 140, 150, 160];
const LIGHTS_OUT = 209;
/** Race frame k is frame `LIGHTS_OUT + k`; frame 0 of the race is lights out. */
const RACE_FRAMES = 121;
const raceAt = (k: number): number => k * STEP;

const RTMT: EventDetails = { code: 'RTMT', vehicleIdx: 1, reason: 0 };
const DRSD: EventDetails = { code: 'DRSD', reason: 0 };

/**
 * Car `car` on the grid at `gridM`, driving 40 m a frame from frame `from` on, into lap 2 at the line. With `timed` its
 * lap timer runs from `from` (and from the line on lap 2); the formation lap's timer stays 0.
 */
const drive = (k: number, car: number, gridM: number, from: number, timed: boolean) => (d: Parameters<NonNullable<Beat['cars']>>[0]) => {
  const frames = Math.max(0, k - from);
  const lap1 = Math.ceil((TRACK - gridM) / 40);
  if (frames < lap1) lap(d, car, { currentLapNum: 1, lapDistance: gridM + frames * 40, currentLapTimeInMs: timed ? frames * STEP : 0 });
  else lap(d, car, { currentLapNum: 2, lapDistance: gridM + frames * 40 - TRACK, currentLapTimeInMs: (frames - lap1) * STEP, lastLapTimeInMs: lap1 * STEP });
};

/** The formation start of the file comment; `extra` adds events per frame. */
const formationStart = (extra: (k: number) => EventDetails[] = () => []): Beat[] =>
  beats(LIGHTS_OUT + RACE_FRAMES, (k) => ({
    at: k < RESET ? k * STEP : k <= LIGHTS_OUT ? 0 : raceAt(k - LIGHTS_OUT),
    ...(k === FORMATION && { session: status(3) }),
    ...(k === 125 && { session: status(0) }),
    events: [
      ...(k === 50 ? [ovtk(0, 1)] : []),
      ...(k === 60 ? [RTMT] : []),
      ...(k === RESET ? [scar(3, 3), ovtk(1, 0)] : []),
      ...(k === 115 ? [DRSD] : []),
      ...LIGHTS.flatMap((at, i) => (k === at ? [stlg(i + 1)] : [])),
      ...(k === LIGHTS_OUT ? [LGOT] : []),
      ...(k === LIGHTS_OUT + 40 ? [ovtk(1, 0)] : []),
      ...extra(k),
    ],
    cars: (d) => {
      if (k < RESET) {
        drive(k, 0, -6, FORMATION, false)(d);
        drive(k, 1, 20, FORMATION, false)(d);
        lap(d, 1, { resultStatus: k >= 60 ? 5 : 2 });
        fuel(d, 0, 100); fuel(d, 1, 100);
      } else {
        drive(k, 0, -6, LIGHTS_OUT, true)(d);
        drive(k, 1, 20, LIGHTS_OUT, true)(d);
        lap(d, 1, { resultStatus: 2, ...(k <= LIGHTS_OUT && { currentLapTimeInMs: 510 }) });
        const kg = k < 200 ? 99 : 98.5;
        fuel(d, 0, kg); fuel(d, 1, kg);
      }
    },
  }));

const startRun = () => run(script(formationStart()));
const events = (r: SessionRunner) => r.state.history.events;

describe('the formation lap', () => {
  it('opens on the formation status and gives way to the start lights at the first light; racing opens at lights out', () => {
    const { runner } = startRun();
    expect(runner.state.history.sessionPhases.map((p) => [p.kind, p.start, p.end])).toEqual([
      ['preStart', 0, FORMATION * STEP],
      ['formation', FORMATION * STEP, 0],
      ['startLights', 0, 0],
    ]);
    expect(runner.state.open.situations.session).toEqual({ kind: 'racing', start: 0, startLeaderLap: 1 });
  });
  it('the clock reset at the formation lap’s end changes nothing by itself', () => {
    const { results } = startRun();
    expect(results[RESET]!.delta.truncated).toBe(false);
  });
  it('lights out after a formation lap is a truncated step: the history it discards is rewritten', () => {
    const { results } = startRun();
    expect(results[LIGHTS_OUT]!.delta.truncated).toBe(true);
  });
});

describe('at lights out the formation lap is discarded', () => {
  it('every event of the formation goes (overtakes, the retirement, the DRS notice); the start lights and lights out stay', () => {
    const { runner } = startRun();
    expect(events(runner)).toEqual([
      ...[1, 2, 3, 4, 5].map((lights) => ({ at: 0, kind: 'startLights', params: { lights } })),
      { at: 0, kind: 'lightsOut', params: {} },
      { at: raceAt(40), kind: 'overtake', carId: 1, otherCarId: 0, params: {} },
    ]);
  });
  it('a lights-out event during the formation lap, before any start light, is no race start and goes with the formation', () => {
    const { runner } = run(script(formationStart((k) => (k === FORMATION + 5 ? [LGOT] : []))));
    expect(runner.state.history.sessionPhases.map((p) => p.kind)).toEqual(['preStart', 'formation', 'startLights']);
    expect(runner.state.open.situations.session).toEqual({ kind: 'racing', start: 0, startLeaderLap: 1 });
    expect(events(runner).filter((e) => e.kind === 'lightsOut')).toEqual([{ at: 0, kind: 'lightsOut', params: {} }]);
  });
  it('the formation lap’s mini-sector crossings go; lap 1 is crossed again from lights out, each boundary once', () => {
    const { runner } = startRun();
    const lap1 = runner.state.history.miniSectors.filter((m) => m.carId === 0 && m.lap === 1);
    expect(lap1.map((m) => m.segment)).toEqual(Array.from({ length: 50 }, (_, s) => s));
    expect(lap1[0]!.at).toBeLessThanOrEqual(raceAt(1));
  });
  it('lap 1 starts at lights out from its start: its fuel at the start is the fuel at lights out', () => {
    const { runner } = startRun();
    expect(runner.state.history.laps.filter((l) => l.lapNumber === 1 && l.carId === 0)).toMatchObject([{ fuelAtStartKg: { known: true, value: 98.5 } }]);
  });
  it('a car whose lap timer already runs on the grid starts lap 1 from its start at lights out too', () => {
    const { runner } = startRun();
    expect(runner.state.history.laps.filter((l) => l.lapNumber === 1 && l.carId === 1)).toMatchObject([{ fuelAtStartKg: { known: true, value: 98.5 } }]);
  });
});

describe('a flashback after lights out', () => {
  it('never reaches back into the formation lap: no formation event comes back', () => {
    const frames = script(formationStart());
    const { runner } = run(frames.slice(0, LIGHTS_OUT + 100));
    // the game goes back to frame 150, in the hold before lights out (it cannot, but no rewind may restore the formation)
    runner.apply(after(frames, 151, LIGHTS_OUT + 100)[0]!);
    const kinds = events(runner).map((e) => e.kind);
    expect(kinds.filter((k) => k === 'retirement' || k === 'drsDisabled' || k === 'overtake')).toEqual([]);
  });
  it('a rewind within the race equals a run that never saw the discarded frames', () => {
    const frames = script(formationStart());
    const fork = script(formationStart((k) => (k === LIGHTS_OUT + 70 ? [ovtk(0, 1)] : [])));
    const { runner } = run(frames.slice(0, LIGHTS_OUT + 110));
    for (const f of after(fork, LIGHTS_OUT + 61, LIGHTS_OUT + 110)) runner.apply(f);
    expect(runner.state.history).toEqual(run(fork).runner.state.history);
  });
});
