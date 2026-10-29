import { describe, expect, it } from 'vitest';
import { carId, known, unknown, type CarState, type ChannelRange, type LapRecord } from '../../../domain/src/index.ts';
import { carBandsCalculator } from '../../src/car-bands/calculator.ts';
import { CAR_BANDS, CAR_BANDS_CONFIG, type CarBands } from '../../src/car-bands/index.ts';
import { carState, engineView, lap, realismHidden } from '../../../../test-support/builders/index.ts';

// The default bands (config.ts): dry surface 85-105, dry carcass 85-110, inter surface 60-90, inter carcass 55-75,
// pressure 20-31, brakes 300-1000, engine 0-125 (engineHi only; lo is pinned to 0). Soft is a dry compound.
const corners = ['fl', 'fr', 'rl', 'rr'] as const;
const withSurface = (c: number) =>
  carState({
    tyres: { corners: { fl: { surfaceTempC: known(c, 0) }, fr: { surfaceTempC: known(c, 0) }, rl: { surfaceTempC: known(c, 0) }, rr: { surfaceTempC: known(c, 0) } } },
  });
const bandsOf = (car: CarState, laps: LapRecord[] = [], opts: { config?: Record<string, object>; session?: object } = {}): CarBands => {
  const view = engineView({ cars: [car], history: { laps }, ...(opts.session && { session: opts.session }), ...(opts.config && { config: opts.config }) });
  const out = carBandsCalculator.compute(view);
  return out[car.id]!;
};
const perCorner = <T>(make: () => T) => ({ fl: make(), fr: make(), rl: make(), rr: make() });
const rangeOf = (over: Partial<ChannelRange>): ChannelRange => ({ ...lap().channelRange, ...over });
const surfaceRange = (min: number, max: number): ChannelRange['tyres'] =>
  perCorner(() => ({ surfaceC: known({ min, max }, 0), carcassC: known({ min: 90, max: 100 }, 0), pressurePsi: known({ min: 23, max: 27 }, 0) }));

