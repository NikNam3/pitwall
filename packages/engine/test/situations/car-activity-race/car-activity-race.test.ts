// The race's car-activity sub-machine (contract C9, C11, C12, C13, C14, C15, C17, C18, C19, C20, C26, C40, C85): per car,
// race only, what a car is doing by the race's rules, from the lights out: racingLap, inLap, boxStop, servingPenalty
// (`ServingPenaltyDetail`), outLap, finished, coolDown, notCompeting; its spans declared in domain
// (`carActivityRaceSpans`). The rules and the facts behind them are in the header of car-activity-race.transitions.ts
// (one row per declared transition and per join); this file pins what the rows leave open: when the scope begins, the
// span ids, starts and details, the confirmation of a served penalty (C18, Review Focus 5), the finish (Review Focus 3)
// and a flashback across a pit exit (Review Focus 1). Segments: car-activity-race.segments.test.ts.
import { describe, expect, it } from 'vitest';
import { carActivityRaceSpans, type OpenSpan, type Span } from '@pitwall/domain';
import type { SessionRunner } from '../../../src/index.ts';
import machine, { SERVED_WITHIN_MS } from '../../../src/situations/car-activity-race/machine.ts';
import type { MachineInput } from '../../../src/situations/machine.ts';
import { situationOf } from '../../../src/situations/run.ts';
import { after } from '../../support/runner.ts';
import { FRAME_MS, inputs, type InputEdit } from '../../support/transition-table.ts';
import { gridStart, lap as lapData, LIGHTS_OUT, run as runScript, script, type Beat } from '../script.ts';
import {
  all,
  atMs,
  crosses,
  distance,
  dtsv,
  events,
  inBox,
  inPitLane,
  lap,
  lateInLap,
  MACHINE,
  onTrack,
  owes,
  pastLine,
  race,
  result,
  sgsv,
  status,
  unknownCar,
} from './inputs.ts';

type Closed = Omit<Span, 'endFrame'>;
type Run = { open: Array<OpenSpan | undefined>; closed: Closed[][]; all: OpenSpan[][] };

/** Steps the machine through the frames: car `index`'s open span after each, the spans of the car each frame closed, and every open span after each. */
const run = (builder: ReturnType<typeof inputs>, index = 0): Run => {
  let open = machine.init();
  const result: Run = { open: [], closed: [], all: [] };
  for (const input of builder.build()) {
    const step = machine.step(open, input);
    open = step.open;
    const spans = machine.openSpans(open);
    result.all.push(spans);
    result.open.push(spans.find((s) => s.carId === index));
    result.closed.push(step.closed.filter((s) => s.carId === index));
  }
  return result;
};
const kinds = (r: Run) => r.open.map((s) => s?.kind);
const closedOf = (r: Run) => r.closed.flat();
/** The first frame, joined: car 0 racing on track. */
const joined = () => inputs().frame(race());
/** The race-clock time of frame `index` of a builder (`FRAME_MS` apart from 0). */
const at = (index: number) => index * FRAME_MS;
/** Car 0 owes a drive-through (its penalties span id 3), then enters the pit lane on frame 3. */
const servingFrom3 = () => joined().frame(owes(0, 'driveThroughPending', 3)).frame().frame(inPitLane(0));
const noSessionPhase: InputEdit = (i: MachineInput) => {
  delete i.upstream['session-phase-race'];
};

