import { describe, expect, it } from 'vitest';
import { carId, known, unknown, type CarState, type ChannelRange, type LapRecord } from '../../../domain/src/index.ts';
import type { EngineView } from '@pitwall/engine';
import type { OpenSpan, WeekendPhase } from '../../../domain/src/index.ts';
import { carBandsCalculator } from '../../src/car-bands/calculator.ts';
import { CAR_BANDS, CAR_BANDS_BEHAVIOUR, CAR_BANDS_CONFIG, type CarBands } from '../../src/car-bands/index.ts';
import { carState, lap, realismHidden } from '../../../../test-support/builders/index.ts';
import { guardedQuick, NONE, openSpan, PRACTICE, QUALIFYING, situatedView } from '../situated.ts';
import { withOwnCar, withSetup } from '../own-car.ts';

/** The calculator through its guarded view (C41): every case fails on a read it does not declare. */
const calc = guardedQuick(carBandsCalculator);

// Every case runs on TEST_BANDS, a fixed config of the surface, brake and engine bands (the defaults before 2026-10-30),
// so no case depends on those defaults; only 'the default bands' pins them. The carcass and pressure bands are the
// defaults (SP4.3c §5.6): per actual compound, its reference temperature Tref (C1 105, C2 95, C3 90, C4 85, C5 80, inter
// 65, wet 55 °C) -20 ... +15 °C; the builder's car and laps run C3 (carcass 70-105 °C). The pressure band is the setup on
// the same carcass band by the gas law: setup x (Tref - 20 + 273.15) / (Tref + 273.15) ... setup x (Tref + 15 + 273.15) /
// (Tref + 273.15); a C3 car `withSetup(c, 25)` has the band 23.62-26.03 psi (`P25`) on every corner. A car without a
// setup has an unknown pressure band. Tyre bands are judged on human-driven cars only (§5.6 D): `bandsOf` opens a `human`
// car-driver span for its car unless `driver` says otherwise. The engine band's lo is pinned to 0 (engineHi only).
// The tyre surface and the brakes have no live state (rulings 2026-10-30: the surface swings 30-60 °C within a lap, the
// brakes fall below the band on many straights); only outForFullLap judges them.
const TEST_BANDS = {
  surfaceDryLo: 85, surfaceDryHi: 105, surfaceInterLo: 60, surfaceInterHi: 90, surfaceWetLo: 50, surfaceWetHi: 80,
  brakeLo: 300, brakeHi: 1000, engineHi: 125,
};
/** The game's reference carcass temperature per actual compound (research 20 §1). */
const TREF = { C1: 105, C2: 95, C3: 90, C4: 85, C5: 80, inter: 65, wet: 55 } as const;
/** The pressure band of `setup` psi on a compound of reference `tref` °C (§5.6 B). */
const gasBand = (setup: number, tref: number) => ({ lo: (setup * (tref - 20 + 273.15)) / (tref + 273.15), hi: (setup * (tref + 15 + 273.15)) / (tref + 273.15) });
/** A known band equal to `b` up to float rounding. */
const closeBand = (b: { lo: number; hi: number }, digits = 9) => ({ known: true, value: { lo: expect.closeTo(b.lo, digits), hi: expect.closeTo(b.hi, digits) }, at: 0 });
/** A C3 car's pressure band on its 25 psi setup: 23.62-26.03 psi. */
const P25 = closeBand(gasBand(25, TREF.C3));
/** The C3 carcass band: 90 - 20 ... 90 + 15 °C. */
const C3_CARCASS = known({ lo: 70, hi: 105 }, 0);
/** A `human` car-driver span of each car (§5.6 D): the cars whose tyre bands are judged. */
const humans = (...ids: number[]) => ids.map((id) => openSpan('car-driver', 'human', { car: id }));
const NO_LIVE_STATE = unknown('notApplicable');
/** `lapState` without a judged lap, its range or its band: unknown, whatever the reason. */
const NO_LAP_STATE = expect.objectContaining({ known: false });
const lapStateOf = (value: 'below' | 'in' | 'above') => expect.objectContaining({ known: true, value });
const corners = ['fl', 'fr', 'rl', 'rr'] as const;
const withSurface = (c: number) =>
  carState({
    tyres: { corners: { fl: { surfaceTempC: known(c, 0) }, fr: { surfaceTempC: known(c, 0) }, rl: { surfaceTempC: known(c, 0) }, rr: { surfaceTempC: known(c, 0) } } },
  });
