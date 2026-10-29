// `car-bands` (spec 5.4): every band channel of every active car against its band. Stateless (ruling R1).
import { unknown, type BandReading, type CarBands, type CarState, type Known, type LapRecord, type Range } from '@pitwall/domain';
import type { DeepReadonly, EngineView, QuickCalculator } from '@pitwall/engine';
import { classifyLap } from '../lap-classes/index.ts';
import { bandsFor, lastLaps, stateOf, type Band } from './bands.ts';
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

const bandsOfCar = (
  car: DeepReadonly<CarState>,
  last: DeepReadonly<LapRecord> | undefined,
  c: ReturnType<typeof CAR_BANDS_CONFIG.read>,
  isRace: boolean,
): CarBands => {
  const b = bandsFor(car.tyres.visualCompound, c);
  // only a lap at racing speed is evidence for a whole lap out of band: no SC, VSC, in or out lap
  const counted = last !== undefined && classifyLap(last, { isRace }).forRate ? last : undefined;
  const r = counted?.channelRange;
  const l = counted === undefined ? b : bandsFor(counted.visualCompound, c);
  const tyre = (corner: 'fl' | 'fr' | 'rl' | 'rr') => ({
    surfaceC: reading(car.tyres.corners[corner].surfaceTempC, b.surface, r?.tyres[corner].surfaceC, l.surface),
    carcassC: reading(car.tyres.corners[corner].carcassTempC, b.carcass, r?.tyres[corner].carcassC, l.carcass),
    pressurePsi: reading(car.tyres.corners[corner].pressurePsi, b.pressure, r?.tyres[corner].pressurePsi, l.pressure),
  });
  const brake = (corner: 'fl' | 'fr' | 'rl' | 'rr') => reading(car.condition.brakes[corner].tempC, b.brakes, r?.brakesC[corner], l.brakes);
  return {
    tyres: { fl: tyre('fl'), fr: tyre('fr'), rl: tyre('rl'), rr: tyre('rr') },
    brakesC: { fl: brake('fl'), fr: brake('fr'), rl: brake('rl'), rr: brake('rr') },
    engineC: reading(car.condition.engineTempC, b.engine, r?.engineC, l.engine),
  };
};

/** Each active car's channels against the bands; `outForFullLap` reads the car's highest-numbered lap if it is a rate lap. */
export const carBandsCalculator: QuickCalculator<CarBandsOutput> = {
  id: CAR_BANDS,
  kind: 'quick',
  reads: ['tyres', 'condition', 'laps', 'session'],
  cadence: { hz: 4 },
  compute(view: EngineView): CarBandsOutput {
    const config = CAR_BANDS_CONFIG.read(view);
    const lastLap = lastLaps(view.state.history.laps);
    const isRace = view.state.session.kind === 'race';
    const out: CarBandsOutput = {};
    for (const car of view.state.cars) if (car.active) out[car.id] = bandsOfCar(car, lastLap.get(car.id), config, isRace);
    return out;
  },
};