describe('car-activity-race: id, span declaration, applies to, inputs', () => {
  it('is the sub-machine car-activity-race, its spans the car-scoped declaration in domain, for the race only (C15, C17)', () => {
    expect([machine.id, machine.spans, machine.appliesTo]).toEqual([MACHINE, carActivityRaceSpans, ['race']]);
    expect(machine.spans.scope).toBe('car');
    expect([...carActivityRaceSpans.kinds].sort()).toEqual(['boxStop', 'coolDown', 'finished', 'inLap', 'notCompeting', 'outLap', 'racingLap', 'servingPenalty']);
  });
  it('reads the signals pitStatus, pitLaneTimerActive, resultStatus and the events (DTSV, SGSV), the timing area, and car-location, car-status, penalties and session-phase-race upstream (C15; weekend-phase in its upstream closure, C14)', () => {
    expect([...machine.inputs.signals].sort()).toEqual(['events', 'pitLaneTimerActive', 'pitStatus', 'resultStatus']);
    expect(machine.inputs.values).toEqual(['timing']);
    expect([...machine.inputs.upstream].sort()).toEqual(['car-location', 'car-status', 'penalties', 'session-phase-race']);
  });
  it('waits up to 10 s after the pit exit for a DTSV or SGSV (inventory §2.7: 7.1 s)', () => {
    expect(SERVED_WITHIN_MS).toBe(10_000);
  });
});

describe('car-activity-race: the scope begins at the lights out', () => {
  it('opens no span on the grid, in the formation lap or under the start lights', () => {
    const r = run(inputs().frame(race('grid')).frame(race('formation')).frame(race('startLights')).frames(2));
    expect(r.all).toEqual([[], [], [], [], []]);
    expect(closedOf(r)).toEqual([]);
  });
  it('opens no span while the race session phase has no span', () => {
    const r = run(inputs().frames(3, all(race(), noSessionPhase)));
    expect(r.all).toEqual([[], [], []]);
  });
  it('on the lights out every slot with a car-status span opens on that frame, id 0, confirmed, without joinedAt: the cars racingLap, the absent slots notCompeting', () => {
    const r = run(inputs().frame(race('grid')).frame(race('startLights')).frame(race('racing')).frames(2));
    expect([r.all[0], r.all[1]]).toEqual([[], []]);
    const spans = r.all[2]!;
    expect(spans.map((s) => s.carId)).toEqual(Array.from({ length: spans.length }, (_, i) => i));
    for (const s of spans) {
      expect([s.machine, s.id, s.start, s.startFrame, s.confirmed]).toEqual([MACHINE, 0, at(2), 3, true]);
      expect(s.joinedAt).toBeUndefined();
    }
    expect(spans.map((s) => s.kind)).toEqual(['racingLap', 'racingLap', ...Array(spans.length - 2).fill('notCompeting')]);
    expect(r.all[4]).toEqual(spans);
  });
  it('a race whose phase goes from the grid straight to racing (no start light seen) opens its spans then, without joinedAt', () => {
    const r = run(inputs().frames(2, race('grid')).frame(race('racing')));
    expect(r.open[2]).toMatchObject({ kind: 'racingLap', startFrame: 3 });
    expect(r.open[2]!.joinedAt).toBeUndefined();
  });
  it.each(['racing', 'neutralised', 'suspended', 'finished', 'postSession'] as const)(
    'a race joined in %s opens every car’s current activity on the machine’s first frame, with joinedAt, id 0 (Review Focus 2)',
    (phase) => {
      const r = run(inputs().frame(race(phase)).frames(2));
      for (const s of r.all[0]!) expect([s.id, s.startFrame, s.joinedAt]).toEqual([0, 1, true]);
      expect(r.all[0]!.length).toBeGreaterThan(2);
      expect(r.all[2]).toEqual(r.all[0]);
    },
  );
  it('a car with no car-status span yet (no Participants data, C3) opens nothing; it opens its current activity, joined, on the first frame it has one', () => {
    const r = run(inputs().frame(race('grid')).frame(all(race('racing'), unknownCar(1))).frame().frame(status(1, 'competing')), 1);
    expect(kinds(r)).toEqual([undefined, undefined, undefined, 'racingLap']);
    expect(r.open[3]).toMatchObject({ id: 0, startFrame: 4, joinedAt: true });
    expect(r.all[1]!.find((s) => s.carId === 0)?.joinedAt).toBeUndefined();
  });
  it('a red flag’s standing restart (racing -> suspended -> startLights -> racing) changes no activity', () => {
    const r = run(joined().frames(2).frame(race('suspended')).frames(2).frame(race('startLights')).frames(2).frame(race('racing')).frames(2));
    expect(r.open.map((s) => [s?.kind, s?.id])).toEqual(Array(12).fill(['racingLap', 0]));
    expect(closedOf(r)).toEqual([]);
  });
});

