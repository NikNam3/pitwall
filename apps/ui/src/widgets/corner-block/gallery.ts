// Gallery declaration of the corner-block display (spec 9.1). Test-phase file: the implementer does not edit it.
import type { BandReading, BandState, CarBands, TyreWear } from '@pitwall/domain';
import { known, unknown } from '@pitwall/domain';
import type { CarState, Corners, Known, UnknownReason } from '@pitwall/domain';
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import type { widget } from './widget.ts';

const at = 10;
const k = <T>(value: T): Known<T> => known(value, at);

const reading = (value: Known<number>, band: { lo: number; hi: number }, state: Known<BandState>, outForFullLap = false): BandReading => ({
  value, state, band, outForFullLap,
});
const inBand = (value: number, band: { lo: number; hi: number }): BandReading => reading(k(value), band, k('in'));

const SURFACE = { lo: 80, hi: 105 };
const CARCASS = { lo: 85, hi: 105 };
const PRESSURE = { lo: 22.5, hi: 24 };
const BRAKE = { lo: 300, hi: 900 };
const ENGINE = { lo: 80, hi: 120 };
/** The surface and the brakes have no live state: `car-bands` judges them per lap only (rulings 2026-10-30). */
const surfaceOf = (value: number): BandReading => reading(k(value), SURFACE, unknown('notApplicable'));
const brakeOf = (value: number, outForFullLap = false): BandReading => reading(k(value), BRAKE, unknown('notApplicable'), outForFullLap);


type Temps = { surface: number; carcass: Known<number>; psi: number; brake: number; wear: number };
const fl: Temps = { surface: 98, carcass: k(101), psi: 23.1, brake: 812, wear: 18 };
const fr: Temps = { surface: 104, carcass: k(109), psi: 23.4, brake: 1043, wear: 21 };
const rl: Temps = { surface: 95, carcass: k(99), psi: 22.6, brake: 534, wear: 15 };
const rr: Temps = { surface: 97, carcass: k(102), psi: 22.8, brake: 561, wear: 17 };
const healthy: Corners<Temps> = { fl, fr: { ...fr, surface: 100, carcass: k(103), brake: 840 }, rl, rr };
const surfaceOnly: Corners<Temps> = {
  fl: { ...fl, carcass: unknown('notApplicable') }, fr: { ...healthy.fr, carcass: unknown('notApplicable') },
  rl: { ...rl, carcass: unknown('notApplicable') }, rr: { ...rr, carcass: unknown('notApplicable') },
};

/** A partial CarState: only the fields the corner block reads (tyre corners, brakes, engine). */
function carOf(t: Corners<Temps>, hidden?: UnknownReason): CarState {
  const v = (n: number): Known<number> => (hidden ? unknown(hidden) : k(n));
  const tyre = (c: Temps) => ({
    surfaceTempC: v(c.surface), carcassTempC: hidden ? unknown(hidden) : c.carcass, pressurePsi: v(c.psi), wearPct: v(c.wear),
  });
  const brake = (c: Temps) => ({ tempC: v(c.brake), damagePct: v(0) });
  return {
    tyres: { corners: { fl: tyre(t.fl), fr: tyre(t.fr), rl: tyre(t.rl), rr: tyre(t.rr) } },
    condition: { brakes: { fl: brake(t.fl), fr: brake(t.fr), rl: brake(t.rl), rr: brake(t.rr) }, engineTempC: v(112) },
  } as unknown as CarState;
}

function bandsOf(t: Corners<Temps>, over: { fr?: Partial<CarBands['tyres']['fr']>; frBrake?: BandReading } = {}): CarBands {
  const tyre = (c: Temps) => ({
    surfaceC: surfaceOf(c.surface),
    carcassC: c.carcass.known ? inBand(c.carcass.value, CARCASS) : reading(unknown('notApplicable'), CARCASS, unknown('notApplicable')),
    pressurePsi: inBand(c.psi, PRESSURE),
  });
  return {
    tyres: { fl: tyre(t.fl), fr: { ...tyre(t.fr), ...over.fr }, rl: tyre(t.rl), rr: tyre(t.rr) },
    brakesC: {
      fl: brakeOf(t.fl.brake), fr: over.frBrake ?? brakeOf(t.fr.brake), rl: brakeOf(t.rl.brake), rr: brakeOf(t.rr.brake),
    },
    engineC: inBand(112, ENGINE),
  };
}

const wearOf = (t: Corners<Temps>, known_ = true): TyreWear => {
  const c = (w: number) => ({
    wearPct: known_ ? k(w) : unknown('insufficientData'),
    ratePctPerLap: known_ ? k(1.5) : unknown('insufficientData'),
    lapsToLimit: known_ ? k(30) : unknown('insufficientData'),
  });
  return { corners: { fl: c(t.fl.wear), fr: c(t.fr.wear), rl: c(t.rl.wear), rr: c(t.rr.wear) }, limitPct: 70, warnLaps: 3, gameLifeSpanLaps: k(25) };
};

const frCarcassHigh = reading(k(109), CARCASS, k('above'));
const frBrakeCritical = brakeOf(1043, true);

/** Synthetic cases and fit expectations for `corner-block`. */
const gallery: GalleryEntry<typeof widget> = {
  moments: ['raceSingaporeStart.grid', 'raceSingaporeEnd.chequered'],
  cases: {
    // Mockup: FR carcass out of band (amber), FR brake out for a full lap (red).
    outOfBand: {
      bands: bandsOf({ ...healthy, fr }, { fr: { carcassC: frCarcassHigh }, frBrake: frBrakeCritical }),
      wear: wearOf({ ...healthy, fr }),
      car: carOf({ ...healthy, fr }),
    },
    allInBand: { bands: bandsOf(healthy), wear: wearOf(healthy), car: carOf(healthy) },
    // Surface-only tyre temperatures: the carcass column stays, empty, with the reason on hover.
    carcassNotApplicable: { bands: bandsOf(surfaceOnly), wear: wearOf(surfaceOnly), car: carOf(surfaceOnly) },
    // A rival linked as primary in realism mode: every value is hidden.
    realismHidden: { bands: bandsOf(healthy), wear: wearOf(healthy, false), car: carOf(healthy, 'realism') },
    wearUnknown: { bands: bandsOf(healthy), wear: wearOf(healthy, false), car: carOf(healthy) },
  },
  fit: [
    { mode: 'compact', cols: 26, rows: 3 },
    { mode: 'compact', cols: 35, rows: 5 },
    { mode: 'compact', cols: 43, rows: 6 },
    { mode: 'full', cols: 44, rows: 7 },
    { mode: 'full', cols: 60, rows: 9 },
  ],
};

export default gallery;
