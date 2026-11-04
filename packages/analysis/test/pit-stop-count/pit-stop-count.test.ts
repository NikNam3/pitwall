// `pit-stop-count` (M7-R, final review F2): each car's pit stops, counted from the projection's pit-stop records, for
// every car car-status has had in the session. A quick analysis (C31, C42): its output is bound to `pitStopCount.byCar`
// (C53, C56); the core topic `cars.overview` no longer counts (C54) and the tower only joins the count (C65).
//  - The cars: every car with a car-status span other than `absent`, open now or closed in the projection (a car that
//    turned absent keeps its entry); a slot that was only ever `absent` holds no car of the session. Ordered by car id.
//  - `stops`: the number of the car's `PitStopRecord`s in the projection, the count `cars.overview` gave before.
//  - After a flashback that voids a stop, the count drops: it equals a fresh run over the projection after the void (C33).
// Guarded-view and behaviour-table completeness (C41, C44) come from the generic registry tests.
import { carId, unknown, type PitStopRecord, type Span, type OpenSpan } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { guardedView } from '../../../engine/test/support/scheduler.ts';
import { engineView, history } from '../../../../test-support/builders/index.ts';
import { PIT_STOP_COUNT, pitStopCountCalculator } from '../../src/index.ts';

const RACE = { kind: 'race', format: 'grandPrix' } as const;

/** A pit-stop record of car `car` on lap `lap`, describing frame `frame`. */
const stop = (car: number, lap: number, frame = lap * 100): PitStopRecord => ({
  carId: carId(car), lap, pitLaneEntry: lap * 90_000, pitLaneExit: lap * 90_000 + 20_000, pitLaneTimeMs: 20_000, stationaryTimeMs: 2_500,
  flag: 'green', penaltyServed: false, frame,
});

/** The car-status span detail of `kind` (a retired car carries its cause). */
const detailOf = (kind: string): unknown => (kind === 'retired' ? { cause: unknown('notReceived') } : undefined);

/** An open car-status span of car `car`. */
const open = (car: number, kind: string, id = 0, startFrame = 1): OpenSpan => ({
  machine: 'car-status', id, carId: carId(car), kind, start: startFrame * 10, confirmed: true, detail: detailOf(kind), startFrame,
});

/** A closed car-status span of car `car`, from `startFrame` up to `endFrame`. */
const closed = (car: number, kind: string, startFrame: number, endFrame: number, id = 0): Span => ({
  ...open(car, kind, id, startFrame), end: endFrame * 10, endFrame,
});

/** A race view: car-status's open spans `now`, its closed spans `before` in the projection, and the pit-stop records. */
const viewOf = (o: { now: OpenSpan[]; before?: Span[]; pitStops?: PitStopRecord[]; delta?: EngineView['delta'] }): EngineView =>
  engineView({
    history: history({ pitStops: o.pitStops ?? [], spans: { 'car-status': o.before ?? [] } }),
    situation: { weekendPhase: RACE, byMachine: { 'car-status': o.now } },
    ...(o.delta !== undefined && { delta: o.delta }),
  });

/** `compute` through the guarded view: a read the analysis does not declare throws (C41). */
const compute = (view: EngineView) => pitStopCountCalculator.compute(guardedView(view, pitStopCountCalculator.reads, { unit: PIT_STOP_COUNT }));

describe('pit-stop-count', () => {
  it('is the quick analysis pit-stop-count: it reads the pit-stop records and car-status, at the cadence of cars.overview (C31, C41)', () => {
    expect(PIT_STOP_COUNT).toBe('pit-stop-count');
    expect(pitStopCountCalculator.id).toBe(PIT_STOP_COUNT);
    expect(pitStopCountCalculator.kind).toBe('quick');
    expect([...pitStopCountCalculator.reads].sort()).toEqual(['pitStops', 'spans:car-status']);
    expect(pitStopCountCalculator.cadence).toEqual({ hz: 10 });
  });

  it("counts each car's pit stops from the projection's pit-stop records", () => {
    const view = viewOf({
      now: [open(0, 'competing'), open(1, 'competing'), open(2, 'competing')],
      pitStops: [stop(0, 10), stop(1, 12), stop(0, 18)],
    });
    expect(compute(view)).toEqual({
      byCar: [
        { carId: carId(0), stops: 2 },
        { carId: carId(1), stops: 1 },
        { carId: carId(2), stops: 0 },
      ],
    });
  });

  it('lists a car without a stop with 0 stops, and a retired or disqualified car with its stops', () => {
    const view = viewOf({
      now: [open(0, 'competing'), open(1, 'retired'), open(2, 'disqualified')],
      pitStops: [stop(1, 5), stop(2, 7)],
    });
    expect(compute(view)).toEqual({
      byCar: [
        { carId: carId(0), stops: 0 },
        { carId: carId(1), stops: 1 },
        { carId: carId(2), stops: 1 },
      ],
    });
  });

  it('lists a car that turned absent with its stops, from its closed car-status span', () => {
    const view = viewOf({
      // car 3 competed, stopped once, then left the session: its competing span is closed, `absent` is open
      before: [closed(3, 'competing', 1, 400)],
      now: [open(0, 'competing'), open(3, 'absent', 1, 400)],
      pitStops: [stop(3, 2)],
    });
    expect(compute(view)).toEqual({
      byCar: [
        { carId: carId(0), stops: 0 },
        { carId: carId(3), stops: 1 },
      ],
    });
  });

  it('lists no slot that car-status has only ever had absent', () => {
    const view = viewOf({ now: [open(0, 'competing'), open(1, 'absent'), open(2, 'absent')] });
    expect(compute(view)).toEqual({ byCar: [{ carId: carId(0), stops: 0 }] });
  });

  it('orders the cars by car id, whatever the order of the spans and records', () => {
    const view = viewOf({
      now: [open(5, 'competing'), open(2, 'competing'), open(0, 'retired')],
      pitStops: [stop(5, 3), stop(2, 4), stop(5, 9)],
    });
    expect(compute(view).byCar.map((c) => c.carId)).toEqual([carId(0), carId(2), carId(5)]);
  });

  it('lists no car before car-status opened a span, even with a pit-stop record', () => {
    expect(compute(viewOf({ now: [], pitStops: [stop(0, 3)] }))).toEqual({ byCar: [] });
  });

  it('after a flashback that voids a stop, the count drops and equals a fresh run over the projection after the void (C33)', () => {
    const now = [open(0, 'competing'), open(1, 'competing')];
    const before = viewOf({ now, pitStops: [stop(0, 10), stop(0, 18), stop(1, 12)] });
    expect(compute(before).byCar).toEqual([
      { carId: carId(0), stops: 2 },
      { carId: carId(1), stops: 1 },
    ]);
    // the flashback goes back to lap 15: car 0's second stop never happened
    const kept = [stop(0, 10), stop(1, 12)];
    const after = viewOf({ now, pitStops: kept, delta: { before: { pitStops: 3 }, after: { pitStops: 2 }, rewound: { frameId: 1500, at: 1_350_000 } } });
    expect(compute(after).byCar).toEqual([
      { carId: carId(0), stops: 1 },
      { carId: carId(1), stops: 1 },
    ]);
    expect(compute(after)).toEqual(compute(viewOf({ now, pitStops: kept })));
  });
});