describe('car-activity-race: a pit visit (inventory §2.5)', () => {
  // Frame 2 the pit entry; 4 the line in the pit lane (lap 7 -> 8); 5-6 the box; 7 leaving it; 9 the pit exit; 11 the
  // line on track (lap 8 -> 9).
  const visit = () =>
    inputs()
      .frame(all(race(), lap(0, 7)))
      .frame()
      .frame(inPitLane(0))
      .frame()
      .frame(lap(0, 8))
      .frame(inBox(0))
      .frame(inBox(0))
      .frame(inPitLane(0))
      .frame()
      .frame(onTrack(0))
      .frame()
      .frame(lap(0, 9));

  it('racingLap, inLap from the pit entry, boxStop from the box, outLap from leaving it, racingLap from the first line on track; the line in the pit lane and the pit exit change nothing', () => {
    expect(kinds(run(visit()))).toEqual(['racingLap', 'racingLap', 'inLap', 'inLap', 'inLap', 'boxStop', 'boxStop', 'outLap', 'outLap', 'outLap', 'outLap', 'racingLap']);
  });
  it('each span opens on its frame with the next id, confirmed, without joinedAt or detail, and closes the one before at that frame’s time (C26)', () => {
    const r = run(visit());
    const opened = [2, 5, 7, 11];
    opened.forEach((frame, k) => {
      expect(r.open[frame]).toEqual({ machine: MACHINE, id: k + 1, carId: 0, kind: kinds(r)[frame], start: at(frame), startFrame: frame + 1, confirmed: true, detail: undefined });
      expect(r.closed[frame]).toMatchObject([{ id: k, kind: kinds(r)[frame - 1], end: at(frame), confirmed: true }]);
    });
    expect(r.closed.filter((c, frame) => c.length > 0 && !opened.includes(frame))).toEqual([]);
    expect(r.closed[2]).toMatchObject([{ id: 0, kind: 'racingLap', start: 0, startFrame: 1, joinedAt: true }]);
  });
  it('a lap rise in the pit lane after the box does not end the out lap: it ends at the first lap rise on track', () => {
    const r = run(joined().frame(inPitLane(0)).frame(inBox(0)).frame(inPitLane(0)).frame(lap(0, 2)).frame(onTrack(0)).frame().frame(lap(0, 3)));
    expect(kinds(r)).toEqual(['racingLap', 'inLap', 'boxStop', 'outLap', 'outLap', 'outLap', 'outLap', 'racingLap']);
  });
  it('a time penalty owed at the pit entry is no penalty to serve there: inLap', () => {
    expect(kinds(run(joined().frame(owes(0, 'timePenalty')).frame(inPitLane(0))))).toEqual(['racingLap', 'racingLap', 'inLap']);
  });
});