const bandsOf = (
  car: CarState,
  laps: LapRecord[] = [],
  opts: { config?: EngineView['config']; session?: object; status?: string; spans?: OpenSpan[]; phase?: WeekendPhase; driver?: 'human' | 'ai' | 'none' } = {},
): CarBands => {
  const config = opts.config ?? { [CAR_BANDS_CONFIG.key]: TEST_BANDS };
  const driver = opts.driver ?? 'human';
  const driverSpans = driver === 'none' ? [] : [openSpan('car-driver', driver, { car: car.id })];
  const view = situatedView({
    cars: [car],
    ...(opts.phase && { phase: opts.phase }),
    history: { laps },
    config,
    ...(opts.session && { session: opts.session }),
    ...(opts.status && { status: { [car.id]: opts.status } }),
    spans: [...driverSpans, ...(opts.spans ?? [])],
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
  it('is a quick calculator at 4 Hz that reads tyres, condition, laps, the own car, car-status, car-driver and the race activity, not the session', () => {
    expect(carBandsCalculator.id).toBe(CAR_BANDS);
    expect(carBandsCalculator.kind).toBe('quick');
    expect(carBandsCalculator.cadence).toEqual({ hz: 4 });
    expect(carBandsCalculator.reads).toEqual(expect.arrayContaining(['tyres', 'condition', 'laps', 'ownCar', 'spans:car-status', 'spans:car-activity-race', 'spans:weekend-phase', 'spans:car-driver']));
    expect(carBandsCalculator.reads).not.toContain('session');
  });

  it('the default bands: slick, inter and wet surface; the carcass per actual compound; the pressure band on the setup; one band each for brakes and engine', () => {
    const on = (visual: 'inter' | 'wet' | 'medium', actual: 'inter' | 'wet' | 'C2') =>
      bandsOf(withSetup(carState({ tyres: { visualCompound: visual, actualCompound: actual } }), 25), [], { config: {} });
    const tyreBands = (b: CarBands) => [b.tyres.fl.surfaceC.band, b.tyres.fl.carcassC.band];
    // slick and inter surface unchanged; the wet surface lowered to 30-55 °C (§5.6 C)
    expect(tyreBands(on('medium', 'C2'))).toEqual([known({ lo: 55, hi: 100 }, 0), known({ lo: 75, hi: 110 }, 0)]);
    expect(tyreBands(on('inter', 'inter'))).toEqual([known({ lo: 30, hi: 85 }, 0), known({ lo: 45, hi: 80 }, 0)]);
    expect(tyreBands(on('wet', 'wet'))).toEqual([known({ lo: 30, hi: 55 }, 0), known({ lo: 35, hi: 70 }, 0)]);
    const dry = on('medium', 'C2');
    expect(dry.tyres.fl.pressurePsi.band).toEqual(closeBand(gasBand(25, TREF.C2)));
    expect([dry.brakesC.fl.band, dry.engineC.band]).toEqual([known({ lo: 300, hi: 1000 }, 0), known({ lo: 0, hi: 135 }, 0)]);
  });

  it('the surface has no live state: notApplicable on every corner whether its value is in, above or below the band; value and band stay', () => {
    for (const c of [95, 106, 80]) {
      const bands = bandsOf(withSurface(c));
      for (const corner of corners) {
        expect(bands.tyres[corner].surfaceC).toEqual({ value: known(c, 0), state: NO_LIVE_STATE, band: known({ lo: 85, hi: 105 }, 0), outForFullLap: false, lapState: NO_LAP_STATE });
      }
    }
  });

  it('the brakes have no live state: notApplicable on every corner whether their value is in, above or below the band; value and band stay', () => {
    for (const c of [650, 1100, 278]) {
      const bands = bandsOf(withBrakes(c));
      for (const corner of corners) {
        expect(bands.brakesC[corner]).toEqual({ value: known(c, 0), state: NO_LIVE_STATE, band: known({ lo: 300, hi: 1000 }, 0), outForFullLap: false, lapState: NO_LAP_STATE });
      }
    }
  });

  it('a brake in band now whose last lap was out for the whole lap: outForFullLap, still no live state', () => {
    const cold = lap({ lapNumber: 3, channelRange: rangeOf({ brakesC: perCorner(() => known({ min: 150, max: 290 }, 0)) }) });
    const b = bandsOf(withBrakes(650), [cold]);
    for (const corner of corners) {
      expect(b.brakesC[corner]).toEqual({ value: known(650, 0), state: NO_LIVE_STATE, band: known({ lo: 300, hi: 1000 }, 0), outForFullLap: true, lapState: lapStateOf('below') });
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
    const bands = bandsOf(carState(), [], { config: { [CAR_BANDS_CONFIG.key]: { surfaceDryHi: 120, carcassAboveRefC: 0 } } });
    expect(bands.tyres.fl.surfaceC.band).toEqual(known({ lo: d.surfaceDryLo, hi: 120 }, 0));
    // the builder's C3 carcass is 95 °C: above the moved band 70-90
    expect(bands.tyres.fl.carcassC).toMatchObject({ band: known({ lo: 70, hi: 90 }, 0), state: { known: true, value: 'above' } });
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
    expect(b.tyres.fl.carcassC).toMatchObject({ band: C3_CARCASS, state: { known: true, value: 'above' } });
    expect(b.tyres.fl.pressurePsi).toMatchObject({ band: P25, state: { known: true, value: 'below' } });
    expect(b.tyres.fr.pressurePsi.state).toMatchObject({ known: true, value: 'in' });
    expect(b.brakesC.rr).toMatchObject({ band: known({ lo: 300, hi: 1000 }, 0), value: known(1100, 0) });
    expect(b.engineC).toMatchObject({ band: known({ lo: 0, hi: 125 }, 0), value: known(130, 0), state: { known: true, value: 'above' } });
  });

  it("inter tyres use the inter bands; wet tyres use the wet bands; slicks use the dry surface band and their compound's carcass band", () => {
    const on = (visual: 'inter' | 'wet' | 'medium', actual: 'inter' | 'wet' | 'C2') =>
      bandsOf(carState({ tyres: { visualCompound: visual, actualCompound: actual } }));
    // the builder's 95 °C carcass is in the C2 band (75-110) but above the inter band (45-80) and the wet band (35-70)
    const inter = on('inter', 'inter');
    expect(inter.tyres.fl.surfaceC.band).toEqual(known({ lo: 60, hi: 90 }, 0));
    expect(inter.tyres.fl.carcassC).toMatchObject({ band: known({ lo: 45, hi: 80 }, 0), state: { known: true, value: 'above' } });
    const wet = on('wet', 'wet');
    expect(wet.tyres.fl.surfaceC.band).toEqual(known({ lo: 50, hi: 80 }, 0));
    expect(wet.tyres.fl.carcassC).toMatchObject({ band: known({ lo: 35, hi: 70 }, 0), state: { known: true, value: 'above' } });
    const dry = on('medium', 'C2');
    expect(dry.tyres.fl.surfaceC.band).toEqual(known({ lo: 85, hi: 105 }, 0));
    expect(dry.tyres.fl.carcassC).toMatchObject({ band: known({ lo: 75, hi: 110 }, 0), state: { known: true, value: 'in' } });
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
    const view = situatedView({ cars: [withSurface(110)], history: { laps: [lap({ lapNumber: 2 })] }, config: { [CAR_BANDS_CONFIG.key]: TEST_BANDS }, spans: humans(0) });
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

    it('only the race turns the lap-1 rule on: lap 1 of qualifying, practice or no weekend phase is judged like any rate lap', () => {
      for (const phase of [PRACTICE, QUALIFYING, NONE]) expect(out([lap({ lapNumber: 1, channelRange: cold })], { phase }), phase.kind).toBe(true);
      // and an SC lap 1 there is still no rate lap
      expect(out([lap({ lapNumber: 1, channelRange: cold, scShare: 1 })], { phase: QUALIFYING })).toBe(false);
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

  describe('lapState (C43): the judged lap by its one number against the band of that lap, the one judgement of the advisory and the display', () => {
    /** A completed lap of car 0 (lap 3 unless `rec` says otherwise) whose ranges are the builder's (all in band) except `over`. */
    const lapWith = (over: Partial<ChannelRange>, rec: Parameters<typeof lap>[0] = {}) => lap({ lapNumber: 3, ...rec, channelRange: rangeOf(over) });
    /** A lap whose tyre `channel` ranged `min`-`max` on every corner. */
    const tyreLap = (channel: 'surfaceC' | 'carcassC' | 'pressurePsi', min: number, max: number, rec: Parameters<typeof lap>[0] = {}) => {
      const tyres = rangeOf({}).tyres;
      for (const corner of corners) tyres[corner] = { ...tyres[corner], [channel]: known({ min, max }, 0) };
      return lapWith({ tyres }, rec);
    };
    const surface = (laps: LapRecord[], opts: Parameters<typeof bandsOf>[2] = {}) => bandsOf(withSurface(95), laps, opts).tyres.fl.surfaceC.lapState;

    it('the tyre surface by its mid-range: 100-120 °C (110) above the dry band 85-105, 60-90 °C (75) below, 80-100 °C (90) in', () => {
      expect(surface([tyreLap('surfaceC', 100, 120)])).toEqual(lapStateOf('above'));
      expect(surface([tyreLap('surfaceC', 60, 90)])).toEqual(lapStateOf('below'));
      expect(surface([tyreLap('surfaceC', 80, 100)])).toEqual(lapStateOf('in'));
      // the range crosses the band, so the lap is not out for the full lap: lapState judges the surface beside it, on every corner
      const b = bandsOf(withSurface(95), [tyreLap('surfaceC', 100, 120)]);
      for (const corner of corners) expect(b.tyres[corner].surfaceC).toMatchObject({ state: NO_LIVE_STATE, outForFullLap: false, lapState: lapStateOf('above') });
    });

    it('lapState ignores the live value: a lap out of band with the live value in band, and a lap in band with the live value out', () => {
      expect(bandsOf(withSurface(95), [tyreLap('surfaceC', 100, 120)]).tyres.fl.surfaceC.lapState).toEqual(lapStateOf('above'));
      expect(bandsOf(withSurface(130), [tyreLap('surfaceC', 80, 100)]).tyres.fl.surfaceC.lapState).toEqual(lapStateOf('in'));
    });

    it('the carcass and the pressure by their mid-range: carcass 110-114 °C (112) above the C3 band 70-105; pressure 26-28 psi (27) above the setup band 23.62-26.03', () => {
      expect(bandsOf(carState(), [tyreLap('carcassC', 110, 114)]).tyres.rl.carcassC.lapState).toEqual(lapStateOf('above'));
      expect(bandsOf(carState(), [tyreLap('carcassC', 80, 100)]).tyres.rl.carcassC.lapState).toEqual(lapStateOf('in'));
      const player = withSetup(carState(), 25);
      expect(bandsOf(player, [tyreLap('pressurePsi', 26, 28)]).tyres.rr.pressurePsi.lapState).toEqual(lapStateOf('above'));
      expect(bandsOf(player, [tyreLap('pressurePsi', 20, 23)]).tyres.rr.pressurePsi.lapState).toEqual(lapStateOf('below'));
      expect(bandsOf(player, [tyreLap('pressurePsi', 24, 26)]).tyres.rr.pressurePsi.lapState).toEqual(lapStateOf('in'));
    });

    it('the brakes by their peak: 180-290 °C below 300-1000, 120-750 °C in (it dipped below but peaked in band), 400-1050 °C above', () => {
      const brake = (min: number, max: number) => bandsOf(withBrakes(650), [lapWith({ brakesC: perCorner(() => known({ min, max }, 0)) })]).brakesC;
      for (const corner of corners) {
        expect(brake(180, 290)[corner].lapState).toEqual(lapStateOf('below'));
        expect(brake(120, 750)[corner].lapState).toEqual(lapStateOf('in'));
        expect(brake(400, 1050)[corner].lapState).toEqual(lapStateOf('above'));
      }
    });

    it('the engine by its peak: 120-130 °C above 0-125; 110 °C in', () => {
      expect(bandsOf(carState(), [lapWith({ engineC: known({ min: 120, max: 130 }, 0) })]).engineC.lapState).toEqual(lapStateOf('above'));
      expect(bandsOf(carState(), [lapWith({})]).engineC.lapState).toEqual(lapStateOf('in'));
    });

    it('unknown on every channel without a judged lap: no lap, or only lap 1 of a race', () => {
      for (const laps of [[], [tyreLap('surfaceC', 60, 80, { lapNumber: 1 })]]) {
        const b = bandsOf(withSetup(carState(), 25), laps);
        for (const corner of corners) {
          for (const channel of ['surfaceC', 'carcassC', 'pressurePsi'] as const) expect(b.tyres[corner][channel].lapState).toEqual(NO_LAP_STATE);
          expect(b.brakesC[corner].lapState).toEqual(NO_LAP_STATE);
        }
        expect(b.engineC.lapState).toEqual(NO_LAP_STATE);
      }
      // lap 1 of a practice session is judged
      expect(surface([tyreLap('surfaceC', 60, 80, { lapNumber: 1 })], { phase: PRACTICE })).toEqual(lapStateOf('below'));
    });

    it('unknown with an unknown range of the judged lap, never a zero reading', () => {
      const b = bandsOf(carState(), [lapWith({ brakesC: { ...rangeOf({}).brakesC, fl: unknown('notReceived') }, engineC: unknown('notReceived') })]);
      expect(b.brakesC.fl.lapState).toEqual(NO_LAP_STATE);
      expect(b.engineC.lapState).toEqual(NO_LAP_STATE);
      // the other corners are judged
      expect(b.brakesC.fr.lapState).toEqual(lapStateOf('in'));
    });

    it('unknown with an unknown band: the pressure without the setup, even for a lap far below any band', () => {
      const low = tyreLap('pressurePsi', 10, 12);
      for (const car of [carState(), withOwnCar(carState())]) {
        const b = bandsOf(car, [low]);
        for (const corner of corners) expect(b.tyres[corner].pressurePsi.lapState).toEqual(NO_LAP_STATE);
        // the other channels of the same lap are judged
        expect(b.tyres.fl.carcassC.lapState).toEqual(lapStateOf('in'));
      }
    });

    it("judges judgedLaps' lap: an SC or in-lap after it changes nothing, another car's lap does not count, the newest rate lap does", () => {
      const cold = tyreLap('surfaceC', 60, 80, { lapNumber: 2 });
      expect(surface([cold, lap({ lapNumber: 3, scShare: 1 })])).toEqual(lapStateOf('below'));
      expect(surface([cold, lap({ lapNumber: 3, inLap: true })])).toEqual(lapStateOf('below'));
      expect(surface([cold, tyreLap('surfaceC', 100, 120, { lapNumber: 3, carId: carId(1) })])).toEqual(lapStateOf('below'));
      expect(surface([cold, lap({ lapNumber: 3 })])).toEqual(lapStateOf('in'));
    });

    it('judges the lap against the band of the compound it was driven on: an inter lap at 65-80 °C is in, though below the dry band', () => {
      expect(surface([tyreLap('surfaceC', 65, 80, { visualCompound: 'inter', actualCompound: 'inter' })])).toEqual(lapStateOf('in'));
      expect(surface([tyreLap('surfaceC', 65, 80)])).toEqual(lapStateOf('below'));
    });

    it('the band comes from the config: a brake lap peaking at 340 °C is in with brakeLo 300 and below with brakeLo 350', () => {
      const laps = [lapWith({ brakesC: perCorner(() => known({ min: 200, max: 340 }, 0)) })];
      expect(bandsOf(withBrakes(650), laps).brakesC.fl.lapState).toEqual(lapStateOf('in'));
      expect(bandsOf(withBrakes(650), laps, { config: { [CAR_BANDS_CONFIG.key]: { ...TEST_BANDS, brakeLo: 350 } } }).brakesC.fl.lapState).toEqual(lapStateOf('below'));
    });

    it("in the box stop the live states are off but the judged lap's lapState stays", () => {
      const b = bandsOf(withSurface(95), [tyreLap('surfaceC', 100, 120)], { spans: [openSpan('car-activity-race', 'boxStop', { car: 0 })] });
      expect(b.tyres.fl.surfaceC.lapState).toEqual(lapStateOf('above'));
      expect(b.tyres.fl.carcassC).toMatchObject({ state: NO_LIVE_STATE, lapState: lapStateOf('in') });
    });
  });

  describe('the C3 carcass band keeps 70-105 °C (Q2, §5.6 A)', () => {
    const carcass = (c: number) =>
      bandsOf(carState({ tyres: { corners: perCorner(() => ({ carcassTempC: known(c, 0) })) } }), [], { config: {} }).tyres.fl.carcassC;

    it('carcass 72 °C is in band', () => {
      expect(carcass(72)).toMatchObject({ band: C3_CARCASS, state: { known: true, value: 'in' } });
    });

    it('carcass 106 °C is above', () => {
      expect(carcass(106)).toMatchObject({ band: C3_CARCASS, state: { known: true, value: 'above' } });
    });
  });

  describe("the player's pressure band on the setup (Q3 A, Q5 A, §5.6 B): the setup on the carcass band by the gas law", () => {
    // the friend's setup: 24.2 psi front, 20.9 psi rear; on C3 the rear band is 19.75-21.76 psi, the front 22.87-25.20
    const SETUP = { fl: 24.2, fr: 24.2, rl: 20.9, rr: 20.9 };
    const pressures = (p: { fl: number; fr: number; rl: number; rr: number }) =>
      carState({ tyres: { corners: { fl: { pressurePsi: known(p.fl, 0) }, fr: { pressurePsi: known(p.fr, 0) }, rl: { pressurePsi: known(p.rl, 0) }, rr: { pressurePsi: known(p.rr, 0) } } } });
    const pressureRange = (min: number, max: number): ChannelRange['tyres'] =>
      perCorner(() => ({ surfaceC: known({ min: 90, max: 100 }, 0), carcassC: known({ min: 90, max: 100 }, 0), pressurePsi: known({ min, max }, 0) }));
    const notReceived = { state: unknown('notReceived'), band: unknown('notReceived'), outForFullLap: false, lapState: NO_LAP_STATE };

    it("the player's pressure band follows the setup", () => {
      const player = withSetup(pressures({ fl: 24.2, fr: 23, rl: 19.3, rr: 21.5 }), SETUP);
      const b = bandsOf(player, [], { config: {} }).tyres;
      const rear = closeBand(gasBand(20.9, TREF.C3));
      const frontBand = closeBand(gasBand(24.2, TREF.C3));
      expect(b.rl.pressurePsi).toMatchObject({ value: known(19.3, 0), band: rear, state: { known: true, value: 'below' } });
      expect(b.rr.pressurePsi).toMatchObject({ band: rear, state: { known: true, value: 'in' } });
      expect(b.fl.pressurePsi).toMatchObject({ band: frontBand, state: { known: true, value: 'in' } });
      expect(b.fr.pressurePsi).toMatchObject({ band: frontBand, state: { known: true, value: 'in' } });
      // the judged lap is judged against the same band: a rear at 17-19 psi all lap is out, a front at 23-25 psi is not
      const lowLap = lap({ lapNumber: 3, channelRange: rangeOf({ tyres: pressureRange(17, 19) }) });
      const front = lap({ lapNumber: 3, channelRange: rangeOf({ tyres: pressureRange(23, 25) }) });
      expect(bandsOf(player, [lowLap], { config: {} }).tyres.rl.pressurePsi.outForFullLap).toBe(true);
      expect(bandsOf(player, [front], { config: {} }).tyres.fl.pressurePsi.outForFullLap).toBe(false);
    });

    it("the pressure band moves with the carcass band's offsets from the config; no psi offset of its own", () => {
      const player = withSetup(pressures({ fl: 24.2, fr: 24.2, rl: 19.3, rr: 20.9 }), SETUP);
      // carcass 90 - 40 ... 90 + 5 °C: the rear band 20.9 x 323.15 / 363.15 ... 20.9 x 368.15 / 363.15 = 18.60-21.19 psi
      const b = bandsOf(player, [], { config: { [CAR_BANDS_CONFIG.key]: { carcassBelowRefC: 40, carcassAboveRefC: 5 } } }).tyres.rl.pressurePsi;
      expect(b).toMatchObject({ band: closeBand({ lo: (20.9 * 323.15) / 363.15, hi: (20.9 * 368.15) / 363.15 }), state: { known: true, value: 'in' } });
      expect(CAR_BANDS_CONFIG.defaults).toMatchObject({ carcassBelowRefC: 20, carcassAboveRefC: 15 });
      for (const gone of ['pressureBelowSetupPsi', 'pressureAboveSetupPsi', 'pressureLo', 'pressureHi']) expect(CAR_BANDS_CONFIG.defaults).not.toHaveProperty(gone);
    });

    it("another car's pressure band is unknown", () => {
      // the player (car 0) has its setup; car 1 has none: the game sends the setup for the player's car only
      const rival = carState({ id: carId(1), tyres: { corners: perCorner(() => ({ pressurePsi: known(32, 0) })) } });
      const view = situatedView({
        cars: [withSetup(carState(), 25), rival],
        history: { laps: [lap({ carId: carId(1), lapNumber: 3, channelRange: rangeOf({ tyres: pressureRange(10, 12) }) })] },
        config: { [CAR_BANDS_CONFIG.key]: TEST_BANDS },
        // the rival is another human online: its tyre bands are judged, but it has no setup
        spans: humans(0, 1),
      });
      const b = calc.compute(view)[carId(1)]!;
      for (const corner of corners) expect(b.tyres[corner].pressurePsi).toEqual({ value: known(32, 0), ...notReceived });
      // the rival's other bands stay
      expect(b.tyres.fl.carcassC.band).toEqual(C3_CARCASS);
    });

    it("the player's band before the setup arrives is unknown", () => {
      const low = lap({ lapNumber: 3, channelRange: rangeOf({ tyres: pressureRange(10, 12) }) });
      for (const player of [withOwnCar(carState()), carState()]) {
        const b = bandsOf(player, [low]);
        for (const corner of corners) expect(b.tyres[corner].pressurePsi).toEqual({ value: known(25, 0), ...notReceived });
        expect(b.tyres.fl.carcassC.band).toEqual(C3_CARCASS);
      }
    });
  });

  describe('behaviour table (C44): a row per car-status, car-driver and race-activity kind', () => {
    it('exports CAR_BANDS_BEHAVIOUR over car-status, car-driver, the race activity and the weekend phase', () => {
      expect(Object.keys(CAR_BANDS_BEHAVIOUR).sort()).toEqual(['car-activity-race', 'car-driver', 'car-status', 'weekend-phase']);
    });

    it('car-driver: a row for exactly its kinds, ai and human', () => {
      expect(Object.keys(CAR_BANDS_BEHAVIOUR['car-driver']!).sort()).toEqual(['ai', 'human']);
    });

    it('weekend phase: only race asks for the lap-1 rule; practice, qualifying and none do not', () => {
      expect(CAR_BANDS_BEHAVIOUR['weekend-phase']).toEqual({ practice: { isRace: false }, qualifying: { isRace: false }, race: { isRace: true }, none: { isRace: false } });
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
        expect(b.tyres[corner].carcassC).toMatchObject({ value: known(120, 0), band: C3_CARCASS, outForFullLap: true });
        expect(b.tyres[corner].pressurePsi).toMatchObject({ value: known(32, 0), band: P25 });
      }
      expect(b.engineC).toEqual({ value: known(130, 0), state: NO_LIVE_STATE, band: known({ lo: 0, hi: 125 }, 0), outForFullLap: false, lapState: lapStateOf('in') });
    });

    it('only the car in its box stop is off: another car racing reads its live state', () => {
      const other = { ...hot, id: carId(1), ownCar: undefined };
      const view = situatedView({
        cars: [hot, other],
        history: { laps: [hotLap] },
        config: { [CAR_BANDS_CONFIG.key]: TEST_BANDS },
        spans: [openSpan('car-activity-race', 'boxStop', { car: 0 }), openSpan('car-activity-race', 'racingLap', { car: 1 }), ...humans(0, 1)],
      });
      const out = calc.compute(view);
      expect(out[carId(0)]!.engineC.state).toEqual(NO_LIVE_STATE);
      expect(out[carId(1)]!.engineC.state).toEqual(above);
    });

    // car-status decides (C43); Task 24 removed the transitional `car.active` these cases contradicted
    const statusOut = (kind: string) =>
      calc.compute(situatedView({ cars: [hot], config: { [CAR_BANDS_CONFIG.key]: TEST_BANDS }, status: { 0: kind }, spans: humans(0) }))[carId(0)];

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

  describe("bands per actual compound around the game's reference temperature (SP4.3c §5.6 A–C)", () => {
    type Slick = 'C1' | 'C2' | 'C3' | 'C4' | 'C5';
    const VISUAL = { C1: 'hard', C2: 'hard', C3: 'medium', C4: 'soft', C5: 'soft', inter: 'inter', wet: 'wet' } as const;
    /** A car on `actual` whose carcass is `c` °C on every corner, with a 23.5 psi setup, on the default config. */
    const on = (actual: Slick | 'inter' | 'wet', c = 95, laps: LapRecord[] = [], driver?: 'human' | 'ai' | 'none') =>
      bandsOf(
        withSetup(carState({ tyres: { visualCompound: VISUAL[actual], actualCompound: actual, corners: perCorner(() => ({ carcassTempC: known(c, 0) })) } }), 23.5),
        laps,
        { config: {}, ...(driver && { driver }) },
      );
    /** A lap on `actual` whose carcass ranged `min`-`max` on every corner. */
    const carcassLap = (actual: Slick | 'inter' | 'wet', min: number, max: number) =>
      lap({
        lapNumber: 3,
        visualCompound: VISUAL[actual],
        actualCompound: actual,
        channelRange: rangeOf({ tyres: perCorner(() => ({ surfaceC: known({ min: 60, max: 80 }, 0), carcassC: known({ min, max }, 0), pressurePsi: known({ min: 23, max: 24 }, 0) })) }),
      });

    it('the carcass band of each actual compound is its reference -20 ... +15 °C: C1 85-120, C2 75-110, C3 70-105, C4 65-100, C5 60-95, inter 45-80, wet 35-70', () => {
      const expected = { C1: [85, 120], C2: [75, 110], C3: [70, 105], C4: [65, 100], C5: [60, 95], inter: [45, 80], wet: [35, 70] } as const;
      for (const [actual, [lo, hi]] of Object.entries(expected)) {
        const b = on(actual as keyof typeof expected);
        for (const corner of corners) expect(b.tyres[corner].carcassC.band, actual).toEqual(known({ lo, hi }, 0));
      }
    });

    it('a C1 carcass at 110 °C is in band; a C3 carcass at 110 °C is above', () => {
      expect(on('C1', 110).tyres.fl.carcassC).toMatchObject({ band: known({ lo: 85, hi: 120 }, 0), state: { known: true, value: 'in' } });
      expect(on('C3', 110).tyres.fl.carcassC).toMatchObject({ band: known({ lo: 70, hi: 105 }, 0), state: { known: true, value: 'above' } });
    });

    it('the band follows the actual compound, not the sidewall colour: a soft that is C3 has the C3 band, a soft that is C5 the C5 band', () => {
      const soft = (actual: 'C3' | 'C5') => bandsOf(carState({ tyres: { visualCompound: 'soft', actualCompound: actual } }), [], { config: {} });
      expect(soft('C3').tyres.fl.carcassC.band).toEqual(known({ lo: 70, hi: 105 }, 0));
      expect(soft('C5').tyres.fl.carcassC.band).toEqual(known({ lo: 60, hi: 95 }, 0));
    });

    it('the judged lap is judged against the carcass band of the actual compound it was driven on: a C1 lap at 105-115 °C (110) is in, a C3 lap at the same is above', () => {
      for (const now of ['C3', 'C1'] as const) {
        expect(on(now, 95, [carcassLap('C1', 105, 115)]).tyres.rl.carcassC.lapState, now).toEqual(lapStateOf('in'));
        expect(on(now, 95, [carcassLap('C3', 105, 115)]).tyres.rl.carcassC.lapState, now).toEqual(lapStateOf('above'));
      }
    });

    it('an inter at 81 °C is out of band (above 45-80), live and on its judged lap, like every band', () => {
      const b = on('inter', 81, [carcassLap('inter', 80, 82)]);
      for (const corner of corners) {
        expect(b.tyres[corner].carcassC).toMatchObject({ value: known(81, 0), band: known({ lo: 45, hi: 80 }, 0), state: { known: true, value: 'above' }, lapState: lapStateOf('above') });
      }
      // 80 °C is the top of the band: still in
      expect(on('inter', 80).tyres.fl.carcassC.state).toMatchObject({ known: true, value: 'in' });
    });

    it('setup 23.5 psi on inters: the pressure band is 22.11-24.54 psi on every corner', () => {
      const b = on('inter');
      for (const corner of corners) {
        expect(b.tyres[corner].pressurePsi.band).toEqual(closeBand({ lo: 22.11, hi: 24.54 }, 2));
        expect(b.tyres[corner].pressurePsi.band).toEqual(closeBand(gasBand(23.5, TREF.inter)));
      }
    });

    it("the pressure band is the setup on the compound's carcass band: the same 23.5 psi setup gives each compound its own band", () => {
      for (const actual of ['C1', 'C2', 'C3', 'C4', 'C5', 'inter', 'wet'] as const) {
        expect(on(actual).tyres.fl.pressurePsi.band, actual).toEqual(closeBand(gasBand(23.5, TREF[actual])));
      }
    });

    it('the wet surface band is 30-55 °C; the slick surface stays 55-100 and the inter surface 30-85', () => {
      expect(on('wet').tyres.fl.surfaceC.band).toEqual(known({ lo: 30, hi: 55 }, 0));
      expect(on('C3').tyres.fl.surfaceC.band).toEqual(known({ lo: 55, hi: 100 }, 0));
      expect(on('inter').tyres.fl.surfaceC.band).toEqual(known({ lo: 30, hi: 85 }, 0));
      expect(CAR_BANDS_CONFIG.defaults).toMatchObject({ surfaceDryLo: 55, surfaceDryHi: 100, surfaceInterLo: 30, surfaceInterHi: 85, surfaceWetLo: 30, surfaceWetHi: 55 });
    });

    it('the config holds one reference per actual compound and the two carcass offsets; the per-kind carcass bands and the psi offsets are gone', () => {
      expect(CAR_BANDS_CONFIG.defaults).toMatchObject({
        refTempC1C: 105, refTempC2C: 95, refTempC3C: 90, refTempC4C: 85, refTempC5C: 80, refTempInterC: 65, refTempWetC: 55,
        carcassBelowRefC: 20, carcassAboveRefC: 15,
      });
      for (const gone of ['carcassDryLo', 'carcassDryHi', 'carcassInterLo', 'carcassInterHi', 'carcassWetLo', 'carcassWetHi', 'pressureBelowSetupPsi', 'pressureAboveSetupPsi']) {
        expect(CAR_BANDS_CONFIG.defaults).not.toHaveProperty(gone);
      }
    });

    it('a reference from the config moves both the carcass and the pressure band of its compound only', () => {
      const config = { [CAR_BANDS_CONFIG.key]: { refTempInterC: 75 } };
      const car = (actual: 'inter' | 'C3') => withSetup(carState({ tyres: { visualCompound: VISUAL[actual], actualCompound: actual } }), 23.5);
      const inter = bandsOf(car('inter'), [], { config }).tyres.fl;
      expect(inter.carcassC.band).toEqual(known({ lo: 55, hi: 90 }, 0));
      expect(inter.pressurePsi.band).toEqual(closeBand(gasBand(23.5, 75)));
      expect(bandsOf(car('C3'), [], { config }).tyres.fl.carcassC.band).toEqual(C3_CARCASS);
    });
  });

  describe('tyre bands on human-driven cars only (SP4.3c §5.6 D, C17)', () => {
    // carcass and pressure above their bands now, the surface too; the last lap a rate lap with every tyre channel above all lap
    const hotLap = lap({
      lapNumber: 2,
      channelRange: rangeOf({
        tyres: perCorner(() => ({ surfaceC: known({ min: 110, max: 120 }, 0), carcassC: known({ min: 115, max: 125 }, 0), pressurePsi: known({ min: 27, max: 29 }, 0) })),
        engineC: known({ min: 126, max: 140 }, 0),
      }),
    });
    const hot = withSetup(
      carState({
        tyres: { corners: perCorner(() => ({ surfaceTempC: known(120, 0), carcassTempC: known(120, 0), pressurePsi: known(32, 0) })) },
        condition: { engineTempC: known(130, 0) },
      }),
      25,
    );
    const NOT_JUDGED = { state: unknown('notApplicable'), band: unknown('notApplicable'), outForFullLap: false, lapState: NO_LAP_STATE };

    for (const driver of ['ai', 'none'] as const) {
      it(`${driver === 'ai' ? 'an AI car' : 'a car without a car-driver span'}: every tyre band notApplicable, the value kept; brakes and engine still judged`, () => {
        const b = bandsOf(hot, [hotLap], { driver });
        for (const corner of corners) {
          expect(b.tyres[corner].surfaceC).toEqual({ value: known(120, 0), ...NOT_JUDGED });
          expect(b.tyres[corner].carcassC).toEqual({ value: known(120, 0), ...NOT_JUDGED });
          expect(b.tyres[corner].pressurePsi).toEqual({ value: known(32, 0), ...NOT_JUDGED });
        }
        expect(b.engineC).toMatchObject({ band: known({ lo: 0, hi: 125 }, 0), state: { known: true, value: 'above' }, outForFullLap: true, lapState: lapStateOf('above') });
      });
    }

    it('a human car: the same values are judged on every tyre channel', () => {
      const b = bandsOf(hot, [hotLap], { driver: 'human' });
      for (const corner of corners) {
        expect(b.tyres[corner].carcassC).toMatchObject({ state: { known: true, value: 'above' }, outForFullLap: true, lapState: lapStateOf('above') });
        expect(b.tyres[corner].pressurePsi).toMatchObject({ band: P25, state: { known: true, value: 'above' }, outForFullLap: true, lapState: lapStateOf('above') });
        expect(b.tyres[corner].surfaceC).toMatchObject({ outForFullLap: true, lapState: lapStateOf('above') });
      }
    });

    it('per car: the human player is judged while the AI teammate beside it is not', () => {
      const ai = { ...hot, id: carId(1), ownCar: undefined };
      const view = situatedView({
        cars: [hot, ai],
        history: { laps: [hotLap, { ...hotLap, carId: carId(1) }] },
        config: { [CAR_BANDS_CONFIG.key]: TEST_BANDS },
        spans: [openSpan('car-driver', 'human', { car: 0 }), openSpan('car-driver', 'ai', { car: 1 })],
      });
      const out = calc.compute(view);
      expect(out[carId(0)]!.tyres.fl.carcassC.state).toMatchObject({ known: true, value: 'above' });
      expect(out[carId(1)]!.tyres.fl.carcassC).toMatchObject(NOT_JUDGED);
    });

    it('a car taken over by the AI mid-session: judged while human, notApplicable once its car-driver span is ai', () => {
      expect(bandsOf(hot, [hotLap], { driver: 'human' }).tyres.rr.carcassC.outForFullLap).toBe(true);
      expect(bandsOf(hot, [hotLap], { driver: 'ai' }).tyres.rr.carcassC.outForFullLap).toBe(false);
    });
  });
});
