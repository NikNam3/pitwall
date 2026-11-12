// `tyre-life`'s priors (spec 3.2, 4.2, C62a): per compound and corner the wear per lap, with its aggregate over a
// source's stint and its `residual`; the set's limits are override-only. Stored sources and set entries are built here
// and passed explicitly (C84: no test reads the priors store or storage).
import { carId, known, unknown, type Corners, type LapRecord, type StintRecord } from '@pitwall/domain';
import type { PriorsCtx, StoredSource } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { TYRE_LIFE_PRIORS } from '../../src/tyre-life/index.ts';
import { history, lap } from '../../../../test-support/builders/index.ts';
import { RACE } from '../situated.ts';

const CTX: PriorsCtx = { config: {}, overrides: {} };
const COMPOUNDS = ['soft', 'medium', 'hard', 'inter', 'wet'] as const;
const CORNERS = ['fl', 'fr', 'rl', 'rr'] as const;

const entry = (key: string) => {
  const decl = TYRE_LIFE_PRIORS.entries[key];
  if (decl === undefined) throw new Error(`no entry ${key}`);
  return decl;
};

const corners = <T>(v: T): Corners<T> => ({ fl: v, fr: v, rl: v, rr: v });

/** Consecutive laps of car 0 on soft C3 from new, each gaining its `gains` entry of wear on every corner. */
const stintLaps = (gains: number[]): LapRecord[] => {
  let wear = 0;
  return gains.map((g, i) => {
    const at = (i + 1) * 90_000;
    const l = lap({ lapNumber: i + 1, tyreAgeAtStart: i, completedAt: at, wearAtStartPct: corners(known(wear, at)), wearAtEndPct: corners(known(wear + g, at)) });
    wear += g;
    return l;
  });
};

/** A stored source (C62a) of car 0: its stint's laps in a race; no track file. */
const storedSource = (laps: LapRecord[]): StoredSource => {
  const first = laps[0]!;
  const stint: StintRecord = {
    carId: carId(0),
    actualCompound: first.actualCompound,
    visualCompound: first.visualCompound,
    tyreAgeAtFitting: 0,
    firstLap: first.lapNumber,
    lastLap: laps.at(-1)!.lapNumber,
    frame: 0,
  };
  return {
    source: { sessionUid: '42', weekendId: 'w1', feedCar: carId(0), car: carId(0), firstLap: first.lapNumber, excludedLaps: [] },
    phase: RACE,
    aiDifficulty: unknown('notReceived'),
    projection: history(),
    stint,
    laps,
    pitStops: [],
    sessionLaps: laps,
    track: unknown('notApplicable'),
  };
};

describe('tyre-life priors', () => {
  it('declares the wear per lap of every compound and corner, and the two override-only limits without an aggregate', () => {
    const keys = Object.keys(TYRE_LIFE_PRIORS.entries);
    for (const c of COMPOUNDS) for (const corner of CORNERS) expect(keys).toContain(`tyreLife.wearPerLapPct.${c}.${corner}`);
    for (const key of ['tyreLife.wearLimitPct', 'tyreLife.ageLossLimitMs']) {
      expect(keys).toContain(key);
      expect(entry(key).aggregate, key).toBeUndefined();
    }
  });

  it('the wear-rate aggregate over one source is the calculator`s rate: gains 2, 2, 3, 2, 2 % give 2 %/lap on its compound, none on another', () => {
    const source = storedSource(stintLaps([2, 2, 3, 2, 2]));
    for (const corner of CORNERS) {
      const value = entry(`tyreLife.wearPerLapPct.soft.${corner}`).aggregate!([source], CTX);
      expect(value, corner).toMatchObject({ known: true, value: 2 });
    }
    expect(entry('tyreLife.wearPerLapPct.medium.fl').aggregate!([source], CTX)).toEqual(unknown('insufficientData'));
  });

  it('residual: the source`s wear rate minus the set`s; unknown without the source`s value', () => {
    const key = 'tyreLife.wearPerLapPct.soft.fl';
    const residual = entry(key).residual!({ [key]: known(2.5, 0) }, { [key]: known(2, 0) });
    if (!residual.known) throw new Error(`unknown: ${residual.reason}`);
    expect(residual.value).toBeCloseTo(0.5, 9);
    // each corner's entry compares its own key
    const rr = 'tyreLife.wearPerLapPct.soft.rr';
    expect(entry(rr).residual!({ [key]: known(2.5, 0), [rr]: known(1, 0) }, { [key]: known(2, 0), [rr]: known(1.5, 0) })).toMatchObject({ known: true, value: -0.5 });
    expect(entry(key).residual!({}, { [key]: known(2, 0) }).known).toBe(false);
  });
});
