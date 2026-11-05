import { describe, expect, it } from 'vitest';
import { carId, known, unknown, type CarState, type ChannelRange, type LapRecord } from '../../../domain/src/index.ts';
import type { EngineView } from '@pitwall/engine';
import type { OpenSpan, WeekendPhase } from '../../../domain/src/index.ts';
import { carBandsCalculator } from '../../src/car-bands/calculator.ts';
import { CAR_BANDS, CAR_BANDS_BEHAVIOUR, CAR_BANDS_CONFIG, type CarBands } from '../../src/car-bands/index.ts';
import { carState, lap, realismHidden } from '../../../../test-support/builders/index.ts';
import { guardedQuick, openSpan, PRACTICE, situatedView } from '../situated.ts';
import { withOwnCar, withSetup } from '../own-car.ts';

/** The calculator through its guarded view (C41): every case fails on a read it does not declare. */
const calc = guardedQuick(carBandsCalculator);

// Every case runs on TEST_BANDS, a fixed config (the defaults before 2026-10-30), so no case depends on the defaults;
// only 'the default bands' pins those. Soft is a dry compound. The engine band's lo is pinned to 0 (engineHi only).
// The pressure band follows the player's setup (Q3 A, Q5 A): setup - 1.5 psi to setup + 1.0 psi; a car `withSetup(c, 25)`
// has the band 23.5-26 psi on every corner. Every other car's pressure band is unknown.
// The tyre surface and the brakes have no live state (rulings 2026-10-30: the surface swings 30-60 °C within a lap, the
// brakes fall below the band on many straights); only outForFullLap judges them.
const TEST_BANDS = {
  surfaceDryLo: 85, surfaceDryHi: 105, surfaceInterLo: 60, surfaceInterHi: 90, surfaceWetLo: 50, surfaceWetHi: 80,
  carcassDryLo: 85, carcassDryHi: 110, carcassInterLo: 55, carcassInterHi: 75, carcassWetLo: 45, carcassWetHi: 65,
  pressureBelowSetupPsi: 1.5, pressureAboveSetupPsi: 1.0, brakeLo: 300, brakeHi: 1000, engineHi: 125,
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
  opts: { config?: EngineView['config']; session?: object; status?: string; spans?: OpenSpan[]; phase?: WeekendPhase } = {},
): CarBands => {
  const config = opts.config ?? { [CAR_BANDS_CONFIG.key]: TEST_BANDS };
  const view = situatedView({
    cars: [car],
    ...(opts.phase && { phase: opts.phase }),
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
  it('is a quick calculator at 4 Hz that reads tyres, condition, laps, the own car, car-status and the race activity, not the session', () => {
    expect(carBandsCalculator.id).toBe(CAR_BANDS);
    expect(carBandsCalculator.kind).toBe('quick');
    expect(carBandsCalculator.cadence).toEqual({ hz: 4 });
    expect(carBandsCalculator.reads).toEqual(expect.arrayContaining(['tyres', 'condition', 'laps', 'ownCar', 'spans:car-status', 'spans:car-activity-race']));
    expect(carBandsCalculator.reads).not.toContain('session');
  });

  it('the default bands: dry, inter and wet tyre bands; the pressure band on the setup; one band each for brakes and engine', () => {
    const on = (visual: 'inter' | 'wet' | 'medium', actual: 'inter' | 'wet' | 'C2') =>
      bandsOf(withSetup(carState({ tyres: { visualCompound: visual, actualCompound: actual } }), 25), [], { config: {} });
    const tyreBands = (b: CarBands) => [b.tyres.fl.surfaceC.band, b.tyres.fl.carcassC.band];
    expect(tyreBands(on('medium', 'C2'))).toEqual([known({ lo: 55, hi: 100 }, 0), known({ lo: 70, hi: 105 }, 0)]);
    expect(tyreBands(on('inter', 'inter'))).toEqual([known({ lo: 30, hi: 85 }, 0), known({ lo: 55, hi: 95 }, 0)]);
    expect(tyreBands(on('wet', 'wet'))).toEqual([known({ lo: 50, hi: 80 }, 0), known({ lo: 45, hi: 65 }, 0)]);
    const dry = on('medium', 'C2');
    expect(dry.tyres.fl.pressurePsi.band).toMatchObject({ known: true, value: { lo: 23.5, hi: 26 } });
    expect([dry.brakesC.fl.band, dry.engineC.band]).toEqual([known({ lo: 300, hi: 1000 }, 0), known({ lo: 0, hi: 135 }, 0)]);
  });

  it('the surface has no live state: notApplicable on every corner whether its value is in, above or below the band; value and band stay', () => {
    for (const c of [95, 106, 80]) {
      const bands = bandsOf(withSurface(c));
      for (const corner of corners) {
        expect(bands.tyres[corner].surfaceC).toEqual({ value: known(c, 0), state: NO_LIVE_STATE, band: known({ lo: 85, hi: 105 }, 0), outForFullLap: false });
      }
    }
  });

  it('the brakes have no live state: notApplicable on every corner whether their value is in, above or below the band; value and band stay', () => {
    for (const c of [650, 1100, 278]) {
      const bands = bandsOf(withBrakes(c));
      for (const corner of corners) {
        expect(bands.brakesC[corner]).toEqual({ value: known(c, 0), state: NO_LIVE_STATE, band: known({ lo: 300, hi: 1000 }, 0), outForFullLap: false });
      }
    }
  });

  it('a brake in band now whose last lap was out for the whole lap: outForFullLap, still no live state', () => {
    const cold = lap({ lapNumber: 3, channelRange: rangeOf({ brakesC: perCorner(() => known({ min: 150, max: 290 }, 0)) }) });
    const b = bandsOf(withBrakes(650), [cold]);
    for (const corner of corners) {
      expect(b.brakesC[corner]).toEqual({ value: known(650, 0), state: NO_LIVE_STATE, band: known({ lo: 300, hi: 1000 }, 0), outForFullLap: true });
    }
  });

  it('only the surface and the brakes lose their live state: carcass, pressure and engine out of band read it live on every corner', () => {
    const car = withSetup(
      carState({
        tyres: { corners: perCorner(() => ({ surfaceTempC: known(120, 0), carcassTempC: known(120, 0), pressurePsi: known(32, 0) })) },
        condition: { brakes: perCorner(() => ({ tempC: known(1100, 0) })), engineTempC: known(130, 0) },
      }),
      25,
    );
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
    expect(bands.tyres.fl.surfaceC.band).toEqual(known({ lo: d.surfaceDryLo, hi: 120 }, 0));
    // the builder's carcass is 95 °C: above the moved band
    expect(bands.tyres.fl.carcassC).toMatchObject({ band: known({ lo: d.carcassDryLo, hi: 90 }, 0), state: { known: true, value: 'above' } });
  });

  it('carcass, pressure, brakes and engine each use their own band', () => {
    const car = withSetup(
      carState({
        tyres: { corners: { fl: { carcassTempC: known(111, 0), pressurePsi: known(19, 0) } } },
        condition: { brakes: { rr: { tempC: known(1100, 0) } }, engineTempC: known(130, 0) },
      }),
      25,
    );
    const b = bandsOf(car);
    expect(b.tyres.fl.carcassC).toMatchObject({ band: known({ lo: 85, hi: 110 }, 0), state: { known: true, value: 'above' } });
    expect(b.tyres.fl.pressurePsi).toMatchObject({ band: { known: true, value: { lo: 23.5, hi: 26 } }, state: { known: true, value: 'below' } });
    expect(b.tyres.fr.pressurePsi.state).toMatchObject({ known: true, value: 'in' });
    expect(b.brakesC.rr).toMatchObject({ band: known({ lo: 300, hi: 1000 }, 0), value: known(1100, 0) });
    expect(b.engineC).toMatchObject({ band: known({ lo: 0, hi: 125 }, 0), value: known(130, 0), state: { known: true, value: 'above' } });
  });

  it('inter tyres use the inter band; wet tyres use the wet band; slicks use the dry band', () => {
    const on = (visual: 'inter' | 'wet' | 'medium', actual: 'inter' | 'wet' | 'C2') =>
      bandsOf(carState({ tyres: { visualCompound: visual, actualCompound: actual } }));
    // the builder's 95 °C carcass is in the dry band (85-110) but above the inter band (55-75) and the wet band (45-65)
    const inter = on('inter', 'inter');
    expect(inter.tyres.fl.surfaceC.band).toEqual(known({ lo: 60, hi: 90 }, 0));
    expect(inter.tyres.fl.carcassC).toMatchObject({ band: known({ lo: 55, hi: 75 }, 0), state: { known: true, value: 'above' } });
    const wet = on('wet', 'wet');
    expect(wet.tyres.fl.surfaceC.band).toEqual(known({ lo: 50, hi: 80 }, 0));
    expect(wet.tyres.fl.carcassC).toMatchObject({ band: known({ lo: 45, hi: 65 }, 0), state: { known: true, value: 'above' } });
    const dry = on('medium', 'C2');
    expect(dry.tyres.fl.surfaceC.band).toEqual(known({ lo: 85, hi: 105 }, 0));
    expect(dry.tyres.fl.carcassC).toMatchObject({ band: known({ lo: 85, hi: 110 }, 0), state: { known: true, value: 'in' } });
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
    // from lap 2: lap 1 of a race is not judged
    const laps = [
      lap({ lapNumber: 2, channelRange: rangeOf({ tyres: hot }) }),
      lap({ lapNumber: 3 }), // the last lap: back in band
      lap({ carId: carId(1), lapNumber: 4, channelRange: rangeOf({ tyres: hot }) }),
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
    expect(b.band).toEqual(known({ lo: 85, hi: 105 }, 0));
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
      expect(b.tyres[corner].carcassC).toMatchObject(hidden);
      // a rival has no setup: its pressure band and state are unknown whatever its value
      expect(b.tyres[corner].pressurePsi).toMatchObject({ value: unknown('realism'), state: { known: false }, band: { known: false }, outForFullLap: false });
      expect(b.tyres[corner].surfaceC).toMatchObject({ ...hidden, state: NO_LIVE_STATE });
      expect(b.brakesC[corner]).toMatchObject({ ...hidden, state: NO_LIVE_STATE });
    }
    expect(b.engineC).toMatchObject(hidden);
    // the band is still given: it is config, not data
    expect(b.engineC.band).toEqual(known({ lo: 0, hi: 125 }, 0));
  });

  it('is stateless: the same view gives the same output twice', () => {
    const view = situatedView({ cars: [withSurface(110)], history: { laps: [lap({ lapNumber: 2 })] }, config: { [CAR_BANDS_CONFIG.key]: TEST_BANDS } });
    expect(calc.compute(view)).toEqual(calc.compute(view));
  });

  describe('the judged lap (Q1 A): the newest completed rate lap that is not lap 1 of a race', () => {
    // the surface below its band (85-105) all lap, and an in-band lap to compare
    const cold = rangeOf({ tyres: surfaceRange(60, 80) });
    const out = (laps: LapRecord[], opts: Parameters<typeof bandsOf>[2] = {}) => bandsOf(withSurface(95), laps, opts).tyres.fl.surfaceC.outForFullLap;

    it('lap 1 of a race is not judged', () => {
      expect(out([lap({ lapNumber: 1, channelRange: cold })])).toBe(false);
      // the same lap as lap 2 is judged, and lap 1 of a practice session is
      expect(out([lap({ lapNumber: 2, channelRange: cold })])).toBe(true);
      expect(out([lap({ lapNumber: 1, channelRange: cold })], { phase: PRACTICE })).toBe(true);
    });

    it('an SC lap is not judged', () => {
      // 90 s laps: 5 % under the SC is 4.5 s, over maxNeutralisedMs (2 s); 2 % is 1.8 s, under it
      expect(out([lap({ lapNumber: 3, channelRange: cold, scShare: 0.05 })])).toBe(false);
      expect(out([lap({ lapNumber: 3, channelRange: cold, scShare: 0.02 })])).toBe(true);
      // the newest clean lap before it is judged in its place
      expect(out([lap({ lapNumber: 2, channelRange: cold }), lap({ lapNumber: 3, scShare: 1 })])).toBe(true);
      expect(out([lap({ lapNumber: 2 }), lap({ lapNumber: 3, channelRange: cold, scShare: 1 })])).toBe(false);
    });

    it('an in-lap is not judged', () => {
      expect(out([lap({ lapNumber: 5, channelRange: cold, inLap: true })])).toBe(false);
      expect(out([lap({ lapNumber: 4 }), lap({ lapNumber: 5, channelRange: cold, inLap: true })])).toBe(false);
    });

    it('a rate lap out of band is judged', () => {
      expect(out([lap({ lapNumber: 3, channelRange: cold })])).toBe(true);
      expect(out([lap({ lapNumber: 2 }), lap({ lapNumber: 3, channelRange: cold })])).toBe(true);
    });
  });

  describe('the slick carcass band 70-105 °C (Q2)', () => {
    const carcass = (c: number) =>
      bandsOf(carState({ tyres: { corners: perCorner(() => ({ carcassTempC: known(c, 0) })) } }), [], { config: {} }).tyres.fl.carcassC;

    it('carcass 72 °C is in band', () => {
      expect(carcass(72)).toMatchObject({ band: known({ lo: 70, hi: 105 }, 0), state: { known: true, value: 'in' } });
    });

    it('carcass 106 °C is above', () => {
      expect(carcass(106)).toMatchObject({ band: known({ lo: 70, hi: 105 }, 0), state: { known: true, value: 'above' } });
    });
  });

  describe("the player's pressure band on the setup (Q3 A, Q5 A): setup - 1.5 psi to setup + 1.0 psi", () => {
    // the friend's setup: 24.2 psi front, 20.9 psi rear
    const SETUP = { fl: 24.2, fr: 24.2, rl: 20.9, rr: 20.9 };
    const pressures = (p: { fl: number; fr: number; rl: number; rr: number }) =>
      carState({ tyres: { corners: { fl: { pressurePsi: known(p.fl, 0) }, fr: { pressurePsi: known(p.fr, 0) }, rl: { pressurePsi: known(p.rl, 0) }, rr: { pressurePsi: known(p.rr, 0) } } } });
    const pressureRange = (min: number, max: number): ChannelRange['tyres'] =>
      perCorner(() => ({ surfaceC: known({ min: 90, max: 100 }, 0), carcassC: known({ min: 90, max: 100 }, 0), pressurePsi: known({ min, max }, 0) }));
    const notReceived = { state: unknown('notReceived'), band: unknown('notReceived'), outForFullLap: false };

    it("the player's pressure band follows the setup", () => {
      const player = withSetup(pressures({ fl: 24.2, fr: 23, rl: 19.3, rr: 21.9 }), SETUP);
      const b = bandsOf(player, [], { config: {} }).tyres;
      expect(b.rl.pressurePsi).toMatchObject({ value: known(19.3, 0), band: { known: true, value: { lo: 19.4, hi: 21.9 } }, state: { known: true, value: 'below' } });
      expect(b.rr.pressurePsi).toMatchObject({ band: { known: true, value: { lo: 19.4, hi: 21.9 } }, state: { known: true, value: 'in' } });
      expect(b.fl.pressurePsi).toMatchObject({ band: { known: true, value: { lo: 22.7, hi: 25.2 } }, state: { known: true, value: 'in' } });
      expect(b.fr.pressurePsi).toMatchObject({ band: { known: true, value: { lo: 22.7, hi: 25.2 } }, state: { known: true, value: 'in' } });
      // the judged lap is judged against the same band: a rear at 17-19 psi all lap is out, a front at 23-25 psi is not
      const lowLap = lap({ lapNumber: 3, channelRange: rangeOf({ tyres: pressureRange(17, 19) }) });
      const front = lap({ lapNumber: 3, channelRange: rangeOf({ tyres: pressureRange(23, 25) }) });
      expect(bandsOf(player, [lowLap], { config: {} }).tyres.rl.pressurePsi.outForFullLap).toBe(true);
      expect(bandsOf(player, [front], { config: {} }).tyres.fl.pressurePsi.outForFullLap).toBe(false);
    });

    it('the offsets come from the config', () => {
      const player = withSetup(pressures({ fl: 24.2, fr: 24.2, rl: 19.3, rr: 20.9 }), SETUP);
      const b = bandsOf(player, [], { config: { [CAR_BANDS_CONFIG.key]: { pressureBelowSetupPsi: 2, pressureAboveSetupPsi: 0.5 } } }).tyres.rl.pressurePsi;
      expect(b).toMatchObject({ band: { known: true, value: { lo: 18.9, hi: 21.4 } }, state: { known: true, value: 'in' } });
      expect(CAR_BANDS_CONFIG.defaults).toMatchObject({ pressureBelowSetupPsi: 1.5, pressureAboveSetupPsi: 1.0 });
      expect(CAR_BANDS_CONFIG.defaults).not.toHaveProperty('pressureLo');
      expect(CAR_BANDS_CONFIG.defaults).not.toHaveProperty('pressureHi');
    });

    it("another car's pressure band is unknown", () => {
      // the player (car 0) has its setup; car 1 has none: the game sends the setup for the player's car only
      const rival = carState({ id: carId(1), tyres: { corners: perCorner(() => ({ pressurePsi: known(32, 0) })) } });
      const view = situatedView({
        cars: [withSetup(carState(), 25), rival],
        history: { laps: [lap({ carId: carId(1), lapNumber: 3, channelRange: rangeOf({ tyres: pressureRange(10, 12) }) })] },
        config: { [CAR_BANDS_CONFIG.key]: TEST_BANDS },
      });
      const b = calc.compute(view)[carId(1)]!;
      for (const corner of corners) expect(b.tyres[corner].pressurePsi).toEqual({ value: known(32, 0), ...notReceived });
      // the rival's other bands stay
      expect(b.tyres.fl.carcassC.band).toEqual(known({ lo: 85, hi: 110 }, 0));
    });

    it("the player's band before the setup arrives is unknown", () => {
      const low = lap({ lapNumber: 3, channelRange: rangeOf({ tyres: pressureRange(10, 12) }) });
      for (const player of [withOwnCar(carState()), carState()]) {
        const b = bandsOf(player, [low]);
        for (const corner of corners) expect(b.tyres[corner].pressurePsi).toEqual({ value: known(25, 0), ...notReceived });
        expect(b.tyres.fl.carcassC.band).toEqual(known({ lo: 85, hi: 110 }, 0));
      }
    });
  });

  describe('behaviour table (C44): a row per car-status and race-activity kind', () => {
    it('exports CAR_BANDS_BEHAVIOUR over car-status and the race activity', () => {
      expect(Object.keys(CAR_BANDS_BEHAVIOUR).sort()).toEqual(['car-activity-race', 'car-status']);
    });

    // carcass, pressure and engine above their bands now; the last lap a rate lap whose carcass was above the band all lap
    const hot = withSetup(
      carState({
        tyres: { corners: perCorner(() => ({ carcassTempC: known(120, 0), pressurePsi: known(32, 0) })) },
        condition: { engineTempC: known(130, 0) },
      }),
      25,
    );
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
        expect(b.tyres[corner].carcassC).toMatchObject({ value: known(120, 0), band: known({ lo: 85, hi: 110 }, 0), outForFullLap: true });
        expect(b.tyres[corner].pressurePsi).toMatchObject({ value: known(32, 0), band: { known: true, value: { lo: 23.5, hi: 26 } } });
      }
      expect(b.engineC).toEqual({ value: known(130, 0), state: NO_LIVE_STATE, band: known({ lo: 0, hi: 125 }, 0), outForFullLap: false });
    });

    it('only the car in its box stop is off: another car racing reads its live state', () => {
      const other = { ...hot, id: carId(1), ownCar: undefined };
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

    // car-status decides (C43); Task 24 removed the transitional `car.active` these cases contradicted
    const statusOut = (kind: string) =>
      calc.compute(situatedView({ cars: [hot], config: { [CAR_BANDS_CONFIG.key]: TEST_BANDS }, status: { 0: kind } }))[carId(0)];

    it('car-status competing: the car has its bands', () => {
      expect(statusOut('competing')?.engineC.state).toEqual(above);
    });

    it('car-status retired: the car is still in the session and keeps its bands', () => {
      expect(statusOut('retired')?.engineC.state).toEqual(above);
    });

    it('car-status disqualified: the car is still in the session and keeps its bands', () => {
      expect(statusOut('disqualified')?.engineC.state).toEqual(above);
    });

    it('car-status absent: no entry', () => {
      expect(statusOut('absent')).toBeUndefined();
    });
  });
});