describe('car-bands calculator', () => {
  it('is a quick calculator at 4 Hz that reads tyres, condition and laps', () => {
    expect(carBandsCalculator.id).toBe(CAR_BANDS);
    expect(carBandsCalculator.kind).toBe('quick');
    expect(carBandsCalculator.cadence).toEqual({ hz: 4 });
    expect(carBandsCalculator.reads).toEqual(expect.arrayContaining(['tyres', 'condition', 'laps']));
  });

  it('soft surface 104 °C is in band; 106 °C is above', () => {
    for (const [c, state] of [[104, 'in'], [106, 'above'], [80, 'below']] as const) {
      const bands = bandsOf(withSurface(c));
      for (const corner of corners) {
        const r = bands.tyres[corner].surfaceC;
        expect(r.value).toEqual(known(c, 0));
        expect(r.state).toMatchObject({ known: true, value: state });
        expect(r.band).toEqual({ lo: 85, hi: 105 });
      }
    }
  });

  it('the band comes from the config: an override moves it', () => {
    const car = withSurface(104);
    const key = CAR_BANDS_CONFIG.key;
    const bands = bandsOf(car, [], { config: { [key]: { surfaceDryHi: 100 } } });
    expect(bands.tyres.fl.surfaceC.band).toEqual({ lo: 85, hi: 100 });
    expect(bands.tyres.fl.surfaceC.state).toMatchObject({ known: true, value: 'above' });
  });

  it('carcass, pressure, brakes and engine each use their own band', () => {
    const car = carState({
      tyres: { corners: { fl: { carcassTempC: known(111, 0), pressurePsi: known(19, 0) } } },
      condition: { brakes: { rr: { tempC: known(1100, 0) } }, engineTempC: known(130, 0) },
    });
    const b = bandsOf(car);
    expect(b.tyres.fl.carcassC).toMatchObject({ band: { lo: 85, hi: 110 }, state: { known: true, value: 'above' } });
    expect(b.tyres.fl.pressurePsi).toMatchObject({ band: { lo: 20, hi: 31 }, state: { known: true, value: 'below' } });
    expect(b.tyres.fr.pressurePsi.state).toMatchObject({ known: true, value: 'in' });
    expect(b.brakesC.rr).toMatchObject({ band: { lo: 300, hi: 1000 }, state: { known: true, value: 'above' } });
    expect(b.brakesC.fl.state).toMatchObject({ known: true, value: 'in' });
    expect(b.engineC).toMatchObject({ band: { lo: 0, hi: 125 }, value: known(130, 0), state: { known: true, value: 'above' } });
  });

  it('inter tyres use the inter band; wet tyres use the wet band; slicks use the dry band', () => {
    const on = (visual: 'inter' | 'wet' | 'medium', actual: 'inter' | 'wet' | 'C2') =>
      bandsOf(carState({ tyres: { visualCompound: visual, actualCompound: actual } }));
    // the default 95 °C surface is in the dry band but above the inter band (60-90) and the wet band (50-80)
    const inter = on('inter', 'inter');
    expect(inter.tyres.fl.surfaceC).toMatchObject({ band: { lo: 60, hi: 90 }, state: { known: true, value: 'above' } });
    expect(inter.tyres.fl.carcassC.band).toEqual({ lo: 55, hi: 75 });
    const wet = on('wet', 'wet');
    expect(wet.tyres.fl.surfaceC.band).toEqual({ lo: 50, hi: 80 });
    expect(wet.tyres.fl.carcassC.band).toEqual({ lo: 45, hi: 65 });
    const dry = on('medium', 'C2');
    expect(dry.tyres.fl.surfaceC).toMatchObject({ band: { lo: 85, hi: 105 }, state: { known: true, value: 'in' } });
  });

  it('outForFullLap when the last lap\'s channelRange min is above the band; false when the min was inside', () => {
    const car = withSurface(104);
    const hot = lap({ lapNumber: 3, channelRange: rangeOf({ tyres: surfaceRange(106, 112) }) });
    const touched = lap({ lapNumber: 3, channelRange: rangeOf({ tyres: surfaceRange(104, 112) }) });
    expect(bandsOf(car, [hot]).tyres.rl.surfaceC.outForFullLap).toBe(true);
    expect(bandsOf(car, [touched]).tyres.rl.surfaceC.outForFullLap).toBe(false);
    // the live value is independent of the lap: in band now, but the lap was out
    expect(bandsOf(car, [hot]).tyres.rl.surfaceC.state).toMatchObject({ known: true, value: 'in' });
  });

  it('outForFullLap also holds when the whole range was below the band; a range that crosses the band is not out', () => {
    const car = withSurface(95);
    const cold = lap({ lapNumber: 2, channelRange: rangeOf({ tyres: surfaceRange(60, 80) }) });
    const crossing = lap({ lapNumber: 2, channelRange: rangeOf({ tyres: surfaceRange(60, 120) }) });
    expect(bandsOf(car, [cold]).tyres.fl.surfaceC.outForFullLap).toBe(true);
    expect(bandsOf(car, [crossing]).tyres.fl.surfaceC.outForFullLap).toBe(false);
  });

  it('outForFullLap reads the car\'s own last completed lap, ignoring other cars and earlier laps, and is false without a lap', () => {
    const car = withSurface(95);
    const hot = surfaceRange(106, 112);
    const laps = [
      lap({ lapNumber: 1, channelRange: rangeOf({ tyres: hot }) }),
      lap({ lapNumber: 2 }), // the last lap: back in band
      lap({ carId: carId(1), lapNumber: 3, channelRange: rangeOf({ tyres: hot }) }),
    ];
    expect(bandsOf(car, laps).tyres.fl.surfaceC.outForFullLap).toBe(false);
    expect(bandsOf(car, [laps[0]!]).tyres.fl.surfaceC.outForFullLap).toBe(true);
    expect(bandsOf(car, []).tyres.fl.surfaceC.outForFullLap).toBe(false);
  });

  it('outForFullLap covers brakes and engine, and an unknown range is not out', () => {
    const car = carState();
    const hotBrakes = lap({
      lapNumber: 2,
      channelRange: rangeOf({
        brakesC: { fl: known({ min: 1010, max: 1100 }, 0), fr: known({ min: 300, max: 800 }, 0), rl: unknown('notReceived'), rr: known({ min: 100, max: 200 }, 0) },
        engineC: known({ min: 126, max: 140 }, 0),
      }),
    });
    const b = bandsOf(car, [hotBrakes]);
    expect(b.brakesC.fl.outForFullLap).toBe(true);
    expect(b.brakesC.fr.outForFullLap).toBe(false);
    expect(b.brakesC.rl.outForFullLap).toBe(false);
    expect(b.brakesC.rr.outForFullLap).toBe(true);
    expect(b.engineC.outForFullLap).toBe(true);
  });

  it('carcass in surface-only mode is notApplicable', () => {
    const car = carState({
      tyres: { corners: perCorner(() => ({ carcassTempC: unknown('notApplicable') })) },
    });
    const b = bandsOf(car, [lap({ lapNumber: 2 })], { session: { settings: { tyreTemperature: 'surfaceOnly' } } });
    for (const corner of corners) {
      expect(b.tyres[corner].carcassC.value).toEqual(unknown('notApplicable'));
      expect(b.tyres[corner].carcassC.state).toEqual(unknown('notApplicable'));
      expect(b.tyres[corner].carcassC.outForFullLap).toBe(false);
      expect(b.tyres[corner].surfaceC.state).toMatchObject({ known: true, value: 'in' });
    }
  });

  it('a rival hidden by realism has unknown(\'realism\') values and states', () => {
    const rival = realismHidden(carState({ id: carId(1) }));
    const b = bandsOf(rival, [lap({ carId: carId(1), lapNumber: 2 })]);
    const hidden = { value: unknown('realism'), state: unknown('realism'), outForFullLap: false };
    for (const corner of corners) {
      for (const channel of ['surfaceC', 'carcassC', 'pressurePsi'] as const) expect(b.tyres[corner][channel]).toMatchObject(hidden);
      expect(b.brakesC[corner]).toMatchObject(hidden);
    }
    expect(b.engineC).toMatchObject(hidden);
    // the band is still given: it is config, not data
    expect(b.engineC.band).toEqual({ lo: 0, hi: 125 });
  });

  it('is stateless: the same view gives the same output twice', () => {
    const view = engineView({ cars: [withSurface(110)], history: { laps: [lap({ lapNumber: 2 })] } });
    expect(carBandsCalculator.compute(view)).toEqual(carBandsCalculator.compute(view));
  });
});
