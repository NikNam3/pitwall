// `car-bands` (spec 5.4): every band channel of every car in the session against its band. Stateless (ruling R1).
import { known, unknown, type SessionTime, type BandReading, type CarBands, type CarState, type Corners, type Known, type LapRecord, type Range } from '@pitwall/domain';
import type { DeepReadonly, EngineView, QuickCalculator } from '@pitwall/engine/readers';
import { behaviourFor } from '../shared/behaviour.ts';
import { CAR_STATUS_READS } from '../shared/car-status.ts';
import { bandsFor, judgedLapClasses, judgedLaps, pressureBands, stateOf, type Band } from './bands.ts';
import { CAR_BANDS_BEHAVIOUR, type CarBandsEffect } from './behaviour.ts';
import { CAR_BANDS, CAR_BANDS_CONFIG, type CarBandsOutput } from './index.ts';

/** The whole range of the judged lap lay on one side of the lap's band; an unknown range or band is not out. */
const outFor = (range: DeepReadonly<Known<Range>> | undefined, band: Known<Band>): boolean =>
  range !== undefined && range.known && band.known && (range.value.min > band.value.hi || range.value.max < band.value.lo);

/**
 * The live value against the live band; the judged lap's range (if the car has one) against the band of that lap. An
 * unknown band judges nothing: the live state carries the band's reason.
 */
const reading = (value: Known<number>, band: Known<Band>, range: DeepReadonly<Known<Range>> | undefined, lapBand: Known<Band>): BandReading => ({
  value,
  state: !band.known ? unknown(band.reason) : value.known ? { known: true, value: stateOf(value.value, band.value), at: value.at } : unknown(value.reason),
  band,
  outForFullLap: outFor(range, lapBand),
});

/**
 * A channel judged per lap only: the tyre surface swings 30–60 °C within a lap and the brakes fall below the band on
 * many straights, so a live state would flicker; only `outForFullLap` judges them.
 */
const lapOnlyReading = (value: Known<number>, band: Known<Band>, range: DeepReadonly<Known<Range>> | undefined, lapBand: Known<Band>): BandReading => ({
  ...reading(value, band, range, lapBand),
  state: unknown('notApplicable'),
});

/** One corner's pressure band, or the whole band's reason. */
const cornerOf = (bands: Known<Corners<Band>>, corner: keyof Corners<Band>): Known<Band> =>
  bands.known ? known(bands.value[corner], bands.at) : bands;

const bandsOfCar = (
  car: DeepReadonly<CarState>,
  judged: DeepReadonly<LapRecord> | undefined,
  c: ReturnType<typeof CAR_BANDS_CONFIG.read>,
  effect: CarBandsEffect,
  at: SessionTime,
): CarBands => {
  const b = bandsFor(car.tyres.visualCompound, c);
  // the judged lap is the evidence for a whole lap out of band, against the bands of the compound it was driven on
  const r = judged?.channelRange;
  const l = judged === undefined ? b : bandsFor(judged.visualCompound, c);
  // the pressure band is the car's setup, whatever the compound
  const pressure = pressureBands(car, c, at);
  // in the box the bands are off: every channel is judged per lap only
  const live = effect.bandsOff === true ? lapOnlyReading : reading;
  const fixed = (band: Band) => known(band, at);
  const tyre = (corner: 'fl' | 'fr' | 'rl' | 'rr') => ({
    surfaceC: lapOnlyReading(car.tyres.corners[corner].surfaceTempC, fixed(b.surface), r?.tyres[corner].surfaceC, fixed(l.surface)),
    carcassC: live(car.tyres.corners[corner].carcassTempC, fixed(b.carcass), r?.tyres[corner].carcassC, fixed(l.carcass)),
    pressurePsi: live(car.tyres.corners[corner].pressurePsi, cornerOf(pressure, corner), r?.tyres[corner].pressurePsi, cornerOf(pressure, corner)),
  });
  const brake = (corner: 'fl' | 'fr' | 'rl' | 'rr') => lapOnlyReading(car.condition.brakes[corner].tempC, fixed(b.brakes), r?.brakesC[corner], fixed(l.brakes));
  return {
    tyres: { fl: tyre('fl'), fr: tyre('fr'), rl: tyre('rl'), rr: tyre('rr') },
    brakesC: { fl: brake('fl'), fr: brake('fr'), rl: brake('rl'), rr: brake('rr') },
    engineC: live(car.condition.engineTempC, fixed(b.engine), r?.engineC, fixed(l.engine)),
  };
};

/**
 * Each car's channels against the bands, by its rows (`CAR_BANDS_BEHAVIOUR`); `outForFullLap` reads the car's judged
 * lap (`judgedLaps`: the newest rate lap that is not lap 1 of a race).
 */
export const carBandsCalculator: QuickCalculator<CarBandsOutput> = {
  id: CAR_BANDS,
  kind: 'quick',
  reads: ['tyres', 'condition', 'ownCar', 'laps', CAR_STATUS_READS, 'spans:car-activity-race', 'spans:weekend-phase'],
  cadence: { hz: 4 },
  compute(view: EngineView): CarBandsOutput {
    const config = CAR_BANDS_CONFIG.read(view);
    const judged = judgedLaps(view.history.laps, judgedLapClasses(view));
    const out: CarBandsOutput = {};
    for (const car of view.live.cars) {
      const effect: CarBandsEffect = Object.assign({}, ...behaviourFor(CAR_BANDS_BEHAVIOUR, view, car.id));
      if (effect.inSession === true) out[car.id] = bandsOfCar(car, judged.get(car.id), config, effect, view.live.sessionTime);
    }
    return out;
  },
};
