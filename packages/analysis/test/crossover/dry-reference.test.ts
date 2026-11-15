// `crossover` reads its dry reference from `track-wetness` (SP4.3c Task 14 row 3, O3, B3; C43): one dry reference, so
// `crossover`'s `dryRefMs` is `track-wetness`'s and its 110 % line is `line110` (its config) times it, rounded (C4), at
// every frame (its own `dryRefOf` is deleted). Builder races (the race generator): a dry race that turns wet on slicks,
// and one whose field boxes for inters; every frame of a few laps around the change. `track-wetness`'s output is the
// one the scheduler hands over at the frame (computed here at the same frame, with `degradation`'s), as is `pit-loss`'s.
import type { Crossover, Known, Ms, TrackWetness } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine/readers';
import { beforeAll, describe, expect, it } from 'vitest';
import { generateRace, GENERATOR_DEFAULTS, type GeneratorCar, type GeneratorParams } from '../../../../test-support/race-generator/index.ts';
import type { BuilderRace } from '../../../../test-support/builders/long-race.ts';
import { crossoverCalculator } from '../../src/crossover/calculator.ts';
import { CROSSOVER_CONFIG, type CrossoverOutput } from '../../src/crossover/index.ts';
import { degradationCalculator } from '../../src/degradation/calculator.ts';
import { DEGRADATION } from '../../src/degradation/index.ts';
import { pitLossCalculator } from '../../src/pit-loss/calculator.ts';
import { PIT_LOSS } from '../../src/pit-loss/index.ts';
import { trackWetnessCalculator } from '../../src/track-wetness/calculator.ts';
import { TRACK_WETNESS } from '../../src/track-wetness/index.ts';
import { guardedQuick } from '../situated.ts';

const crossover = guardedQuick(crossoverCalculator);

const aiCar = (paceMs: number, over: Partial<GeneratorCar> = {}): GeneratorCar => ({
  paceMs,
  human: false,
  sigmaMs: 200,
  rho: 0.3,
  mistakeRate: 0.02,
  mistakeMedianMs: 1_500,
  mistakeSigmaLog: 0.6,
  wearFactor: 1,
  stops: [],
  startCompound: 'medium',
  ...over,
});
const field = (over: (i: number) => Partial<GeneratorCar> = () => ({})): GeneratorCar[] => Array.from({ length: 8 }, (_, i) => aiCar(90_000 + 150 * i, over(i)));
const params = (cars: GeneratorCar[], over: Partial<GeneratorParams>): GeneratorParams => ({ ...GENERATOR_DEFAULTS, cars: cars.length, field: cars, ...over });

/** Crossover and track-wetness at `frame`: the outputs they read computed at the same frame. */
function atFrame(race: BuilderRace, frame: number): { crossover: CrossoverOutput; wetness: TrackWetness } {
  const base = race.viewAt(frame);
  const degradation = degradationCalculator.compute(base);
  const wetness = trackWetnessCalculator.compute(race.viewAt(frame, { outputs: new Map([[DEGRADATION, degradation]]) }));
  const pitLoss = pitLossCalculator.compute(base);
  const outputs = new Map<string, unknown>([
    [DEGRADATION, degradation],
    [TRACK_WETNESS, wetness],
    [PIT_LOSS, pitLoss],
  ]);
  const view = race.viewAt(frame, { outputs: outputs as EngineView['outputs'] });
  return { crossover: crossover.compute(view), wetness };
}

/** The 110 % line of a dry reference: `line110` times it, rounded, known since it. */
const line110Of = (ref: Known<Ms>): Known<Ms> => (ref.known ? { known: true, value: Math.round(ref.value * CROSSOVER_CONFIG.defaults.line110), at: ref.at } : ref);

/** Slicks throughout, rain from lap 20 (4 s on every lap). */
let midRace: BuilderRace;
/** Dry on mediums to lap 16, every car in on lap 16 for inters, rain from lap 17. */
let toInters: BuilderRace;

beforeAll(() => {
  midRace = generateRace(params(field(), { laps: 24, rain: { fromLap: 20, wetnessMs: 4_000 } }), 9).race;
  toInters = generateRace(params(field(() => ({ stops: [{ lap: 16, compound: 'inter' }] })), { laps: 20, rain: { fromLap: 17, wetnessMs: 5_000 } }), 9).race;
});

describe('crossover: the dry reference and the 110 % line are track-wetness`s (row 3, B3)', () => {
  const cases: { name: string; race: () => BuilderRace; laps: number[] }[] = [
    { name: 'a race that turns wet on slicks', race: () => midRace, laps: [3, 19, 20, 21] },
    { name: 'a field that boxes for inters', race: () => toInters, laps: [15, 16, 17, 18] },
  ];
  for (const c of cases) {
    it(`${c.name}: at every frame of laps ${c.laps.join(', ')}`, () => {
      const race = c.race();
      let knownFrames = 0;
      for (const n of c.laps) {
        for (const frame of race.framesOfLap(n)) {
          const { crossover: out, wetness } = atFrame(race, frame);
          const cars = Object.values(out) as Crossover[];
          expect(cars.length, `frame ${frame}`).toBeGreaterThan(0);
          for (const car of cars) {
            expect(car.dryRefMs, `frame ${frame}`).toEqual(wetness.dryRefMs);
            expect(car.line110Ms, `frame ${frame}`).toEqual(line110Of(wetness.dryRefMs));
          }
          if (wetness.dryRefMs.known) knownFrames++;
        }
      }
      expect(knownFrames).toBeGreaterThan(0);
    });
  }
});