describe('car-activity-race: serving a penalty (inventory §2.7, C18, Review Focus 5)', () => {
  it('the pit entry owing a drive-through opens servingPenalty unconfirmed, naming the penalties span open then', () => {
    const r = run(servingFrom3());
    expect(r.open[3]).toEqual({
      machine: MACHINE,
      id: 1,
      carId: 0,
      kind: 'servingPenalty',
      start: at(3),
      startFrame: 4,
      confirmed: false,
      detail: { penalty: 'driveThrough', given: { machine: 'penalties', carId: 0, spanId: 3 } },
    });
  });
  it('owing a stop-go, the penalty is stopGo', () => {
    const r = run(joined().frame(owes(0, 'stopGoPending', 5)).frame(inPitLane(0)));
    expect(r.open[2]).toMatchObject({ kind: 'servingPenalty', confirmed: false, detail: { penalty: 'stopGo', given: { machine: 'penalties', carId: 0, spanId: 5 } } });
  });
  it('one span holds the whole visit: the box, leaving it and the pit exit (the box time of a penalty visit is servingPenalty), the given span the entry’s even when the penalties span changes', () => {
    const r = run(servingFrom3().frame(inBox(0)).frames(3, inBox(0)).frame(inPitLane(0)).frame(owes(0, 'clear')).frame(onTrack(0)).frames(3));
    expect(r.open.slice(3).map((s) => [s?.kind, s?.id, s?.confirmed])).toEqual(Array(11).fill(['servingPenalty', 1, false]));
    expect(r.open.at(-1)!.detail).toEqual({ penalty: 'driveThrough', given: { machine: 'penalties', carId: 0, spanId: 3 } });
    expect(closedOf(r).map((s) => s.kind)).toEqual(['racingLap']);
  });
  it('a DTSV in the pit lane confirms the open span from that frame; it closes at the pit exit, confirmed, and outLap opens there', () => {
    const r = run(servingFrom3().frame().frame(events(dtsv(0))).frame().frame(onTrack(0)).frame());
    expect(r.open.slice(3, 7).map((s) => s?.confirmed)).toEqual([false, false, true, true]);
    expect(r.closed[7]).toMatchObject([{ id: 1, kind: 'servingPenalty', start: at(3), end: at(7), startFrame: 4, confirmed: true }]);
    expect(r.open[7]).toMatchObject({ id: 2, kind: 'outLap', start: at(7), startFrame: 8, confirmed: true });
  });
  it('a DTSV after the pit exit (MiR: 7.1 s): the span stays open past the exit, unconfirmed, and closes on the DTSV frame, confirmed; outLap opens on it', () => {
    const r = run(servingFrom3().frame(inBox(0)).frame(inPitLane(0)).frame(onTrack(0)).frames(4).frame(events(dtsv(0))).frame());
    expect(r.open.slice(3, 11).map((s) => [s?.kind, s?.confirmed])).toEqual(Array(8).fill(['servingPenalty', false]));
    expect(r.closed.slice(4, 11).flat()).toEqual([]);
    expect(r.closed[11]).toMatchObject([{ id: 1, kind: 'servingPenalty', end: at(11), confirmed: true, detail: { penalty: 'driveThrough', given: { spanId: 3 } } }]);
    expect(r.open[11]).toMatchObject({ id: 2, kind: 'outLap', start: at(11), startFrame: 12 });
    expect(r.open[12]).toMatchObject({ id: 2, kind: 'outLap' });
  });
  it('an SGSV after the pit exit confirms a stop-go the same way', () => {
    const r = run(joined().frame(owes(0, 'stopGoPending', 1)).frame(inPitLane(0)).frame(inBox(0)).frame(inPitLane(0)).frame(onTrack(0)).frame(events(sgsv(0))));
    expect(r.closed[6]).toMatchObject([{ kind: 'servingPenalty', confirmed: true, detail: { penalty: 'stopGo' } }]);
    expect(r.open[6]).toMatchObject({ kind: 'outLap' });
  });
  it.each([
    ['a DTSV of another car', dtsv(1)],
    ['an SGSV for a drive-through', sgsv(0)],
  ])('%s confirms nothing', (_, event) => {
    const r = run(servingFrom3().frame(onTrack(0)).frame(events(event)).frame());
    expect(r.open.slice(3).map((s) => [s?.kind, s?.confirmed])).toEqual(Array(4).fill(['servingPenalty', false]));
  });
  it('a DTSV for a stop-go confirms nothing', () => {
    const r = run(joined().frame(owes(0, 'stopGoPending', 1)).frame(inPitLane(0)).frame(onTrack(0)).frame(events(dtsv(0))));
    expect(r.open[4]).toMatchObject({ kind: 'servingPenalty', confirmed: false });
  });
  it('no DTSV: still open exactly 10 s after the pit exit; closed confirmed false on the first frame past it, outLap opening there (C18: nothing withdrawn)', () => {
    // The pit exit on frame 4, at at(4).
    const exit = () => servingFrom3().frame(onTrack(0));
    const held = run(exit().frame(atMs(at(4) + SERVED_WITHIN_MS)));
    expect(held.open[5]).toMatchObject({ kind: 'servingPenalty', confirmed: false });
    const r = run(exit().frame(atMs(at(4) + SERVED_WITHIN_MS + 1)));
    expect(r.closed[5]).toMatchObject([{ id: 1, kind: 'servingPenalty', end: at(4) + SERVED_WITHIN_MS + 1, confirmed: false }]);
    expect(r.open[5]).toMatchObject({ id: 2, kind: 'outLap', start: at(4) + SERVED_WITHIN_MS + 1, startFrame: 6 });
  });
  it('a car that retires while serving closes the span as it stands (unconfirmed)', () => {
    const r = run(servingFrom3().frame(status(0, 'retired')));
    expect(r.closed[4]).toMatchObject([{ kind: 'servingPenalty', confirmed: false }]);
    expect(r.open[4]).toMatchObject({ kind: 'notCompeting' });
  });
});

