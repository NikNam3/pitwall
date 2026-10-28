import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addLaps, carId, currentLaps, emptyCurrentLaps, unknown, type LapRecord } from '../src/index.ts';

const lap = (car: number, lapNumber: number, status: LapRecord['status'], lapTimeMs = 70_000): LapRecord => ({
  carId: carId(car),
  lapNumber,
  lapTimeMs,
  sectorTimesMs: [20_000, 25_000, lapTimeMs - 45_000],
  valid: { lap: true, sectors: [true, true, true] },
  actualCompound: 'C4',
  visualCompound: 'soft',
  tyreAgeAtStart: 0,
  fuelAtStartKg: unknown('notReceived'),
  fuelAtEndKg: unknown('notReceived'),
  scShare: 0,
  vscShare: 0,
  inLap: false,
  outLap: false,
  positionAtEnd: 1,
  status,
  completedAt: lapNumber * 70_000,
});

describe('addLaps', () => {
  it('a confirmed record replaces the provisional one of the same car and lap', () => {
    const current = addLaps(emptyCurrentLaps(), [lap(0, 1, 'provisional', 70_100), lap(0, 1, 'confirmed', 70_000)]);
    expect(current[0]?.[1]).toMatchObject({ status: 'confirmed', lapTimeMs: 70_000 });
  });

  it('a provisional record never replaces a confirmed one', () => {
    const current = addLaps(emptyCurrentLaps(), [lap(0, 1, 'confirmed', 70_000), lap(0, 1, 'provisional', 70_100)]);
    expect(current[0]?.[1]).toMatchObject({ status: 'confirmed', lapTimeMs: 70_000 });
  });

  it('a later provisional replaces an earlier provisional; a later confirmed replaces an earlier confirmed', () => {
    const p = addLaps(emptyCurrentLaps(), [lap(0, 1, 'provisional', 70_100), lap(0, 1, 'provisional', 70_200)]);
    expect(p[0]?.[1]?.lapTimeMs).toBe(70_200);
    const c = addLaps(emptyCurrentLaps(), [lap(0, 1, 'confirmed', 70_000), lap(0, 1, 'confirmed', 69_900)]);
    expect(c[0]?.[1]?.lapTimeMs).toBe(69_900);
  });

  it('keeps the laps of different cars and lap numbers apart', () => {
    const current = addLaps(emptyCurrentLaps(), [lap(0, 1, 'confirmed', 1), lap(3, 1, 'provisional', 2), lap(3, 2, 'confirmed', 3)]);
    expect(current[0]?.[1]?.lapTimeMs).toBe(1);
    expect(current[3]?.[1]?.lapTimeMs).toBe(2);
    expect(current[3]?.[2]?.lapTimeMs).toBe(3);
    expect(current[0]?.[2]).toBeUndefined();
  });

  it('mutates and returns the given collection, and starts empty', () => {
    const current = emptyCurrentLaps();
    expect(current).toEqual([]);
    expect(addLaps(current, [lap(1, 1, 'confirmed')])).toBe(current);
    expect(current[1]?.[1]).toBeDefined();
  });

  it('a lap that only ever had a confirmed record is current', () => {
    const only = lap(2, 7, 'confirmed');
    expect(addLaps(emptyCurrentLaps(), [only])[2]?.[7]).toBe(only);
  });

  it('adding nothing changes nothing', () => {
    const only = lap(0, 1, 'confirmed');
    const current = addLaps(emptyCurrentLaps(), [only]);
    expect(addLaps(current, [])[0]?.[1]).toBe(only);
  });
});

describe('currentLaps', () => {
  it('has the current record of every car and lap, sorted by car id then lap number', () => {
    const laps = [
      lap(2, 2, 'provisional'),
      lap(0, 2, 'provisional', 71_000),
      lap(2, 1, 'confirmed'),
      lap(0, 1, 'provisional', 70_100),
      lap(0, 2, 'confirmed', 70_900),
      lap(0, 1, 'confirmed', 70_000),
      lap(2, 2, 'confirmed'),
      lap(1, 1, 'provisional'),
    ];
    const result = currentLaps(laps);
    expect(result.map((l) => [l.carId, l.lapNumber, l.status])).toEqual([
      [0, 1, 'confirmed'],
      [0, 2, 'confirmed'],
      [1, 1, 'provisional'],
      [2, 1, 'confirmed'],
      [2, 2, 'confirmed'],
    ]);
    expect(result[0]?.lapTimeMs).toBe(70_000);
    expect(result[1]?.lapTimeMs).toBe(70_900);
  });

  it('laps that only ever had a confirmed record are returned as they are', () => {
    const a = lap(0, 3, 'confirmed');
    const b = lap(0, 1, 'confirmed');
    expect(currentLaps([a, b])).toEqual([b, a]);
  });

  it('is empty for no laps and does not change its input', () => {
    expect(currentLaps([])).toEqual([]);
    const laps = [lap(1, 2, 'confirmed'), lap(0, 1, 'provisional'), lap(0, 1, 'confirmed')];
    const copy = structuredClone(laps);
    currentLaps(laps);
    expect(laps).toEqual(copy);
  });
});

const arbLap: fc.Arbitrary<LapRecord> = fc
  .record({
    car: fc.integer({ min: 0, max: 21 }),
    lapNumber: fc.integer({ min: 1, max: 6 }),
    status: fc.constantFrom('provisional', 'confirmed'),
    lapTimeMs: fc.integer({ min: 60_000, max: 120_000 }),
  })
  .map((r) => lap(r.car, r.lapNumber, r.status, r.lapTimeMs));

/** Cuts a list at the given fractions into consecutive chunks (empty chunks allowed). */
const splitAt = <T>(items: readonly T[], cuts: readonly number[]): T[][] => {
  const points = [0, ...cuts.map((c) => Math.floor(c * items.length)).sort((a, b) => a - b), items.length];
  return points.slice(1).map((end, i) => items.slice(points[i], end));
};

describe('addLaps and currentLaps (properties)', () => {
  it('addLaps over any split into chunks equals addLaps over the whole list', () => {
    fc.assert(
      fc.property(fc.array(arbLap, { maxLength: 60 }), fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { maxLength: 6 }), (laps, cuts) => {
        const whole = addLaps(emptyCurrentLaps(), laps);
        const chunked = splitAt(laps, cuts).reduce((acc, chunk) => addLaps(acc, chunk), emptyCurrentLaps());
        expect(chunked).toEqual(whole);
      }),
    );
  });

  it('currentLaps agrees with addLaps: same records, sorted by car id then lap number, a confirmed record whenever one exists', () => {
    fc.assert(
      fc.property(fc.array(arbLap, { maxLength: 60 }), (laps) => {
        const result = currentLaps(laps);
        const viaAdd = addLaps(emptyCurrentLaps(), laps);
        const expected = viaAdd.flatMap((perCar) => Object.keys(perCar ?? {}).map(Number).sort((a, b) => a - b).map((n) => perCar![n]!));
        expect(result).toEqual(expected);
        const keys = result.map((l) => [l.carId, l.lapNumber] as const);
        expect(keys).toEqual([...keys].sort((a, b) => a[0] - b[0] || a[1] - b[1]));
        expect(new Set(keys.map(([c, n]) => `${c}/${n}`)).size).toBe(result.length);
        for (const l of result) {
          const hasConfirmed = laps.some((x) => x.carId === l.carId && x.lapNumber === l.lapNumber && x.status === 'confirmed');
          expect(l.status === 'confirmed').toBe(hasConfirmed);
        }
      }),
    );
  });
});
