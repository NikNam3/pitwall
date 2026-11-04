// The penalties recorder (contract C10, C13, C21, C26, C29, C40; migration Task 21, ruling 1): a `PenaltyRecord` for
// each penalty race control gives a car, read from the `penalties` sub-machine's spans in the situation, never from PENA
// (C13). A penalty is given where a car's penalties span opens with more unserved drive-throughs or stop-gos than the
// car's previous span, or a higher time total: one record per added penalty (two raised on one frame are two records),
// describing the frame its span opened on (C26), at its start. A time penalty's `timeMs` is the rise of the total; a
// drive-through or stop-go has none. The infringement is the span's (the PENA the sub-machine matched), unknown without
// one (C3). Serving a penalty, a falling total and a span opened on joining the session give none. A record whose frame
// lies in the formation span is hidden (C29). The list is `penalties`, its change tag `penalties` (C21, C40).
import { describe, expect, it } from 'vitest';
import { known, unknown } from '@pitwall/domain';
import type { EventDetails } from '@pitwall/protocol';
import { ScenarioBuilder } from '../builders/index.ts';
import { runScenario } from '../support/run.ts';

/** What car `car` owes on one frame (the LapData counts; `timeS`: the time penalties in total, s), and the events queued before it. */
type Owed = { dt?: number; sg?: number; timeS?: number; events?: EventDetails[]; car?: number };
const pena = (penaltyType: number, infringementType: number, o: { car?: number; timeS?: number } = {}): EventDetails =>
  ({ code: 'PENA', penaltyType, infringementType, vehicleIdx: o.car ?? 0, otherVehicleIdx: 255, time: o.timeS ?? 255, lapNum: 3, placesGained: 0 });
/** PENA types: 0 drive-through, 1 stop-go, 4 time penalty, 5 warning. */
const DT = 0;
const SG = 1;
const TIME = 4;
const WARNING = 5;

/** A race under way (every lap timer 30 s), one frame a second; frame i is frame number i + 1 (C26). `formation`: the formation lap from frame 1 on. */
const race = (frames: readonly Owed[], o: { formation?: boolean } = {}) => {
  const b = new ScenarioBuilder({ cars: 2, stepMs: 1000 });
  frames.forEach((f, i) => {
    if (o.formation && i === 1) b.session({ safetyCarStatus: 3 });
    for (const e of f.events ?? []) b.event(e);
    b.frame((d) => {
      for (const c of [0, 1]) {
        const mine = (f.car ?? 0) === c;
        Object.assign(d.lapData.lapData[c]!, {
          currentLapNum: o.formation ? 1 : 3,
          currentLapTimeInMs: o.formation ? 0 : 30_000,
          numUnservedDriveThroughPens: mine ? (f.dt ?? 0) : 0,
          numUnservedStopGoPens: mine ? (f.sg ?? 0) : 0,
          penalties: mine ? (f.timeS ?? 0) : 0,
        });
      }
    });
  });
  return runScenario(b);
};
type Run = ReturnType<typeof race>;
/** The penalty records readers see. */
const records = (r: Run) => r.st.history.penalties;
/** The frames (by index) whose step changed `penalties`. */
const changedOn = (r: Run) => r.results.flatMap((res, i) => (res.changed.has('penalties') ? [i] : []));
const t = (r: Run, i: number) => r.frames[i]!.sessionTime;

