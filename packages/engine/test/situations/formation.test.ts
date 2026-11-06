// The formation lap is hidden, never discarded (contract C24, C26, C29; diagnosis t1-diagnosis.md P2/P3, shape S2 of
// raceSingaporeWet): the recorders record during the formation lap as always; the projection never shows a fact that is
// no span whose described frame lies in the `formation` span of `session-phase-race`, whenever it was recorded; every
// span stays visible; at lights out nothing changes and no reader restarts. The script: the grid from 0 s; the
// formation status at frame 10; the formation lap (car 0 and car 1 drive, an overtake, car 1's retirement and
// disqualification transient); the clock reset to 0 at frame 110 with the formation's resume and the grid re-ordering
// overtake; the clock holds at 0 through a DRS notice, five start lights (the first closes the formation span) and
// lights out at frame 209; the race runs from the frame after it, both cars complete lap 1 and an overtake comes at
// race frame 40. The reset is carried over like any fall that is no flashback (C36): from the reset on the race clock
// runs ahead of the session time by the formation lap's last time. Car 1 stands past the line with its lap timer at
// 510 ms from the reset on, as raceZandvoortOnline's cars 1-7 do.
import { describe, expect, it } from 'vitest';
import type { EventDetails } from '@pitwall/protocol';
import { SessionRunner } from '../../src/index.ts';
import { situationOf } from '../../src/situations/run.ts';
import { applyWith, PICK_B } from '../support/decisions.ts';
import { initFor } from '../support/run.ts';
import { after } from '../support/runner.ts';
import { beats, fuel, lap, LGOT, ovtk, run, scar, script, status, STEP, stlg, TRACK, type Beat } from './script.ts';

const MACHINE = 'session-phase-race';
const FORMATION = 10;
const RESET = 110;
const LIGHTS = [120, 130, 140, 150, 160];
const LIGHTS_OUT = 209;
/** Race frame k is frame `LIGHTS_OUT + k` (frame number `LIGHTS_OUT + k + 1`, C26); frame 0 of the race is lights out. */
const RACE_FRAMES = 121;
/** The reset's size: the formation lap's last session time, the race clock's offset from the reset on. */
const FORMATION_MS = (RESET - 1) * STEP;
/** Race frame k's time on the race clock. */
const raceAt = (k: number): number => FORMATION_MS + k * STEP;

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

/** The formation start of the file comment; `extra` adds events per frame, `cars` shapes the cars further. */
const formationStart = (extra: (k: number) => EventDetails[] = () => [], cars: (k: number, d: Parameters<NonNullable<Beat['cars']>>[0]) => void = () => {}): Beat[] =>
  beats(LIGHTS_OUT + RACE_FRAMES, (k) => ({
    at: k < RESET ? k * STEP : k <= LIGHTS_OUT ? 0 : (k - LIGHTS_OUT) * STEP,
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
      cars(k, d);
    },
  }));

const startRun = () => run(script(formationStart()));
const events = (r: SessionRunner) => r.state.history.events;
const spans = (r: SessionRunner) => r.state.history.spans[MACHINE] ?? [];
const current = (r: SessionRunner) => situationOf(r.state).byMachine[MACHINE]?.[0];
/** The frames the formation span covers (C26): from the frame it opened on up to, not including, the one it closed on. */
const FORMATION_FRAMES = { startFrame: FORMATION + 1, endFrame: LIGHTS[0]! + 1 };
const inFormation = (fact: { frame: number }) => fact.frame >= FORMATION_FRAMES.startFrame && fact.frame < FORMATION_FRAMES.endFrame;

describe('the formation lap', () => {
  it('opens on the formation status and gives way to the start lights at the first light; racing opens at lights out', () => {
    const { runner } = startRun();
    expect(spans(runner).map((s) => [s.kind, s.start, s.end, s.startFrame, s.endFrame])).toEqual([
      ['grid', 0, FORMATION * STEP, 1, FORMATION_FRAMES.startFrame],
      ['formation', FORMATION * STEP, raceAt(0), FORMATION_FRAMES.startFrame, FORMATION_FRAMES.endFrame],
      ['startLights', raceAt(0), raceAt(0), FORMATION_FRAMES.endFrame, LIGHTS_OUT + 1],
    ]);
    expect(current(runner)).toMatchObject({ kind: 'racing', start: raceAt(0), startFrame: LIGHTS_OUT + 1 });
  });
  it('the clock reset at the formation lap’s end changes nothing by itself', () => {
    const { results } = startRun();
    expect(results[RESET]!.delta.rewound).toBeUndefined();
  });
  it('lights out after a formation lap rewinds nothing: no step sets delta.rewound, and no reader restarts (C29, C30)', () => {
    const { results } = startRun();
    expect(results.filter((r) => r.delta.rewound !== undefined)).toEqual([]);
  });
});

