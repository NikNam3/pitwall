// `tyre-model`'s driver-profile entries (SP4.3c spec §5.2 "Driver profiles", C62c, C84): per compound the wear factor k
// of a human, `tyreModel.wearFactor.<compound>` (replacing `driverNoise.wearRatePct.*`): the human's measured rate
// against the game's 70 / usableLife, scale-free across race distances (research 21 §13, 22 §1.3). Ported from
// `driver-noise`'s row 10 (its wear assertion): stored sessions are generated races passed explicitly (C84), their laps
// given the sets the game sends (Task 9's `tyreSets`).
import { known, type LapRecord, type NoiseCompound } from '@pitwall/domain';
import type { ProfileCtx, StoredDriverSession } from '@pitwall/engine/readers';
import { beforeAll, describe, expect, it } from 'vitest';
import { DRIVER_NOISE_PROFILES } from '../../src/driver-noise/profiles.ts';
import { TYRE_MODEL_PROFILES } from '../../src/tyre-model/index.ts';
import type { BuilderRace } from '../../../../test-support/builders/long-race.ts';
import { generateRace, GENERATOR_DEFAULTS, type GeneratorCar } from '../../../../test-support/race-generator/index.ts';
import { storedSession } from '../driver-noise/support.ts';
import { tyreSet, valueOf, wearFactorKey } from './support.ts';

const CTX: ProfileCtx = { config: {}, overrides: {} };

/** The 4-car field of driver-noise's row 10, car 3 a human, on mediums all race (the generator wears them 2 % a lap). */
const storedField = (sigmaMs: number): GeneratorCar[] =>
  Array.from({ length: 4 }, (_, i) => ({
    ...GENERATOR_DEFAULTS.field[0]!,
    paceMs: 90_000 + 400 * i,
    human: i === 3,
    sigmaMs: i === 3 ? sigmaMs : 200,
    rho: 0.3,
    wearFactor: 1,
    stops: [],
    startCompound: 'medium' as const,
  }));

/** The session with every lap carrying the car's sets: a fitted medium of usable life `usableLifeLaps`. */
function withSets(session: StoredDriverSession, usableLifeLaps: number): StoredDriverSession {
  const laps = (session.projection.laps as readonly LapRecord[]).map((l) => ({ ...l, tyreSets: known([tyreSet('medium', { fitted: true, usableLifeLaps })], l.completedAt) }));
  return { ...session, projection: { ...session.projection, laps } };
}

let races: BuilderRace[];
beforeAll(() => {
  races = [
    generateRace({ ...GENERATOR_DEFAULTS, cars: 4, laps: 12, field: storedField(900) }, 21).race,
    generateRace({ ...GENERATOR_DEFAULTS, cars: 4, laps: 20, field: storedField(450) }, 22).race,
  ];
});

const entry = (compound: NoiseCompound) => {
  const decl = TYRE_MODEL_PROFILES.entries[wearFactorKey(compound)];
  if (decl === undefined) throw new Error(`${wearFactorKey(compound)} is declared`);
  return decl;
};

describe('tyre-model profile entries (C62c)', () => {
  it('declares tyreModel.wearFactor.<compound> for every compound; driver-noise no longer declares a wear entry', () => {
    for (const c of ['soft', 'medium', 'hard', 'inter', 'wet'] as const) expect(TYRE_MODEL_PROFILES.entries[wearFactorKey(c)], c).toBeDefined();
    expect(Object.keys(DRIVER_NOISE_PROFILES.entries).filter((k) => k.includes('wear'))).toEqual([]);
  });

  it('k = the human`s measured rate / (70 / usableLife): 2 %/lap on sets of 35 laps → 1.0; of 28 laps → 0.8; weighted by laps', () => {
    const sessions35 = races.map((race, i) => withSets(storedSession(race, 3, `${100 + i}`), 35));
    const k35 = entry('medium').aggregate(sessions35, CTX);
    expect(valueOf(k35.value)).toBeCloseTo(1, 2);
    expect(k35.laps).toBeGreaterThan(0);
    const sessions28 = races.map((race, i) => withSets(storedSession(race, 3, `${100 + i}`), 28));
    expect(valueOf(entry('medium').aggregate(sessions28, CTX).value)).toBeCloseTo(0.8, 2);
  });

  it('a compound the human never ran, or sessions without the game`s sets: insufficientData (C3: never 0)', () => {
    const sessions = races.map((race, i) => withSets(storedSession(race, 3, `${100 + i}`), 35));
    expect(entry('hard').aggregate(sessions, CTX).value).toMatchObject({ known: false, reason: 'insufficientData' });
    const bare = races.map((race, i) => storedSession(race, 3, `${100 + i}`));
    expect(entry('medium').aggregate(bare, CTX).value).toMatchObject({ known: false });
  });
});
