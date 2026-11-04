// `car-bands` (spec 5.4): every band channel of every car in the session against its band. Stateless (ruling R1).
import { unknown, type BandReading, type CarBands, type CarState, type Known, type LapRecord, type Range } from '@pitwall/domain';
import type { DeepReadonly, EngineView, QuickCalculator } from '@pitwall/engine/readers';
import { classifyLap, LAP_CLASSES_CONFIG, type LapClassOptions } from '../lap-classes/index.ts';
import { behaviourFor } from '../shared/behaviour.ts';
import { CAR_STATUS_READS } from '../shared/car-status.ts';
import { bandsFor, lastLaps, stateOf, type Band } from './bands.ts';
import { CAR_BANDS_BEHAVIOUR, type CarBandsEffect } from './behaviour.ts';
import { CAR_BANDS, CAR_BANDS_CONFIG, type CarBandsOutput } from './index.ts';

/** The whole range of the last lap lay on one side of the lap's band; an unknown range is not out. */
const outFor = (range: DeepReadonly<Known<Range>> | undefined, { lo, hi }: Band): boolean =>
  range !== undefined && range.known && (range.value.min > hi || range.value.max < lo);

/** The live value against the live band; the last lap's range (if it counts) against the band of that lap's compound. */
const reading = (value: Known<number>, band: Band, range: DeepReadonly<Known<Range>> | undefined, lapBand: Band): BandReading => ({
  value,
  state: value.known ? { known: true, value: stateOf(value.value, band), at: value.at } : unknown(value.reason),
  band,
  outForFullLap: outFor(range, lapBand),
});

/**
 * A channel judged per lap only: the tyre surface swings 30–60 °C within a lap and the brakes fall below the band on
 * many straights, so a live state would flicker; only `outForFullLap` judges them.
 */
const lapOnlyReading = (value: Known<number>, band: Band, range: DeepReadonly<Known<Range>> | undefined, lapBand: Band): BandReading => ({
  ...reading(value, band, range, lapBand),
  state: unknown('notApplicable'),
});

const bandsOfCar = (
  car: DeepReadonly<CarState>,
  last: DeepReadonly<LapRecord> | undefined,
  c: ReturnType<typeof CAR_BANDS_CONFIG.read>,
  classes: LapClassOptions,
  effect: CarBandsEffect,
): CarBands => {
  const b = bandsFor(car.tyres.visualCompound, c);
  // only a lap at racing speed is evidence for a whole lap out of band: a rate lap (no in or out lap, at most a flag lag of SC or VSC)
  const counted = last !== undefined && classifyLap(last, classes).forRate ? last : undefined;
  const r = counted?.channelRange;
  const l = counted === undefined ? b : bandsFor(counted.visualCompound, c);
  // in the box the bands are off: every channel is judged per lap only
  const live = effect.bandsOff === true ? lapOnlyReading : reading;
  const tyre = (corner: 'fl' | 'fr' | 'rl' | 'rr') => ({
    surfaceC: lapOnlyReading(car.tyres.corners[corner].surfaceTempC, b.surface, r?.tyres[corner].surfaceC, l.surface),
    carcassC: live(car.tyres.corners[corner].carcassTempC, b.carcass, r?.tyres[corner].carcassC, l.carcass),
    pressurePsi: live(car.tyres.corners[corner].pressurePsi, b.pressure, r?.tyres[corner].pressurePsi, l.pressure),
  });
  const brake = (corner: 'fl' | 'fr' | 'rl' | 'rr') => lapOnlyReading(car.condition.brakes[corner].tempC, b.brakes, r?.brakesC[corner], l.brakes);
  return {
    tyres: { fl: tyre('fl'), fr: tyre('fr'), rl: tyre('rl'), rr: tyre('rr') },
    brakesC: { fl: brake('fl'), fr: brake('fr'), rl: brake('rl'), rr: brake('rr') },
    engineC: live(car.condition.engineTempC, b.engine, r?.engineC, l.engine),
  };
};

/**
 * Each car's channels against the bands, by its rows (`CAR_BANDS_BEHAVIOUR`); `outForFullLap` reads the car's
 * highest-numbered lap if it is a rate lap.
 */
export const carBandsCalculator: QuickCalculator<CarBandsOutput> = {
  id: CAR_BANDS,
  kind: 'quick',
  reads: ['tyres', 'condition', 'laps', CAR_STATUS_READS, 'spans:car-activity-race'],
  cadence: { hz: 4 },
  compute(view: EngineView): CarBandsOutput {
    const config = CAR_BANDS_CONFIG.read(view);
    const lastLap = lastLaps(view.history.laps);
    // only `forRate` is read, and a rate lap has no lap-1 rule: the weekend phase changes nothing here
    const classes = { isRace: false, ...LAP_CLASSES_CONFIG.read(view) };
    const out: CarBandsOutput = {};
    for (const car of view.live.cars) {
      const effect: CarBandsEffect = Object.assign({}, ...behaviourFor(CAR_BANDS_BEHAVIOUR, view, car.id));
      if (effect.inSession === true) out[car.id] = bandsOfCar(car, lastLap.get(car.id), config, classes, effect);
    }
    return out;
  },
};
