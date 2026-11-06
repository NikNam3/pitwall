// `track-positions` (spec 6.1): the track map's geometry and every competing car on it, from the view's track file
// (`view.track`, C39), the live session and timing, and the open spans of car-status, car-location, car-flags and
// zone-flags (C20). A quick calculator (C31): it keeps nothing between frames, so both outputs are rebuilt on every frame.
//  - geometry: the file's outline, every turn's label at its apex (`pointAt`), the three sector starts (the line, the
//    session's sector 2 and sector 3 starts as lap fractions);
//  - cars: every competing car (behaviour table over car-status) at `pointAt(fractionOf(lapDistanceM))`; `ours` for the
//    player and the teammate; `inPit` in the pit lane, left out in the garage (car-location); `blueFlag` (car-flags);
//  - zones: one per open zone-flags span, from its start to the next zone's start, the last one past the line;
//  - no track file, or a file without an outline: both `notApplicable` (C3).
// Every row runs the calculator through its guarded view (C41); the generic tests cover the guarded view on the
// standard race and the behaviour table's completeness (C44).
import { carId, known, unknown, type CarId, type Known, type MapPoint, type OpenSpan, type TrackData } from '@pitwall/domain';
import type { DeepReadonly, EngineView } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { carState } from '../../../../test-support/builders/index.ts';
import { zandvoortTrack } from '../../../../test-support/track.ts';
import { fractionOf, pointAt } from '../../src/shared/track-lookup.ts';
import { TRACK_POSITIONS, trackPositionsCalculator, type MapCar, type TrackCars, type TrackGeometry } from '../../src/index.ts';
import { guardedQuick, openSpan, situatedView } from '../situated.ts';
import { CALCULATORS, loadUnitFolders } from '../units.ts';

/** The session's lap and sector starts, in the game's metres. */
const TRACK_M = 4000;
const SECTOR2_M = 1500;
const SECTOR3_M = 2800;

const TRACK = zandvoortTrack();
const OUTLINE = (TRACK.outline as Extract<Known<MapPoint[]>, { known: true }>).value;

/** The outline's mean step between neighbouring points: the scale "near the line" is measured in. */
const OUTLINE_STEP =
  OUTLINE.reduce((sum, p, i) => {
    const q = OUTLINE[(i + 1) % OUTLINE.length]!;
    return sum + Math.hypot(q.x - p.x, q.y - p.y);
  }, 0) / OUTLINE.length;

const calc = guardedQuick(trackPositionsCalculator);

/** A car at lap distance `d`, as the builder makes it (named `Car <id>`, race number `id + 1`). */
const carAt = (id: number, d: number) => carState({ id: carId(id), timing: { lapDistanceM: d } });

/** An open car-location span of car `car`. */
const location = (car: number, kind: 'garage' | 'pitLane' | 'track'): OpenSpan => openSpan('car-location', kind, { car });

/** An open car-flags span of car `car`. */
const carFlag = (car: number, kind: string): OpenSpan => openSpan('car-flags', kind, { car });

/** An open zone-flags span of marshal zone `zone`, which starts at `startFraction` of the lap. */
const zoneFlag = (zone: number, kind: string, startFraction: number): OpenSpan => ({ ...openSpan('zone-flags', kind, { detail: { startFraction } }), zone });

/**
 * A race view with the given track (default: Zandvoort), the session's lap and sector starts, the cars (each
 * `competing` unless `status` says otherwise) and the further open spans; `teammate` sets the live state's teammate.
 */
function viewOf(o: {
  cars?: ReturnType<typeof carState>[];
  status?: Record<number, string>;
  spans?: OpenSpan[];
  track?: EngineView['track'];
  trackLengthM?: number;
  playerCar?: number;
  teammate?: number;
} = {}): EngineView {
  const view = situatedView({
    cars: o.cars ?? [],
    status: o.status ?? {},
    spans: o.spans ?? [],
    track: o.track ?? known(TRACK, 0),
    session: { trackLengthM: o.trackLengthM ?? TRACK_M, sector2StartM: SECTOR2_M, sector3StartM: SECTOR3_M },
    playerCar: o.playerCar ?? 0,
  });
  if (o.teammate === undefined) return view;
  return { ...view, live: { ...view.live, teammateCar: carId(o.teammate) } as EngineView['live'] };
}

