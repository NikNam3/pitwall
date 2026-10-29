import { describe, expect, it } from 'vitest';
import type { CarOverview, SessionInfo } from '@pitwall/contracts';
import { carId, known, toSessionTime, unknown } from '@pitwall/domain';
import type { FlagPhase, GapperLines } from '@pitwall/domain';
import { gapperReference, gapSeries, ownCarIds, phaseBands, phasesFold, REFERENCE_KINDS } from './series.ts';

const phase = (over: Partial<FlagPhase> = {}): FlagPhase => ({
  kind: 'SC', start: toSessionTime(0), end: toSessionTime(60_000), startLeaderLap: 5, endLeaderLap: 7, scPhases: [], ...over,
});

const car = (id: number, name: string, teamId: number, raceNumber: number): CarOverview =>
  ({ id: carId(id), identity: { name, teamId, raceNumber } }) as unknown as CarOverview;

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

describe('phasesFold', () => {
  it('starts empty', () => {
    expect(phasesFold.init()).toEqual([]);
  });

  it('appends phases ordered by start', () => {
    const late = phase({ start: toSessionTime(500_000) });
    const early = phase({ start: toSessionTime(100_000) });
    expect(phasesFold.add(phasesFold.add([], [late]), [early])).toEqual([early, late]);
  });

  it('replaces a phase that arrives again with the same start (it ended or grew)', () => {
    const open = phase({ endLeaderLap: 6 });
    const closed = phase({ endLeaderLap: 8 });
    expect(phasesFold.add([open], [closed])).toEqual([closed]);
  });

  it('does not mutate the accumulator', () => {
    const acc = [phase()];
    phasesFold.add(acc, [phase({ start: toSessionTime(9) })]);
    expect(acc).toHaveLength(1);
  });
});

describe('phaseBands', () => {
  it('maps the kind and spans the leader laps', () => {
    expect(phaseBands([phase({ kind: 'SC' }), phase({ kind: 'VSC', startLeaderLap: 9, endLeaderLap: 10 }), phase({ kind: 'red', startLeaderLap: 12, endLeaderLap: 14 })])).toEqual([
      { from: 5, to: 7, kind: 'sc' },
      { from: 9, to: 10, kind: 'vsc' },
      { from: 12, to: 14, kind: 'red' },
    ]);
  });

  it('gives a phase inside one lap a band one lap wide, so it is not clipped away', () => {
    expect(phaseBands([phase({ startLeaderLap: 9, endLeaderLap: 9 })])).toEqual([{ from: 9, to: 10, kind: 'sc' }]);
  });

  it('is empty without phases', () => {
    expect(phaseBands([])).toEqual([]);
  });
});

describe('ownCarIds', () => {
  it('is empty without a session', () => {
    expect([...ownCarIds(undefined)]).toEqual([]);
  });

  it('is the player first, then the teammate', () => {
    expect([...ownCarIds(session(4, 9))]).toEqual([4, 9]);
  });

  it('is the player alone without a teammate', () => {
    expect([...ownCarIds(session(4))]).toEqual([4]);
  });
});

describe('gapSeries', () => {
  const cars = [car(0, 'Kuhnlein', 7, 44), car(1, 'Zhou', 7, 24), car(2, 'Max Verstappen', 2, 1), car(3, 'Lando Norris', 8, 4), car(4, 'Oscar Piastri', 8, 81)];
  const lines: GapperLines = {
    referenceLapMs: known(105_000, toSessionTime(0)),
    cars: [
      { carId: carId(2), byLap: [{ lap: 1, gapMs: 250 }, { lap: 2, gapMs: 500 }] },
      { carId: carId(0), byLap: [{ lap: 1, gapMs: 1000 }, { lap: 2, gapMs: 2500 }] },
    ],
  };
  const ours = ownCarIds(session(0, 1));

  it('makes one series per car, in the order of the lines, labelled with the car code', () => {
    expect(gapSeries(lines, cars, ours).map((s) => s.label)).toEqual(['VER', 'KUH']);
  });

  it('plots lap against seconds ahead of the reference: a car losing time drops (y = -gap / 1000)', () => {
    const [ver, kuh] = gapSeries(lines, cars, ours);
    expect(ver?.points).toEqual([[1, -0.25], [2, -0.5]]);
    expect(kuh?.points).toEqual([[1, -1], [2, -2.5]]);
  });

  it('colours our cars white and thick (ownCar), the others by team', () => {
    const [ver, kuh] = gapSeries(lines, cars, ours);
    expect(kuh?.colour).toMatchObject({ ownCar: true, dashed: false });
    expect(ver?.colour).toMatchObject({ ownCar: false, dashed: false });
    expect(ver?.colour?.colour).toBe('#cfb2ff');
  });

  it('dashes the teammate and a team\'s second car', () => {
    const more: GapperLines = { ...lines, cars: [
      { carId: carId(1), byLap: [{ lap: 1, gapMs: 100 }] },
      { carId: carId(3), byLap: [{ lap: 1, gapMs: 100 }] },
      { carId: carId(4), byLap: [{ lap: 1, gapMs: 100 }] },
    ] };
    const [zho, nor, pia] = gapSeries(more, cars, ours);
    expect(zho?.colour).toMatchObject({ ownCar: true, dashed: true });
    expect(nor?.colour?.dashed).toBe(false);
    expect(pia?.colour?.dashed).toBe(true);
  });

  it('labels a car without an identity #<id> and draws it in the dim colour, not an error', () => {
    const [s] = gapSeries({ ...lines, cars: [{ carId: carId(15), byLap: [{ lap: 1, gapMs: 10 }] }] }, cars, ours);
    expect(s?.label).toBe('#15');
    expect(s?.colour).toMatchObject({ ownCar: false, dashed: false });
  });

  it('keeps a retired or lapped car as a shorter line and drops a car without any lap', () => {
    const short: GapperLines = { ...lines, cars: [{ carId: carId(2), byLap: [{ lap: 1, gapMs: 0 }] }, { carId: carId(3), byLap: [] }] };
    const out = gapSeries(short, cars, ours);
    expect(out.map((s) => s.label)).toEqual(['VER']);
    expect(out[0]?.points).toHaveLength(1);
  });

  it('is empty when the reference is unknown and no car has data', () => {
    expect(gapSeries({ referenceLapMs: unknown('insufficientData'), cars: [] }, cars, ours)).toEqual([]);
  });
});
