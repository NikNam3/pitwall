// `tyre-model` "as of frame N" (SP4.3c spec §5.2, O1a; plan Task 12 row 8; C26, C28, C39): `tyreModelAsOf` over a
// projection whose lap records carry the game's tyre sets and carcass means (Task 9) equals the live output at the same
// frame, for every car whose live tyres are what its newest lap recorded (sets, wear, carcass, compound and age). A
// property over random generated sessions.
//
// The generator's laps carry no tyre sets (the builders leave them `notReceived`), so each lap here gets the sets its car
// had at the lap end: the fitted set (its compound, the lap's end wear), a fresh medium, a fresh hard and a used soft,
// each car its own usable life. The live view at frame N is the generator's with each car's tyres taken from its newest
// lap in the projection. The as-of view has no live sets (`setsNow` null, as a stored session's): the form must read the
// projection. A car whose newest lap is an in lap, or whose stint record ends on it (a set no recorded lap ran on yet),
// is left out: its live tyres are not its newest lap's.
import { carId, known, unknown, type Celsius, type CarId, type CarState, type FrameNumber, type LapRecord, type NoiseCompound, type StintRecord, type TyreSet } from '@pitwall/domain';
import { asOfNow, type AsOfView, type EngineView, type Projection } from '@pitwall/engine/readers';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { degradationCalculator } from '../../src/degradation/calculator.ts';
import { DEGRADATION } from '../../src/degradation/index.ts';
import { trackWetnessCalculator } from '../../src/track-wetness/calculator.ts';
import { TRACK_WETNESS } from '../../src/track-wetness/index.ts';
import { tyreModelAsOf, tyreModelCalculator } from '../../src/tyre-model/index.ts';
import { generateRace, GENERATOR_DEFAULTS, type GeneratorParams } from '../../../../test-support/race-generator/index.ts';
import { ACTUAL, tyreSet } from './support.ts';

/** A short race: six cars of the default field (four AI, the two humans) over 12 laps, one stop each on laps 5 to 7. */
const PARAMS: GeneratorParams = {
  ...GENERATOR_DEFAULTS,
  cars: 6,
  laps: 12,
  field: GENERATOR_DEFAULTS.field.slice(14).map((car, i) => ({ ...car, stops: [{ lap: 5 + (i % 3), compound: 'hard' as const }] })),
};

const isNoise = (c: string): c is NoiseCompound => ['soft', 'medium', 'hard', 'inter', 'wet'].includes(c);

/** The worst corner's end wear of a lap (0 when unknown). */
const worstEnd = (l: LapRecord): number => Math.max(...(['fl', 'fr', 'rl', 'rr'] as const).map((c) => (l.wearAtEndPct[c].known ? l.wearAtEndPct[c].value : 0)));

/** The sets car `car` had at the end of lap `l`: the fitted one first. */
function setsAt(l: LapRecord): TyreSet[] {
  const fitted = isNoise(l.visualCompound) ? l.visualCompound : 'medium';
  const life = 20 + l.carId;
  return [
    tyreSet(fitted, { fitted: true, wearPct: worstEnd(l), usableLifeLaps: life, lapDeltaMs: 0, actualCompound: l.actualCompound }),
    tyreSet('medium', { usableLifeLaps: life + 4, lapDeltaMs: -800 - 10 * l.lapNumber }),
    tyreSet('hard', { usableLifeLaps: life + 12, lapDeltaMs: 300 - 10 * l.lapNumber }),
    tyreSet('soft', { wearPct: 30, usableLifeLaps: life - 6, lapDeltaMs: 500 }),
  ];
}

/** The lap with the sets and carcass means its car had at its end (realism off: every car known, C8). */
const withTyres = (l: LapRecord): LapRecord => ({
  ...l,
  tyreSets: known(setsAt(l), l.completedAt),
  carcassMeanC: { fl: known((80 + l.carId) as Celsius, l.completedAt), fr: known((81 + l.carId) as Celsius, l.completedAt), rl: known((82 + l.carId) as Celsius, l.completedAt), rr: known((83 + l.carId) as Celsius, l.completedAt) },
});

/** Per car its newest lap's current record in `laps` (the confirmed one where both are there, C25). */
function newestByCar(laps: readonly LapRecord[]): Map<CarId, LapRecord> {
  const out = new Map<CarId, LapRecord>();
  for (const l of laps) {
    const had = out.get(l.carId);
    if (had === undefined || l.lapNumber > had.lapNumber || (l.lapNumber === had.lapNumber && l.status !== 'provisional')) out.set(l.carId, l);
  }
  return out;
}

