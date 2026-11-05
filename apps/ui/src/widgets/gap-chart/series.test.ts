import { describe, expect, it } from 'vitest';
import type { CarOverview, SessionInfo } from '@pitwall/contracts';
import { carId, known, toSessionTime, unknown } from '@pitwall/domain';
import type { GapperLines } from '@pitwall/domain';
import { ourCars } from '../../kit/car/our-cars.ts';
import { buildData, clipBands, visibleXRange } from '../../kit/chart/data.ts';
import { endLabels, endsEarly } from '../../kit/chart/labels.ts';
import { gapperReference, gapSeries, phaseBands, REFERENCE_KINDS } from './series.ts';
import { role } from '../../theme/index.ts';

type Phase = GapperLines['phases'][number];

/** A phase of the gapper, in the leader's progress; `to` undefined while it is open. */
const phase = (kind: Phase['kind'], from: number, to?: number): Phase => ({
  kind, fromLap: from, toLap: to === undefined ? unknown('notApplicable') : known(to, toSessionTime(0)),
});

const car = (id: number, name: string, teamId: number, raceNumber: number): CarOverview =>
  ({ id: carId(id), identity: { name, teamId, raceNumber } }) as unknown as CarOverview;

/** A car that just crossed the line (or has not crossed one since lights out): no live point. */
const NO_NOW = unknown('notApplicable');

const session = (playerCar: number, teammateCar?: number): SessionInfo =>
  ({ playerCar: carId(playerCar), ...(teammateCar === undefined ? {} : { teammateCar: carId(teammateCar) }) }) as unknown as SessionInfo;

describe('REFERENCE_KINDS', () => {
  it('lists the three gapper references, the default first', () => {
    expect(REFERENCE_KINDS).toEqual(['leaderAverage', 'carAverage', 'fixed']);
  });
});

describe('gapperReference', () => {
  it('is the leader average by default and for an unknown value', () => {
    expect(gapperReference({}, carId(3))).toEqual({ kind: 'leaderAverage' });
    expect(gapperReference({ reference: 'nonsense' }, carId(3))).toEqual({ kind: 'leaderAverage' });
  });

  it('is a car average of the chosen car', () => {
    expect(gapperReference({ reference: 'carAverage', referenceCar: carId(5) }, carId(3))).toEqual({ kind: 'carAverage', carId: carId(5) });
  });

  it('is a car average of the link primary when no car is chosen or the choice is player or teammate', () => {
    expect(gapperReference({ reference: 'carAverage' }, carId(3))).toEqual({ kind: 'carAverage', carId: carId(3) });
    expect(gapperReference({ reference: 'carAverage', referenceCar: 'player' }, carId(3))).toEqual({ kind: 'carAverage', carId: carId(3) });
  });

  it('is a fixed lap time converted from seconds to integer ms', () => {
    expect(gapperReference({ reference: 'fixed', fixedLapS: 91.234 }, carId(3))).toEqual({ kind: 'fixed', lapMs: 91_234 });
  });

  it('falls back to the leader average for a fixed reference without a usable time', () => {
    expect(gapperReference({ reference: 'fixed' }, carId(3))).toEqual({ kind: 'leaderAverage' });
    expect(gapperReference({ reference: 'fixed', fixedLapS: 0 }, carId(3))).toEqual({ kind: 'leaderAverage' });
  });
});

// The bands come from the gapper's phases (wave 2 T6, displays don't compute): already in the leader's progress, on the
// chart's x, so the display only maps them; an open phase reaches the right edge of the plot.
describe('phaseBands', () => {
  it("maps the kind and spans the phase's leader progress, part laps included", () => {
    expect(phaseBands([phase('SC', 4.3, 6.72), phase('VSC', 9.12, 9.5), phase('red', 12.2, 14)])).toEqual([
      { from: 4.3, to: 6.72, kind: 'sc' },
      { from: 9.12, to: 9.5, kind: 'vsc' },
      { from: 12.2, to: 14, kind: 'red' },
    ]);
  });

  it('runs an open phase to the right edge of the visible range', () => {
    expect(clipBands(phaseBands([phase('SC', 10.4)]), [2, 12.6])).toEqual([{ from: 10.4, to: 12.6, kind: 'sc' }]);
  });

  it('keeps a phase that starts and ends at the same progress (the field stood still under the red flag) as a band from there', () => {
    const [band] = phaseBands([phase('red', 9.2, 9.2)]);
    expect(band?.kind).toBe('red');
    expect(band?.from).toBe(9.2);
    expect(band!.to).toBeGreaterThan(9.2);
  });

  it('is empty without phases', () => {
    expect(phaseBands([])).toEqual([]);
  });
});

// The gap chart draws the window of `gaps.gapper` (Task 8, spec N3): one line per car of `cars` from its `points`
// (per mini-sector crossing, x = completed laps + segment / 50) plus `now` as the live end; `byLap` is no longer read.
// Ours in the ownCar role (the teammate dashed), every other car `textFaint`: no team colours. No y range in the series.
const pts = (...p: Array<[number, number]>) => p.map(([lap, gapMs]) => ({ lap, gapMs }));
const BYLAP_NOISE = [{ lap: 99, gapMs: 99_000 }];
const live = (lap: number, gapMs: number) => known({ lap, gapMs }, toSessionTime(0));