describe('car-activity-race: the finish (inventory §2.10, Review Focus 3)', () => {
  /** Frame 1 late in the last lap, frame 2 across the line, frame 3 the result status finished, frames 4-5 driving on. */
  const finish = () => inputs().frame(all(race('finished'), lateInLap(0))).frame().frame(crosses(0)).frame(all(pastLine(0), result(0, 'finished'))).frame(pastLine(0, 8)).frame(pastLine(0, 12));

  it('finished opens on the frame the result status turns finished after the crossing, covers that one frame, and coolDown follows on the next', () => {
    const r = run(finish());
    expect(kinds(r)).toEqual(['racingLap', 'racingLap', 'racingLap', 'finished', 'coolDown', 'coolDown']);
    expect(r.open[3]).toMatchObject({ id: 1, start: at(3), startFrame: 4, confirmed: true, detail: undefined });
    expect(r.closed[4]).toMatchObject([{ id: 1, kind: 'finished', start: at(3), end: at(4), startFrame: 4 }]);
    expect(r.open[4]).toMatchObject({ id: 2, kind: 'coolDown', startFrame: 5 });
  });
  it('coolDown holds when the car enters the pit lane and its box after the flag', () => {
    const r = run(finish().frame(inPitLane(0)).frame(inBox(0)).frame(inPitLane(0)));
    expect(kinds(r).slice(4)).toEqual(Array(5).fill('coolDown'));
  });
  it('a result status set finished mid-lap with no crossing on that frame or the one before (the session’s last frame) finishes nothing; a later crossing finishes the car on it', () => {
    const r = run(inputs().frame(all(race('finished'), distance(0, 5289))).frame(result(0, 'finished')).frames(2).frame(lateInLap(0)).frame(crosses(0)));
    expect(kinds(r)).toEqual(['racingLap', 'racingLap', 'racingLap', 'racingLap', 'racingLap', 'finished']);
  });
  it('a line crossing with the result status active changes nothing', () => {
    const r = run(inputs().frame(all(race('finished'), lateInLap(0))).frame(crosses(0)).frame(pastLine(0)));
    expect(kinds(r)).toEqual(['racingLap', 'racingLap', 'racingLap']);
    expect(closedOf(r)).toEqual([]);
  });
});

describe('car-activity-race: not competing (C43)', () => {
  it.each(['retired', 'disqualified', 'absent'] as const)('a car whose status turns %s is notCompeting from that frame', (kind) => {
    const r = run(joined().frames(2).frame(status(0, kind)).frame());
    expect(kinds(r)).toEqual(['racingLap', 'racingLap', 'racingLap', 'notCompeting', 'notCompeting']);
    expect(r.open[3]).toMatchObject({ id: 1, startFrame: 4, confirmed: true, detail: undefined });
  });
});

describe('car-activity-race: per car', () => {
  it('a car’s activity does not touch another car’s spans, and each car counts its own span ids', () => {
    const r = run(joined().frame(inPitLane(0)).frame(inBox(0)).frame(inPitLane(1)), 1);
    expect(r.open.map((s) => [s?.kind, s?.id])).toEqual([['racingLap', 0], ['racingLap', 0], ['racingLap', 0], ['inLap', 1]]);
    expect(r.closed.slice(0, 3).flat()).toEqual([]);
  });
});