/** The car with the tyres its newest lap recorded. */
function carFrom(car: CarState, l: LapRecord): CarState {
  const sets = setsAt(l);
  const corner = (c: 'fl' | 'fr' | 'rl' | 'rr') => ({ ...car.tyres.corners[c], wearPct: l.wearAtEndPct[c], carcassTempC: withTyres(l).carcassMeanC[c] });
  return {
    ...car,
    tyres: {
      ...car.tyres,
      actualCompound: l.actualCompound,
      visualCompound: l.visualCompound,
      age: l.tyreAgeAtStart + 1,
      corners: { fl: corner('fl'), fr: corner('fr'), rl: corner('rl'), rr: corner('rr') },
      sets: known({ sets, fittedIdx: 0 }, l.completedAt),
    },
  };
}

/** The cars compared at a frame: with a lap, the newest no in lap and no stint record ending on it. */
function comparable(history: Projection): CarId[] {
  const stints = history.stints as unknown as readonly StintRecord[];
  return [...newestByCar(history.laps as unknown as readonly LapRecord[])]
    .filter(([car, l]) => !l.inLap && !stints.some((s) => s.carId === car && s.lastLap >= l.lapNumber))
    .map(([car]) => car);
}

describe('tyre-model as of frame N (row 8)', () => {
  it('property: over random generated sessions, at every leader crossing frame, the as-of form equals the live output for every comparable car', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10_000 }), (seed) => {
        const { race } = generateRace(PARAMS, seed);
        let compared = 0;
        for (let n = 2; n <= race.laps; n++) {
          const frame = race.framesOfLap(n)[0] as FrameNumber | undefined;
          if (frame === undefined) continue;
          const base = race.viewAt(frame);
          const laps = (base.history.laps as unknown as readonly LapRecord[]).map(withTyres);
          const history: Projection = { ...(base.history as Projection), laps };
          const newest = newestByCar(laps);
          const cars = (base.live.cars as unknown as readonly CarState[]).map((c) => {
            const l = newest.get(c.id);
            return l === undefined ? c : carFrom(c, l);
          });
          const view: EngineView = { ...base, history, live: { ...base.live, cars } };
          const outputs = new Map<string, unknown>();
          outputs.set(DEGRADATION, degradationCalculator.compute({ ...view, outputs }));
          outputs.set(TRACK_WETNESS, trackWetnessCalculator.compute({ ...view, outputs }));
          const live = tyreModelCalculator.compute({ ...view, outputs });
          const now = asOfNow({ ...view, outputs });
          const asOfView: AsOfView = {
            history,
            situation: view.situation,
            frame,
            at: view.live.sessionTime,
            config: view.config,
            priors: view.priors,
            drivers: view.drivers,
            track: view.track,
            weekend: view.weekend,
            outputs,
            fixed: { ...now.fixed, setsNow: null, weatherNow: null },
          };
          const asOf = tyreModelAsOf(asOfView);
          for (const car of comparable(history)) {
            expect(asOf[car], `seed ${seed}, lap ${n}, car ${car}`).toEqual(live[car]);
            compared++;
          }
        }
        expect(compared, `seed ${seed}: cars compared`).toBeGreaterThan(0);
      }),
      { numRuns: 4 },
    );
  });

  it('a lap record whose sets realism hides gives no sets in the as-of form: the car\'s fresh sets unknown(realism)', () => {
    const { race } = generateRace(PARAMS, 3);
    const frame = race.framesOfLap(4)[0]!;
    const base = race.viewAt(frame);
    const hidden = (l: LapRecord): LapRecord => (l.carId === carId(1) ? { ...withTyres(l), tyreSets: unknown('realism') } : withTyres(l));
    const history: Projection = { ...(base.history as Projection), laps: (base.history.laps as unknown as readonly LapRecord[]).map(hidden) };
    const now = asOfNow(base);
    const out = tyreModelAsOf({
      history,
      situation: base.situation,
      frame,
      at: base.live.sessionTime,
      config: base.config,
      priors: base.priors,
      drivers: base.drivers,
      track: base.track,
      weekend: base.weekend,
      outputs: new Map(),
      fixed: { ...now.fixed, setsNow: null, weatherNow: null },
    });
    expect(out[carId(1)]?.freshSets.medium).toEqual(unknown('realism'));
    // a car whose sets the lap records hold: its fresh mediums and hards (the used soft is none)
    expect(out[carId(0)]?.freshSets.medium).toMatchObject({ known: true, value: 1 });
    expect(out[carId(0)]?.freshSets.soft).toMatchObject({ known: true, value: 0 });
    void ACTUAL;
  });
});