describe('gapSeries', () => {
  const cars = [car(0, 'Kuhnlein', 7, 44), car(1, 'Zhou', 7, 24), car(2, 'Max Verstappen', 2, 1), car(3, 'Lando Norris', 8, 4), car(4, 'Oscar Piastri', 8, 81)];
  const lines: GapperLines = {
    reference: { kind: 'leaderAverage', carId: unknown('notApplicable') },
    referenceLapMs: known(105_000, toSessionTime(0)),
    cars: [
      { carId: carId(2), byLap: BYLAP_NOISE, points: pts([1, 250], [1.02, 260], [2, 500]), now: NO_NOW },
      { carId: carId(0), byLap: BYLAP_NOISE, points: pts([1, 1000], [1.5, 1800], [2, 2500]), now: NO_NOW },
    ],
    phases: [],
  };
  const ours = ourCars(session(0, 1));

  it('makes one series per car of the window, in the order of the lines, labelled with the car code', () => {
    expect(gapSeries(lines, cars, ours).map((s) => s.label)).toEqual(['VER', 'KUH']);
  });

  it('plots every point of `points` (per mini-sector crossing): x as given, y = -gap / 1000; byLap is not drawn', () => {
    const [ver, kuh] = gapSeries(lines, cars, ours);
    expect(ver?.points).toEqual([[1, -0.25], [1.02, -0.26], [2, -0.5]]);
    expect(kuh?.points).toEqual([[1, -1], [1.5, -1.8], [2, -2.5]]);
  });

  it('draws only the cars of `cars`: a field car outside the window has no series', () => {
    expect(gapSeries(lines, cars, ours).map((s) => s.label)).not.toContain('NOR');
  });

  it('colours our car in the ownCar role and thick, every other car textFaint: no team colour', () => {
    const [ver, kuh] = gapSeries(lines, cars, ours);
    expect(kuh?.colour).toEqual({ colour: role('ownCar'), dashed: false, ownCar: true });
    expect(ver?.colour).toEqual({ colour: role('textFaint'), dashed: false, ownCar: false });
  });

  it('dashes only our teammate; rivals of one team are all the same plain textFaint', () => {
    const more: GapperLines = { ...lines, cars: [
      { carId: carId(1), byLap: [], points: pts([1, 100]), now: NO_NOW },
      { carId: carId(3), byLap: [], points: pts([1, 100]), now: NO_NOW },
      { carId: carId(4), byLap: [], points: pts([1, 100]), now: NO_NOW },
    ] };
    const [zho, nor, pia] = gapSeries(more, cars, ours);
    expect(zho?.colour).toEqual({ colour: role('ownCar'), dashed: true, ownCar: true });
    expect(nor?.colour).toEqual({ colour: role('textFaint'), dashed: false, ownCar: false });
    expect(pia?.colour).toEqual({ colour: role('textFaint'), dashed: false, ownCar: false });
  });

  it('draws a car without an identity in textFaint with an empty label, not an error', () => {
    const [s] = gapSeries({ ...lines, cars: [{ carId: carId(15), byLap: [], points: pts([1, 10]), now: NO_NOW }] }, cars, ours);
    expect(s?.label).toBe('');
    expect(s?.colour).toEqual({ colour: role('textFaint'), dashed: false, ownCar: false });
  });

  it('draws nothing of ours when there is no session (no car is ours)', () => {
    expect(gapSeries(lines, cars, ourCars(undefined)).map((s) => s.colour?.ownCar)).toEqual([false, false]);
  });

  it('keeps a car with one point and drops a car with neither a point nor a live end', () => {
    const short: GapperLines = { ...lines, cars: [
      { carId: carId(2), byLap: BYLAP_NOISE, points: pts([1, 0]), now: NO_NOW },
      { carId: carId(3), byLap: BYLAP_NOISE, points: [], now: NO_NOW },
    ] };
    const out = gapSeries(short, cars, ours);
    expect(out.map((s) => s.label)).toEqual(['VER']);
    expect(out[0]?.points).toHaveLength(1);
  });

  it('carries no y range: a series is label, points, colour and the live flag only', () => {
    for (const s of gapSeries(lines, cars, ours)) {
      expect(Object.keys(s).sort()).toEqual(['colour', 'label', 'points']);
    }
  });

  it('is empty when the reference is unknown and no car has data', () => {
    expect(gapSeries({ reference: { kind: 'leaderAverage', carId: unknown('notApplicable') }, referenceLapMs: unknown('insufficientData'), cars: [], phases: [] }, cars, ours)).toEqual([]);
  });
});