describe('the formation lap’s facts are hidden, never discarded (C24, C29)', () => {
  it('a formation lap’s facts are hidden, and the formation span is visible', () => {
    const { runner } = startRun();
    // the start lights and lights out are spans, never race events (C13, Task 21)
    expect(events(runner)).toEqual([
      { at: raceAt(40), kind: 'overtake', carId: 1, otherCarId: 0, params: {}, frame: LIGHTS_OUT + 41 },
    ]);
    expect(spans(runner).filter((s) => s.kind === 'formation')).toHaveLength(1);
  });
  // The retirement and the DRS notice are spans since Task 21 (car-status, race-control-race), never race events (C13).
  it('the log keeps every fact the formation lap recorded, as recorded (the overtakes): none is removed or changed', () => {
    const { runner } = startRun();
    const hidden = runner.state.log.events.filter(inFormation);
    expect(hidden.map((e) => [e.kind, e.frame])).toEqual([
      ['overtake', 51],
      ['overtake', RESET + 1],
    ]);
    expect(runner.state.log.events.filter((e) => !inFormation(e))).toEqual(events(runner));
  });
  it('a lights-out event during the formation lap, before any start light, is no race start and is hidden with the formation', () => {
    const { runner } = run(script(formationStart((k) => (k === FORMATION + 5 ? [LGOT] : []))));
    expect(spans(runner).map((s) => s.kind)).toEqual(['grid', 'formation', 'startLights']);
    // lights out is the racing span's opening (C20; no race event since Task 21): at the race's lights out, not the formation's
    expect(current(runner)).toMatchObject({ kind: 'racing', start: raceAt(0), startFrame: LIGHTS_OUT + 1 });
    expect(spans(runner).filter((s) => s.kind === 'startLights').map((s) => [s.end, s.endFrame])).toEqual([[raceAt(0), LIGHTS_OUT + 1]]);
  });
  it('the formation lap’s mini-sector crossings are hidden; lap 1 is crossed again from lights out, each boundary once', () => {
    const { runner } = startRun();
    const lap1 = runner.state.history.crossings.filter((m) => m.carId === 0 && m.lap === 1);
    expect(lap1.map((m) => m.segment)).toEqual(Array.from({ length: 50 }, (_, s) => s));
    expect(lap1[0]!.at).toBeLessThanOrEqual(raceAt(1));
    expect(runner.state.log.crossings.filter(inFormation).length).toBeGreaterThan(0);
  });
  it('lap 1 starts at lights out from its start: its fuel at the start is the fuel at lights out', () => {
    const { runner } = startRun();
    expect(runner.state.history.laps.filter((l) => l.lapNumber === 1 && l.carId === 0)).toMatchObject([{ fuelAtStartKg: { known: true, value: 98.5 } }]);
  });
  // Review 2 B4: a car that enters the pit lane during the formation lap starts the race from the pit lane; that start is
  // no pit stop, and a stop after it is one (spec 3.2). Ported (C82): the behaviour stays without the discard; a pit stop
  // is a box stop (migration Task 17, ruling 1), so the later visit stops in its box (pit status 2) for five frames.
  it('a pit-lane start is no pit stop: the car in the pit lane from the formation lap to after lights out records none; its later stop is recorded', () => {
    const pitLane = (k: number) => (k >= 80 && k < LIGHTS_OUT + 30) || (k >= LIGHTS_OUT + 80 && k < LIGHTS_OUT + 100);
    const inBox = (k: number) => k >= LIGHTS_OUT + 85 && k < LIGHTS_OUT + 90;
    const { runner } = run(script(formationStart(() => [], (k, d) => lap(d, 0, { pitStatus: inBox(k) ? 2 : pitLane(k) ? 1 : 0 }))));
    expect(runner.state.history.pitStops.filter((s) => s.carId === 0)).toMatchObject([{ pitLaneEntry: raceAt(80), pitLaneExit: raceAt(100) }]);
  });
  it('a car whose lap timer already runs on the grid starts lap 1 from its start at lights out too', () => {
    const { runner } = startRun();
    expect(runner.state.history.laps.filter((l) => l.lapNumber === 1 && l.carId === 1)).toMatchObject([{ fuelAtStartKg: { known: true, value: 98.5 } }]);
  });
});