describe('car-activity-race: a flashback across a pit exit (Review Focus 1)', () => {
  /** Index of race frame k of `gridStart` among the frames; its frame number is one more (C26). */
  const raceFrame = (k: number) => LIGHTS_OUT + 1 + k;
  /**
   * Car 0's race: the pit entry at race frame 20, the line in the pit lane at 25, the box from 30 to 39, leaving it at
   * 40, the pit exit at `exitAt`, the line on track at 150.
   */
  const visit = (exitAt: number) => (k: number): Beat => ({
    cars: (d) =>
      lapData(d, 0, {
        currentLapNum: k < 25 ? 1 : k < 150 ? 2 : 3,
        lapDistance: k < 25 ? 3000 + 40 * k : 10 + 20 * (k < 150 ? k - 25 : k - 150),
        pitStatus: k < 20 || k >= exitAt ? 0 : k >= 30 && k < 40 ? 2 : 1,
        pitLaneTimerActive: k >= 20 && k < exitAt ? 1 : 0,
        pitStopTimerInMs: k >= 30 && k < exitAt ? Math.min(k - 30, 9) * 16 + 16 : 0,
      }),
  });
  const spans = (r: SessionRunner) => (r.state.history.spans[MACHINE] ?? []).filter((s) => s.carId === 0);
  const open = (r: SessionRunner) => situationOf(r.state).byMachine[MACHINE]?.find((s) => s.carId === 0);

  it('a straight run: racingLap from the lights out (no joinedAt), inLap, boxStop, outLap from leaving the box, racingLap from the line on track', () => {
    const { runner } = runScript(script(gridStart(200, visit(60))));
    expect(spans(runner).map((s) => [s.kind, s.id, s.startFrame])).toEqual([
      ['racingLap', 0, raceFrame(-1) + 1],
      ['inLap', 1, raceFrame(20) + 1],
      ['boxStop', 2, raceFrame(30) + 1],
      ['outLap', 3, raceFrame(40) + 1],
    ]);
    expect(spans(runner)[0]!.joinedAt).toBeUndefined();
    expect(open(runner)).toMatchObject({ kind: 'racingLap', id: 4, startFrame: raceFrame(150) + 1 });
  });
  it('a flashback from after the pit exit and the line into the pit lane re-opens the out lap with the same id; spans and open spans then equal a run that never received the undone frames (C26, C27, C33)', () => {
    // The first run goes past the line on track (racingLap id 4 open); the game goes back to race frame 50, in the pit
    // lane after the box, and the fork exits at 70 instead of 60.
    const first = script(gridStart(200, visit(60))).slice(0, raceFrame(160) + 1);
    const fork = script(gridStart(200, visit(70)));
    const { runner } = runScript(first);
    expect(open(runner)).toMatchObject({ kind: 'racingLap', id: 4 });
    const [flashback, ...rest] = after(fork, raceFrame(51), raceFrame(161));
    const seen: Array<{ rewound: boolean; open: OpenSpan | undefined }> = [];
    runner.apply(flashback!, (r) => seen.push({ rewound: r.delta.rewound !== undefined, open: situationOf(r.state).byMachine[MACHINE]?.find((s) => s.carId === 0) }));
    expect(seen).toMatchObject([{ rewound: true, open: { kind: 'outLap', id: 3, startFrame: raceFrame(40) + 1 } }]);
    expect(spans(runner).map((s) => s.kind)).toEqual(['racingLap', 'inLap', 'boxStop']);
    for (const f of rest) runner.apply(f);
    const fresh = runScript(fork).runner;
    expect(runner.state.history.spans[MACHINE]).toEqual(fresh.state.history.spans[MACHINE]);
    expect(situationOf(runner.state).byMachine[MACHINE]).toEqual(situationOf(fresh.state).byMachine[MACHINE]);
    expect(spans(fresh).map((s) => [s.kind, s.id])).toEqual([['racingLap', 0], ['inLap', 1], ['boxStop', 2], ['outLap', 3]]);
  });
});
