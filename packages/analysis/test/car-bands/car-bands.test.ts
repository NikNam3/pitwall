import { describe, expect, it } from 'vitest';
import { carId, known, unknown, type CarState, type ChannelRange, type LapRecord } from '../../../domain/src/index.ts';
import type { EngineView } from '@pitwall/engine';
import type { OpenSpan } from '../../../domain/src/index.ts';
import { carBandsCalculator } from '../../src/car-bands/calculator.ts';
import { CAR_BANDS, CAR_BANDS_BEHAVIOUR, CAR_BANDS_CONFIG, type CarBands } from '../../src/car-bands/index.ts';
import { carState, lap, realismHidden } from '../../../../test-support/builders/index.ts';
import { guardedQuick, openSpan, situatedView } from '../situated.ts';

/** The calculator through its guarded view (C41): every case fails on a read it does not declare. */
const calc = guardedQuick(carBandsCalculator);

// Every case runs on TEST_BANDS, a fixed config (the defaults before 2026-10-30), so no case depends on the defaults;
// only 'the default bands' pins those. Soft is a dry compound. The engine band's lo is pinned to 0 (engineHi only).
// The tyre surface and the brakes have no live state (rulings 2026-10-30: the surface swings 30-60 °C within a lap, the
// brakes fall below the band on many straights); only outForFullLap judges them.
const TEST_BANDS = {
  surfaceDryLo: 85, surfaceDryHi: 105, surfaceInterLo: 60, surfaceInterHi: 90, surfaceWetLo: 50, surfaceWetHi: 80,
  carcassDryLo: 85, carcassDryHi: 110, carcassInterLo: 55, carcassInterHi: 75, carcassWetLo: 45, carcassWetHi: 65,
  pressureLo: 20, pressureHi: 31, brakeLo: 300, brakeHi: 1000, engineHi: 125,
};
const NO_LIVE_STATE = unknown('notApplicable');
const corners = ['fl', 'fr', 'rl', 'rr'] as const;
const withSurface = (c: number) =>
  carState({
    tyres: { corners: { fl: { surfaceTempC: known(c, 0) }, fr: { surfaceTempC: known(c, 0) }, rl: { surfaceTempC: known(c, 0) }, rr: { surfaceTempC: known(c, 0) } } },
  });
const bandsOf = (
  car: CarState,
  laps: LapRecord[] = [],
  opts: { config?: EngineView['config']; session?: object; status?: string; spans?: OpenSpan[] } = {},
): CarBands => {
  const config = opts.config ?? { [CAR_BANDS_CONFIG.key]: TEST_BANDS };
  const view = situatedView({
    cars: [car],
    history: { laps },
    config,
    ...(opts.session && { session: opts.session }),
    ...(opts.status && { status: { [car.id]: opts.status } }),
    ...(opts.spans && { spans: opts.spans }),
  });
  const out = calc.compute(view);
  return out[car.id]!;
};
const perCorner = <T>(make: () => T) => ({ fl: make(), fr: make(), rl: make(), rr: make() });
const withBrakes = (c: number) => carState({ condition: { brakes: perCorner(() => ({ tempC: known(c, 0) })) } });
const rangeOf = (over: Partial<ChannelRange>): ChannelRange => ({ ...lap().channelRange, ...over });
const surfaceRange = (min: number, max: number): ChannelRange['tyres'] =>
  perCorner(() => ({ surfaceC: known({ min, max }, 0), carcassC: known({ min: 90, max: 100 }, 0), pressurePsi: known({ min: 23, max: 27 }, 0) }));