// C25, C26, C29: a confirmed lap describes its provisional's frame, the crossing. Car 0 drives 100 m a frame from the
// formation status on and crosses the line inside the formation lap (frame 21); after the reset it stands on the grid
// again; Session History confirms the lap on race frame 20, after lights out.
describe('a lap crossed in the formation lap and confirmed after lights out', () => {
  const RESET_AT = 40;
  const LIGHTS_AT = [42, 43, 44, 45, 46];
  const OUT = 50;
  const CONFIRMED = OUT + 20;
  const lapScript = () => script(beats(OUT + 40, (k) => ({
    at: k < RESET_AT ? k * STEP : k <= OUT ? 0 : (k - OUT) * STEP,
    ...(k === FORMATION && { session: status(3) }),
    ...(k === 43 && { session: status(0) }),
    events: [...LIGHTS_AT.flatMap((at, i) => (k === at ? [stlg(i + 1)] : [])), ...(k === OUT ? [LGOT] : [])],
    cars: (d) => {
      if (k >= FORMATION && k < 20) lap(d, 0, { currentLapNum: 1, lapDistance: 3000 + (k - FORMATION) * 100 });
      else if (k >= 20 && k < RESET_AT) lap(d, 0, { currentLapNum: 2, lapDistance: (k - 20) * 100 + 10, lastLapTimeInMs: 50_000 });
      else if (k >= RESET_AT) lap(d, 0, { currentLapNum: 1, lapDistance: -6 });
      if (k === CONFIRMED) {
        d.add('sessionHistory', { carIdx: 0, numLaps: 1, lapHistoryData: [{ lapTimeInMs: 50_100, sector1TimeMs: 16_000, sector2TimeMs: 17_000, sector3TimeMs: 17_100, lapValidBitFlags: 0b1111 }] });
      }
    },
  })));

  it('a confirmed lap recorded after lights out whose crossing lies in the formation span is hidden, as its provisional is', () => {
    const { runner } = run(lapScript());
    const lap1 = runner.state.log.laps.filter((l) => l.carId === 0 && l.lapNumber === 1);
    expect(lap1.map((l) => [l.status, l.frame])).toEqual([['provisional', 21], ['confirmed', 21]]);
    expect(spans(runner).find((s) => s.kind === 'formation')).toMatchObject({ startFrame: FORMATION + 1, endFrame: LIGHTS_AT[0]! + 1 });
    expect(runner.state.history.laps.filter((l) => l.carId === 0 && l.lapNumber === 1)).toEqual([]);
  });

  // C29 as changed for SP4.1a (spec 2, 3.3): a decision is never hidden by formation; a pick in the formation lap counts.
  it('a decision in the formation lap stays visible; the lap\'s other facts stay hidden (C29)', () => {
    const frames = lapScript();
    const runner = new SessionRunner(initFor(frames));
    // frame 20 (frame number 21) is the crossing's, inside the formation span
    frames.forEach((f, k) => applyWith(runner, f, k === 20 ? [PICK_B] : undefined));
    expect(spans(runner).find((s) => s.kind === 'formation')).toMatchObject({ startFrame: FORMATION + 1, endFrame: LIGHTS_AT[0]! + 1 });
    expect(runner.state.history.decisions).toEqual([{ ...PICK_B, frame: 21 }]);
    expect(runner.state.log.laps.filter((l) => l.carId === 0 && l.lapNumber === 1).map((l) => l.frame)).toEqual([21, 21]);
    expect(runner.state.history.laps.filter((l) => l.carId === 0 && l.lapNumber === 1)).toEqual([]);
  });
});

describe('a flashback across lights out (Review Focus 1)', () => {
  it('a flashback from racing into the formation lap voids everything after its target; the formation span is open again, and the projection equals a run that never received the undone frames', () => {
    const frames = script(formationStart());
    const fork = script(formationStart((k) => (k === 95 ? [ovtk(0, 1)] : k === LIGHTS_OUT + 50 ? [ovtk(0, 1)] : [])));
    const { runner } = run(frames.slice(0, LIGHTS_OUT + 100));
    const [first, ...rest] = after(fork, 91, LIGHTS_OUT + 100);
    const results: Array<{ rewound: boolean; open: string | undefined }> = [];
    runner.apply(first!, (r) => results.push({ rewound: r.delta.rewound !== undefined, open: situationOf(r.state).byMachine[MACHINE]?.[0]?.kind }));
    expect(results).toEqual([{ rewound: true, open: 'formation' }]);
    expect(spans(runner).map((s) => s.kind)).toEqual(['grid']);
    for (const f of rest) runner.apply(f);
    const fresh = run(fork).runner;
    expect(runner.state.history).toEqual(fresh.state.history);
    expect(situationOf(runner.state).byMachine[MACHINE]).toEqual(situationOf(fresh.state).byMachine[MACHINE]);
  });
  it('a rewind within the race equals a run that never saw the undone frames', () => {
    const frames = script(formationStart());
    const fork = script(formationStart((k) => (k === LIGHTS_OUT + 70 ? [ovtk(0, 1)] : [])));
    const { runner } = run(frames.slice(0, LIGHTS_OUT + 110));
    for (const f of after(fork, LIGHTS_OUT + 61, LIGHTS_OUT + 110)) runner.apply(f);
    expect(runner.state.history).toEqual(run(fork).runner.state.history);
  });
});