// The live point: each car's line runs solid through its crossings, then dotted to `now`, its gap at its newest
// mini-sector crossing. `ChartSeries.liveEnd === true` says the series' last point is live (the look is the kit's).
describe('gapSeries: the live point', () => {
  const cars = [car(0, 'Kuhnlein', 7, 44), car(1, 'Zhou', 7, 24), car(2, 'Max Verstappen', 2, 1), car(3, 'Lando Norris', 8, 4)];
  const ours = ourCars(session(0, 1));
  const lines: GapperLines = {
    reference: { kind: 'leaderAverage', carId: unknown('notApplicable') },
    referenceLapMs: known(105_000, toSessionTime(0)),
    cars: [
      { carId: carId(2), byLap: BYLAP_NOISE, points: pts([1, 250], [2, 500], [2.2, 600]), now: live(2.4, 700) },
      { carId: carId(0), byLap: BYLAP_NOISE, points: pts([1, 1000], [2, 2500]), now: live(2.3, 2900) },
      { carId: carId(3), byLap: BYLAP_NOISE, points: pts([1, -500], [2, -1500]), now: NO_NOW },
    ],
    phases: [],
  };
  const range = (series: ReturnType<typeof gapSeries>) => visibleXRange(buildData(series)[0] as number[], 50, 'lap', { lap: 0.25, sessionTime: 1000 });

  it("continues a car's line from its last point to now, as a live (dotted) last segment", () => {
    const [ver, kuh] = gapSeries(lines, cars, ours);
    expect(ver).toMatchObject({ label: 'VER', points: [[1, -0.25], [2, -0.5], [2.2, -0.6], [2.4, -0.7]], liveEnd: true });
    expect(kuh).toMatchObject({ label: 'KUH', points: [[1, -1], [2, -2.5], [2.3, -2.9]], liveEnd: true });
  });

  it('draws a car without a live point solid through its points only', () => {
    const nor = gapSeries(lines, cars, ours)[2];
    expect(nor?.points).toEqual([[1, 0.5], [2, 1.5]]);
    expect(nor).not.toMatchObject({ liveEnd: true });
  });

  it('the live segment is a series flag, not a colour', () => {
    const atTheLine: GapperLines = { ...lines, cars: lines.cars.map((c) => ({ ...c, now: NO_NOW })) };
    expect(gapSeries(lines, cars, ours).map((s) => s.colour)).toEqual(gapSeries(atTheLine, cars, ours).map((s) => s.colour));
  });

  it('the x-range ends at the newest live point', () => {
    expect(range(gapSeries(lines, cars, ours))[1]).toBe(2.4);
  });

  it("each car's end label sits at its live end", () => {
    const series = gapSeries(lines, cars, ours);
    expect(endLabels(series, range(series)).map((l) => [l.text, l.value])).toEqual([['VER', -0.7], ['KUH', -2.9], ['NOR', 1.5]]);
  });

  it("draws a retired car's line to its last point, named at its own end", () => {
    const longer: GapperLines = {
      ...lines,
      cars: [
        { carId: carId(2), byLap: [], points: pts(...[1, 2, 3, 4, 5].map((lap): [number, number] => [lap, 250 * lap])), now: live(5.4, 1400) },
        { carId: carId(3), byLap: [], points: pts([1, -500], [2, -1500]), now: NO_NOW },
      ],
    };
    const series = gapSeries(longer, cars, ours);
    const nor = series.find((x) => x.label === 'NOR');
    expect(nor).not.toMatchObject({ liveEnd: true });
    const visible = range(series);
    const label = endLabels(series, visible).find((l) => l.text === 'NOR')!;
    expect([label.x, label.value]).toEqual([2, 1.5]);
    expect(endsEarly(label, visible, 'lap')).toBe(true);
  });

  it('a safety car that ended mid-lap ends there, before the newest live point', () => {
    const series = gapSeries(lines, cars, ours);
    const visible = range(series);
    const [band] = clipBands(phaseBands([phase('SC', 1.3, 2.2)]), visible);
    expect(band).toEqual({ from: 1.3, to: 2.2, kind: 'sc' });
    expect(band!.to).toBeLessThan(visible[1]);
  });
});

// Lap 1: before any completed lap a car's line is just its live point.
describe('gapSeries: lap 1', () => {
  const cars = [car(0, 'Kuhnlein', 7, 44), car(2, 'Max Verstappen', 2, 1), car(3, 'Lando Norris', 8, 4)];
  const ours = ourCars(session(0));
  const lapOne: GapperLines = {
    reference: { kind: 'fixed', carId: unknown('notApplicable') },
    referenceLapMs: known(90_000, toSessionTime(0)),
    cars: [
      { carId: carId(2), byLap: [], points: [], now: live(0.42, 300) },
      { carId: carId(0), byLap: [], points: [], now: live(0.4, -1200) },
      { carId: carId(3), byLap: [], points: [], now: NO_NOW },
    ],
    phases: [],
  };

  it("starts a car's line at its live point while it has no point: the line is its live end", () => {
    const [ver, kuh] = gapSeries(lapOne, cars, ours);
    expect(ver).toMatchObject({ label: 'VER', points: [[0.42, -0.3]], liveEnd: true });
    expect(kuh).toMatchObject({ label: 'KUH', points: [[0.4, 1.2]], liveEnd: true });
  });

  it('drops a car that has neither a point nor a live point yet', () => {
    expect(gapSeries(lapOne, cars, ours).map((s) => s.label)).toEqual(['VER', 'KUH']);
  });
});