/** The value of a known output; fails the test when it is unknown. */
function valueOf<T>(k: Known<T>): T {
  expect(k.known, JSON.stringify(k)).toBe(true);
  return (k as Extract<Known<T>, { known: true }>).value;
}

const geometryOf = (view: EngineView): TrackGeometry => valueOf(calc.compute(view).geometry);
const carsOf = (view: EngineView): TrackCars => valueOf(calc.compute(view).cars);
const carOf = (cars: TrackCars, id: number): MapCar | undefined => cars.cars.find((c) => c.carId === (id as CarId));
const ids = (cars: TrackCars): number[] => cars.cars.map((c) => c.carId as number).sort((a, b) => a - b);

/** The point at lap distance `d` of the session's lap. */
const pointAtDistance = (d: number): MapPoint => pointAt(OUTLINE, fractionOf(d, TRACK_M)!);

describe('track-positions', () => {
  it('is the quick calculator track-positions: it reads the session, timing, identity and four sub-machines, every frame (C31, C41)', () => {
    expect(TRACK_POSITIONS).toBe('track-positions');
    expect(trackPositionsCalculator.id).toBe(TRACK_POSITIONS);
    expect(trackPositionsCalculator.kind).toBe('quick');
    expect([...trackPositionsCalculator.reads].sort()).toEqual(
      ['identity', 'session', 'spans:car-flags', 'spans:car-location', 'spans:car-status', 'spans:zone-flags', 'timing'].sort(),
    );
    expect(trackPositionsCalculator.cadence).toBe('frame');
  });

  it('geometry: the outline, every turn with its label at pointAt(apex), the three sector starts', () => {
    const turns = (TRACK.turns as Extract<DeepReadonly<TrackData>['turns'], { known: true }>).value;
    const geometry = geometryOf(viewOf());
    expect(geometry.outline).toEqual(OUTLINE);
    expect(geometry.turns).toEqual(turns.map((t) => ({ label: t.label, point: pointAt(OUTLINE, t.apex) })));
    expect(geometry.turns.length).toBeGreaterThan(0);
    expect(geometry.sectorStarts).toEqual([pointAt(OUTLINE, 0), pointAtDistance(SECTOR2_M), pointAtDistance(SECTOR3_M)]);
  });

  it('a competing car at lap distance d is at pointAt(fractionOf(d)); ours flagged for playerCar and teammateCar', () => {
    const cars = carsOf(
      viewOf({
        cars: [carAt(0, 100), carAt(1, 1234.5), carAt(3, 3999)],
        spans: [location(0, 'track'), location(1, 'track'), location(3, 'track')],
        playerCar: 0,
        teammate: 3,
      }),
    );
    expect(ids(cars)).toEqual([0, 1, 3]);
    expect(carOf(cars, 1)).toEqual({
      carId: carId(1),
      code: expect.any(String),
      teamId: carState({ id: carId(1) }).identity.teamId,
      raceNumber: 2,
      ours: false,
      point: pointAtDistance(1234.5),
      inPit: false,
      blueFlag: false,
    });
    expect(carOf(cars, 0)).toMatchObject({ ours: true, point: pointAtDistance(100) });
    expect(carOf(cars, 3)).toMatchObject({ ours: true, point: pointAtDistance(3999) });
  });

  it('a car at lap distance -10 is drawn near the line, just before it', () => {
    const cars = carsOf(viewOf({ cars: [carAt(0, -10)], spans: [location(0, 'track')] }));
    const point = carOf(cars, 0)?.point;
    expect(point).toBeDefined();
    const expected = pointAt(OUTLINE, 1 - 10 / TRACK_M);
    expect(point!.x).toBeCloseTo(expected.x, 9);
    expect(point!.y).toBeCloseTo(expected.y, 9);
    // 10 m of 4 km is 1.25 of the outline's 500 steps: within two steps of the line
    const line = pointAt(OUTLINE, 0);
    expect(Math.hypot(point!.x - line.x, point!.y - line.y)).toBeLessThan(2 * OUTLINE_STEP);
  });

  it('with trackLengthM 0 the car is left out', () => {
    const cars = carsOf(viewOf({ cars: [carAt(0, 500)], spans: [location(0, 'track')], trackLengthM: 0 }));
    expect(cars.cars).toEqual([]);
  });

  it('pitLane: inPit true; garage: left out; a retired, disqualified or absent car left out (behaviour table over car-status)', () => {
    const cars = carsOf(
      viewOf({
        cars: [carAt(0, 100), carAt(1, 200), carAt(2, 300), carAt(4, 400), carAt(5, 500), carAt(6, 600)],
        status: { 4: 'retired', 5: 'disqualified', 6: 'absent' },
        spans: [location(0, 'pitLane'), location(1, 'garage'), location(2, 'track'), location(4, 'track'), location(5, 'track'), location(6, 'track')],
      }),
    );
    // slot 3 and the idle slots have no car-status span: not in the session (C17)
    expect(ids(cars)).toEqual([0, 2]);
    expect(carOf(cars, 0)).toMatchObject({ inPit: true, point: pointAtDistance(100) });
    expect(carOf(cars, 2)).toMatchObject({ inPit: false, point: pointAtDistance(300) });
  });

  it('a car with an open blue car-flags span has blueFlag true', () => {
    const cars = carsOf(
      viewOf({
        cars: [carAt(0, 100), carAt(1, 200), carAt(2, 300)],
        spans: [location(0, 'track'), location(1, 'track'), location(2, 'track'), carFlag(0, 'blue'), carFlag(1, 'noFlag'), carFlag(2, 'yellow')],
      }),
    );
    expect([...cars.cars].sort((a, b) => a.carId - b.carId).map((c) => [c.carId, c.blueFlag])).toEqual([
      [0, true],
      [1, false],
      [2, false],
    ]);
  });

  it('two zones at startFraction 0.1 and 0.6: zones [0.1, 0.6) and [0.6, 1.1), each with its span kind', () => {
    const cars = carsOf(viewOf({ spans: [zoneFlag(0, 'yellow', 0.1), zoneFlag(1, 'green', 0.6)] }));
    expect(cars.zones).toHaveLength(2);
    expect(cars.zones[0]).toEqual({ start: 0.1, end: 0.6, flag: 'yellow' });
    expect(cars.zones[1]!.start).toBe(0.6);
    expect(cars.zones[1]!.end).toBeCloseTo(1.1, 12);
    expect(cars.zones[1]!.flag).toBe('green');
  });

  it('no track file: both topics notApplicable; a file whose outline is unknown: both notApplicable', () => {
    const car = { cars: [carAt(0, 100)], spans: [location(0, 'track'), zoneFlag(0, 'green', 0.1)] };
    expect(calc.compute(viewOf({ ...car, track: unknown('notApplicable') }))).toEqual({
      geometry: unknown('notApplicable'),
      cars: unknown('notApplicable'),
    });
    // the committed Azerbaijan file has no outline: `notReceived`
    const noOutline: TrackData = { ...TRACK, outline: unknown('notReceived') };
    expect(calc.compute(viewOf({ ...car, track: known(noOutline, 0) }))).toEqual({
      geometry: unknown('notApplicable'),
      cars: unknown('notApplicable'),
    });
  });

  it('is covered by the generic guarded-view (C41) and behaviour-table completeness (C44) tests', async () => {
    expect(CALCULATORS.map((c) => c.id)).toContain(TRACK_POSITIONS);
    const folder = (await loadUnitFolders()).find((f) => f.unit === TRACK_POSITIONS);
    expect(folder?.table).toBeDefined();
    expect(Object.keys(folder!.table!).sort()).toEqual(['car-flags', 'car-location', 'car-status', 'zone-flags']);
  });
});