describe('penalty records from the penalties spans', () => {
  it('a drive-through given: one record, its infringement the PENA’s, describing the frame its span opened on (the rise), the change tag on it', () => {
    const r = race([{}, {}, { events: [pena(DT, 38)] }, { dt: 1 }, { dt: 1 }, { dt: 1 }]);
    expect(records(r)).toEqual([{ carId: 0, kind: 'driveThrough', infringement: known(38, t(r, 2)), timeMs: undefined, at: t(r, 3), frame: 4 }]);
    expect(changedOn(r)).toEqual([3]);
  });
  it('a stop-go given: one stopGo record (not yet seen, C19)', () => {
    const r = race([{}, {}, { events: [pena(SG, 7)] }, { sg: 1 }, { sg: 1 }]);
    expect(records(r)).toEqual([{ carId: 0, kind: 'stopGo', infringement: known(7, t(r, 2)), timeMs: undefined, at: t(r, 3), frame: 4 }]);
  });
  it('a time penalty given: timeMs the rise of the total, its infringement the PENA’s', () => {
    const r = race([{}, {}, { events: [pena(TIME, 21, { timeS: 5 })] }, { timeS: 5 }, { timeS: 5 }]);
    expect(records(r)).toEqual([{ carId: 0, kind: 'time', infringement: known(21, t(r, 2)), timeMs: 5_000, at: t(r, 3), frame: 4 }]);
    expect(changedOn(r)).toEqual([3]);
  });
  it('a further time penalty is a record of the rise only, with its own PENA’s infringement', () => {
    const r = race([{}, { events: [pena(TIME, 21, { timeS: 5 })] }, { timeS: 5 }, { timeS: 5 }, { timeS: 5, events: [pena(TIME, 7, { timeS: 3 })] }, { timeS: 8 }]);
    expect(records(r)).toEqual([
      { carId: 0, kind: 'time', infringement: known(21, t(r, 1)), timeMs: 5_000, at: t(r, 2), frame: 3 },
      { carId: 0, kind: 'time', infringement: known(7, t(r, 4)), timeMs: 3_000, at: t(r, 5), frame: 6 },
    ]);
  });
  it('a penalty of another car is that car’s record; a rise with no PENA has the infringement unknown(notReceived), never 0 (C3)', () => {
    const r = race([{}, {}, { car: 1, timeS: 5 }, { car: 1, timeS: 5 }]);
    expect(records(r)).toEqual([{ carId: 1, kind: 'time', infringement: unknown('notReceived'), timeMs: 5_000, at: t(r, 2), frame: 3 }]);
  });
  it('two penalties raised on one frame are two records: a drive-through and a stop-go, the drive-through first', () => {
    const r = race([{}, {}, { dt: 1, sg: 1 }, { dt: 1, sg: 1 }]);
    const on = { infringement: unknown('notReceived'), timeMs: undefined, at: t(r, 2), frame: 3 };
    expect(records(r)).toEqual([{ carId: 0, kind: 'driveThrough', ...on }, { carId: 0, kind: 'stopGo', ...on }]);
    expect(changedOn(r)).toEqual([2]);
  });
  it('two penalties raised on one frame are two records: two drive-throughs (the count 0 -> 2)', () => {
    const r = race([{}, {}, { dt: 2 }, { dt: 2 }]);
    expect(records(r)).toEqual([0, 1].map(() => ({ carId: 0, kind: 'driveThrough', infringement: unknown('notReceived'), timeMs: undefined, at: t(r, 2), frame: 3 })));
  });
  it('two penalties raised on one frame are two records: a drive-through and a time penalty', () => {
    const r = race([{}, {}, { dt: 1, timeS: 5 }, { dt: 1, timeS: 5 }]);
    expect(records(r)).toHaveLength(2);
    const kinds = records(r).map((p) => [p.kind, p.timeMs, p.frame]).sort();
    expect(kinds).toEqual([['driveThrough', undefined, 3], ['time', 5_000, 3]]);
  });
  it('a second drive-through while one is pending: one more record, on the frame the count rose', () => {
    const r = race([{}, { events: [pena(DT, 38)] }, { dt: 1 }, { dt: 1 }, { dt: 1, events: [pena(DT, 40)] }, { dt: 2 }, { dt: 2 }]);
    expect(records(r)).toMatchObject([{ carId: 0, kind: 'driveThrough', frame: 3 }, { carId: 0, kind: 'driveThrough', at: t(r, 5), frame: 6 }]);
  });
  it('a time penalty given while a drive-through is pending: a time record of the rise; the drive-through gives no second record', () => {
    const r = race([{}, { events: [pena(DT, 38)] }, { dt: 1 }, { dt: 1 }, { dt: 1, events: [pena(TIME, 21, { timeS: 5 })] }, { dt: 1, timeS: 5 }, { dt: 1, timeS: 5 }]);
    expect(records(r)).toMatchObject([{ kind: 'driveThrough', frame: 3 }, { kind: 'time', timeMs: 5_000, at: t(r, 5), frame: 6 }]);
    expect(records(r)).toHaveLength(2);
  });
  it('serving a penalty gives none: the count falling, a drive-through served while a time penalty stands, the total falling', () => {
    const served = race([{}, { events: [pena(DT, 38)] }, { dt: 1 }, { dt: 1 }, { dt: 0 }, { dt: 0 }]);
    expect(records(served)).toMatchObject([{ kind: 'driveThrough', frame: 3 }]);
    expect(records(served)).toHaveLength(1);
    const standing = race([{}, { timeS: 5 }, { timeS: 5, events: [pena(DT, 38)] }, { timeS: 5, dt: 1 }, { timeS: 5, dt: 1 }, { timeS: 5, dt: 0 }, { timeS: 5 }]);
    expect(records(standing).map((p) => p.kind)).toEqual(['time', 'driveThrough']);
    const falling = race([{}, { timeS: 5 }, { timeS: 5 }, { timeS: 0 }, { timeS: 0 }]);
    expect(records(falling).map((p) => p.kind)).toEqual(['time']);
  });
  it('a penalty owed since the engine joined the session (its span opened joined) gives no record: it was not seen given', () => {
    const r = race([{ dt: 1, timeS: 5 }, { dt: 1, timeS: 5 }, { dt: 1, timeS: 5 }]);
    expect(records(r)).toEqual([]);
    expect(changedOn(r)).toEqual([]);
  });
  it('a PENA alone (no count or total rises) gives no record: records come from the spans, never from PENA (C13)', () => {
    const r = race([{}, { events: [pena(DT, 38), pena(SG, 7), pena(TIME, 21, { timeS: 5 }), pena(WARNING, 7)] }, {}, {}, {}]);
    expect(records(r)).toEqual([]);
  });
  it('a penalty given during the formation lap is hidden (C29): the log keeps the record as recorded, the projection skips it', () => {
    const r = race([{}, {}, { dt: 1 }, { dt: 1 }], { formation: true });
    expect(r.st.history.spans['session-phase-race']).toMatchObject([{ kind: 'grid', endFrame: 2 }]);
    expect(r.st.log.penalties).toMatchObject([{ kind: 'driveThrough', frame: 3 }]);
    expect(records(r)).toEqual([]);
  });
});