describe('car-bands calculator', () => {
  it('is a quick calculator at 4 Hz that reads tyres, condition, laps, car-status and the race activity, not the session', () => {
    expect(carBandsCalculator.id).toBe(CAR_BANDS);
    expect(carBandsCalculator.kind).toBe('quick');
    expect(carBandsCalculator.cadence).toEqual({ hz: 4 });
    expect(carBandsCalculator.reads).toEqual(expect.arrayContaining(['tyres', 'condition', 'laps', 'spans:car-status', 'spans:car-activity-race']));
    expect(carBandsCalculator.reads).not.toContain('session');
  });

  it('the default bands: dry, inter and wet tyre bands; one band each for pressure, brakes and engine', () => {
    const on = (visual: 'inter' | 'wet' | 'medium', actual: 'inter' | 'wet' | 'C2') =>
      bandsOf(carState({ tyres: { visualCompound: visual, actualCompound: actual } }), [], { config: {} });
    const tyreBands = (b: CarBands) => [b.tyres.fl.surfaceC.band, b.tyres.fl.carcassC.band];
    expect(tyreBands(on('medium', 'C2'))).toEqual([{ lo: 55, hi: 100 }, { lo: 75, hi: 110 }]);
    expect(tyreBands(on('inter', 'inter'))).toEqual([{ lo: 30, hi: 85 }, { lo: 55, hi: 95 }]);
    expect(tyreBands(on('wet', 'wet'))).toEqual([{ lo: 50, hi: 80 }, { lo: 45, hi: 65 }]);
    const dry = on('medium', 'C2');
    expect([dry.tyres.fl.pressurePsi.band, dry.brakesC.fl.band, dry.engineC.band]).toEqual([{ lo: 20, hi: 31 }, { lo: 300, hi: 1000 }, { lo: 0, hi: 135 }]);
  });

  it('the surface has no live state: notApplicable on every corner whether its value is in, above or below the band; value and band stay', () => {
    for (const c of [95, 106, 80]) {
      const bands = bandsOf(withSurface(c));
      for (const corner of corners) {
        expect(bands.tyres[corner].surfaceC).toEqual({ value: known(c, 0), state: NO_LIVE_STATE, band: { lo: 85, hi: 105 }, outForFullLap: false });
      }
    }
  });

  it('the brakes have no live state: notApplicable on every corner whether their value is in, above or below the band; value and band stay', () => {
    for (const c of [650, 1100, 278]) {
      const bands = bandsOf(withBrakes(c));
      for (const corner of corners) {
        expect(bands.brakesC[corner]).toEqual({ value: known(c, 0), state: NO_LIVE_STATE, band: { lo: 300, hi: 1000 }, outForFullLap: false });
      }
    }
  });

  it('a brake in band now whose last lap was out for the whole lap: outForFullLap, still no live state', () => {
    const cold = lap({ lapNumber: 3, channelRange: rangeOf({ brakesC: perCorner(() => known({ min: 150, max: 290 }, 0)) }) });
    const b = bandsOf(withBrakes(650), [cold]);
    for (const corner of corners) {
      expect(b.brakesC[corner]).toEqual({ value: known(650, 0), state: NO_LIVE_STATE, band: { lo: 300, hi: 1000 }, outForFullLap: true });
    }
  });

  it('only the surface and the brakes lose their live state: carcass, pressure and engine out of band read it live on every corner', () => {
    const car = carState({
      tyres: { corners: perCorner(() => ({ surfaceTempC: known(120, 0), carcassTempC: known(120, 0), pressurePsi: known(32, 0) })) },
      condition: { brakes: perCorner(() => ({ tempC: known(1100, 0) })), engineTempC: known(130, 0) },
    });
    const b = bandsOf(car, [lap({ lapNumber: 2 })]);
    const above = { known: true, value: 'above' };
    for (const corner of corners) {
      expect([b.tyres[corner].surfaceC.state, b.brakesC[corner].state]).toEqual([NO_LIVE_STATE, NO_LIVE_STATE]);
      expect([b.tyres[corner].carcassC.state, b.tyres[corner].pressurePsi.state]).toMatchObject([above, above]);
    }
    expect(b.engineC.state).toMatchObject(above);
  });

  it('the band comes from the config: an override moves it, field by field over the defaults', () => {
    const d = CAR_BANDS_CONFIG.defaults;
    const bands = bandsOf(carState(), [], { config: { [CAR_BANDS_CONFIG.key]: { surfaceDryHi: 120, carcassDryHi: 90 } } });
    expect(bands.tyres.fl.surfaceC.band).toEqual({ lo: d.surfaceDryLo, hi: 120 });
    // the builder's carcass is 95 °C: above the moved band
    expect(bands.tyres.fl.carcassC).toMatchObject({ band: { lo: d.carcassDryLo, hi: 90 }, state: { known: true, value: 'above' } });
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
    expect(b.brakesC.rr).toMatchObject({ band: { lo: 300, hi: 1000 }, value: known(1100, 0) });
    expect(b.engineC).toMatchObject({ band: { lo: 0, hi: 125 }, value: known(130, 0), state: { known: true, value: 'above' } });
  });

  it('inter tyres use the inter band; wet tyres use the wet band; slicks use the dry band', () => {
    const on = (visual: 'inter' | 'wet' | 'medium', actual: 'inter' | 'wet' | 'C2') =>
      bandsOf(carState({ tyres: { visualCompound: visual, actualCompound: actual } }));
    // the builder's 95 °C carcass is in the dry band (85-110) but above the inter band (55-75) and the wet band (45-65)
    const inter = on('inter', 'inter');
    expect(inter.tyres.fl.surfaceC.band).toEqual({ lo: 60, hi: 90 });
    expect(inter.tyres.fl.carcassC).toMatchObject({ band: { lo: 55, hi: 75 }, state: { known: true, value: 'above' } });
    const wet = on('wet', 'wet');
    expect(wet.tyres.fl.surfaceC.band).toEqual({ lo: 50, hi: 80 });
    expect(wet.tyres.fl.carcassC).toMatchObject({ band: { lo: 45, hi: 65 }, state: { known: true, value: 'above' } });
    const dry = on('medium', 'C2');
    expect(dry.tyres.fl.surfaceC.band).toEqual({ lo: 85, hi: 105 });
    expect(dry.tyres.fl.carcassC).toMatchObject({ band: { lo: 85, hi: 110 }, state: { known: true, value: 'in' } });
  });

  it('outForFullLap when the last lap\'s channelRange min is above the band; false when the min was inside', () => {
    const car = withSurface(104);
    const hot = lap({ lapNumber: 3, channelRange: rangeOf({ tyres: surfaceRange(106, 112) }) });
    const touched = lap({ lapNumber: 3, channelRange: rangeOf({ tyres: surfaceRange(104, 112) }) });
    expect(bandsOf(car, [hot]).tyres.rl.surfaceC.outForFullLap).toBe(true);
    expect(bandsOf(car, [touched]).tyres.rl.surfaceC.outForFullLap).toBe(false);
    // the lap is the surface's only judgement: no live state beside it
    expect(bandsOf(car, [hot]).tyres.rl.surfaceC.state).toEqual(NO_LIVE_STATE);
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

  it('an SC, VSC, in or out lap is no full-lap evidence: outForFullLap stays false', () => {
    const car = withSurface(95);
    const cold = rangeOf({ tyres: surfaceRange(60, 80) });
    for (const over of [{ scShare: 1 }, { vscShare: 0.5 }, { inLap: true }, { outLap: true }]) {
      expect(bandsOf(car, [lap({ lapNumber: 4, channelRange: cold, ...over })]).tyres.fl.surfaceC.outForFullLap).toBe(false);
    }
  });

  it('outForFullLap judges the lap against the band of the compound it was driven on, not the one fitted now', () => {
    // the last lap on inters at 65-80 °C (inside the inter band 60-90); now on softs (dry band 85-105)
    const car = withSurface(95);
    const onInters = lap({ lapNumber: 4, visualCompound: 'inter', actualCompound: 'inter', channelRange: rangeOf({ tyres: surfaceRange(65, 80) }) });
    const b = bandsOf(car, [onInters]).tyres.fl.surfaceC;
    expect(b.outForFullLap).toBe(false);
    // the live reading and its band stay those of the fitted compound
    expect(b.band).toEqual({ lo: 85, hi: 105 });
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
      expect(b.tyres[corner].surfaceC.value).toEqual(known(95, 0));
    }
  });

  it('a rival hidden by realism has unknown(\'realism\') values and live states; the surface and the brakes still have no live state', () => {
    const rival = realismHidden(carState({ id: carId(1) }));
    const b = bandsOf(rival, [lap({ carId: carId(1), lapNumber: 2 })]);
    const hidden = { value: unknown('realism'), state: unknown('realism'), outForFullLap: false };
    for (const corner of corners) {
      for (const channel of ['carcassC', 'pressurePsi'] as const) expect(b.tyres[corner][channel]).toMatchObject(hidden);
      expect(b.tyres[corner].surfaceC).toMatchObject({ ...hidden, state: NO_LIVE_STATE });
      expect(b.brakesC[corner]).toMatchObject({ ...hidden, state: NO_LIVE_STATE });
    }
    expect(b.engineC).toMatchObject(hidden);
    // the band is still given: it is config, not data
    expect(b.engineC.band).toEqual({ lo: 0, hi: 125 });
  });

  it('is stateless: the same view gives the same output twice', () => {
    const view = situatedView({ cars: [withSurface(110)], history: { laps: [lap({ lapNumber: 2 })] }, config: { [CAR_BANDS_CONFIG.key]: TEST_BANDS } });
    expect(calc.compute(view)).toEqual(calc.compute(view));
  });

  describe('behaviour table (C44): a row per car-status and race-activity kind', () => {
    it('exports CAR_BANDS_BEHAVIOUR over car-status and the race activity', () => {
      expect(Object.keys(CAR_BANDS_BEHAVIOUR).sort()).toEqual(['car-activity-race', 'car-status']);
    });

    // carcass, pressure and engine above their bands now; the last lap a rate lap whose carcass was above the band all lap
    const hot = carState({
      tyres: { corners: perCorner(() => ({ carcassTempC: known(120, 0), pressurePsi: known(32, 0) })) },
      condition: { engineTempC: known(130, 0) },
    });
    const hotLap = lap({
      lapNumber: 2,
      channelRange: rangeOf({
        tyres: perCorner(() => ({ surfaceC: known({ min: 90, max: 100 }, 0), carcassC: known({ min: 115, max: 125 }, 0), pressurePsi: known({ min: 23, max: 27 }, 0) })),
      }),
    });
    const above = { known: true, value: 'above', at: 0 };
    const activity = (kind: string) => [openSpan('car-activity-race', kind, { car: 0 })];

    for (const kind of ['racingLap', 'inLap', 'servingPenalty', 'outLap', 'finished', 'coolDown', 'notCompeting']) {
      it(`race activity ${kind}: carcass, pressure and engine have their live state; the last lap is judged`, () => {
        const b = bandsOf(hot, [hotLap], { spans: activity(kind) });
        for (const corner of corners) {
          expect([b.tyres[corner].carcassC.state, b.tyres[corner].pressurePsi.state]).toEqual([above, above]);
          expect(b.tyres[corner].carcassC.outForFullLap).toBe(true);
        }
        expect(b.engineC.state).toEqual(above);
      });
    }

    it('race activity boxStop: the bands are off, every live state notApplicable; values, bands and the last lap`s judgement stay', () => {
      const b = bandsOf(hot, [hotLap], { spans: activity('boxStop') });
      for (const corner of corners) {
        for (const channel of ['surfaceC', 'carcassC', 'pressurePsi'] as const) expect(b.tyres[corner][channel].state).toEqual(NO_LIVE_STATE);
        expect(b.brakesC[corner].state).toEqual(NO_LIVE_STATE);
        expect(b.tyres[corner].carcassC).toMatchObject({ value: known(120, 0), band: { lo: 85, hi: 110 }, outForFullLap: true });
        expect(b.tyres[corner].pressurePsi).toMatchObject({ value: known(32, 0), band: { lo: 20, hi: 31 } });
      }
      expect(b.engineC).toEqual({ value: known(130, 0), state: NO_LIVE_STATE, band: { lo: 0, hi: 125 }, outForFullLap: false });
    });

    it('only the car in its box stop is off: another car racing reads its live state', () => {
      const other = { ...hot, id: carId(1) };
      const view = situatedView({
        cars: [hot, other],
        history: { laps: [hotLap] },
        config: { [CAR_BANDS_CONFIG.key]: TEST_BANDS },
        spans: [openSpan('car-activity-race', 'boxStop', { car: 0 }), openSpan('car-activity-race', 'racingLap', { car: 1 })],
      });
      const out = calc.compute(view);
      expect(out[carId(0)]!.engineC.state).toEqual(NO_LIVE_STATE);
      expect(out[carId(1)]!.engineC.state).toEqual(above);
    });

    // the live state's transitional `active` says the opposite of car-status in every case, so only car-status decides (C43)
    const statusOut = (kind: string, active: boolean) =>
      calc.compute(situatedView({ cars: [{ ...hot, active }], config: { [CAR_BANDS_CONFIG.key]: TEST_BANDS }, status: { 0: kind } }))[carId(0)];

    it('car-status competing: the car has its bands', () => {
      expect(statusOut('competing', false)?.engineC.state).toEqual(above);
    });

    it('car-status retired: the car is still in the session and keeps its bands', () => {
      expect(statusOut('retired', false)?.engineC.state).toEqual(above);
    });

    it('car-status disqualified: the car is still in the session and keeps its bands', () => {
      expect(statusOut('disqualified', false)?.engineC.state).toEqual(above);
    });

    it('car-status absent: no entry, though the live state calls the slot active', () => {
      expect(statusOut('absent', true)).toBeUndefined();
    });
  });
});
