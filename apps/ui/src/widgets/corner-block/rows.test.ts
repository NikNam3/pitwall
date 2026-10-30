import { describe, expect, it } from 'vitest';
import { known, unknown } from '@pitwall/domain';
import type { BandReading, CarBands, CarState, Corners, Known, TyreWear } from '@pitwall/domain';
import { CAR_FIELDS, compactBrake, cornerBlockRows, fullHeader, fullRowFields, fullRowText, worstBrake } from './rows.ts';

const k = <T>(v: T): Known<T> => known(v, 0);
const BAND = { lo: 80, hi: 100 };
const BRAKE_BAND = { lo: 300, hi: 1000 };
const rd = (value: Known<number>, over: Partial<BandReading> = {}): BandReading => ({
  value, state: value.known ? k('in') : value, band: BAND, outForFullLap: false, ...over,
});
const four = <T>(f: (name: keyof Corners<unknown>) => T): Corners<T> => ({ fl: f('fl'), fr: f('fr'), rl: f('rl'), rr: f('rr') });

type Over = { carcass?: Known<number>; brake?: Partial<Record<keyof Corners<unknown>, Known<number>>>; engine?: Known<number> };

function car(over: Over = {}): CarState {
  return {
    tyres: {
      corners: four((n) => ({
        surfaceTempC: k(n === 'fr' ? 104 : 98),
        carcassTempC: over.carcass ?? k(n === 'fr' ? 109 : 101),
        pressurePsi: k(23.14),
        wearPct: k(0),
      })),
    },
    condition: {
      brakes: four((n) => ({ tempC: over.brake?.[n] ?? k(n === 'fr' ? 1043 : 812), damagePct: k(0) })),
      engineTempC: over.engine ?? k(112),
    },
  } as unknown as CarState;
}

/** The surface and the brakes have no live state, as `car-bands` gives them (judged per lap only: rulings 2026-10-30). */
const surface = (value: Known<number>, over: Partial<BandReading> = {}) => rd(value, { state: unknown('notApplicable'), ...over });
const brake = (value: Known<number>, over: Partial<BandReading> = {}) => rd(value, { state: unknown('notApplicable'), band: BRAKE_BAND, ...over });

function bands(over: { fr?: Partial<CarBands['tyres']['fr']>; brakes?: Partial<CarBands['brakesC']>; engine?: BandReading } = {}): CarBands {
  return {
    tyres: four((n) => ({ surfaceC: surface(k(98)), carcassC: rd(k(101)), pressurePsi: rd(k(23.1)), ...(n === 'fr' ? over.fr : {}) })),
    brakesC: { ...four(() => brake(k(812))), ...over.brakes },
    engineC: over.engine ?? rd(k(112)),
  };
}

const wear = (over: Partial<Corners<Known<number>>> = {}): TyreWear => ({
  corners: four((n) => ({
    wearPct: over[n] ?? k(n === 'fr' ? 21 : 18), ratePctPerLap: k(1.5), lapsToLimit: k(30),
  })),
  limitPct: 70,
  warnLaps: 3,
  gameLifeSpanLaps: k(25),
});

describe('cornerBlockRows', () => {
  it('gives `text` for the full table: plain numbers (the unit is in the column header), wear with %, engine with its unit', () => {
    const rows = cornerBlockRows(car(), bands(), wear());
    expect(rows.corners.fr).toMatchObject({
      surface: { text: '104' }, carcass: { text: '109' }, pressure: { text: '23.1' }, brake: { text: '1043' }, wear: { text: '21%' },
    });
    expect(rows.engine).toMatchObject({ text: '112 °C' });
  });

  it('gives `compactText` for the compact view: surface with a degree sign, brake and engine plain, wear with %', () => {
    const rows = cornerBlockRows(car(), bands(), wear());
    expect(rows.corners.fr).toMatchObject({ surface: { compactText: '104°' }, brake: { compactText: '1043' }, wear: { compactText: '21%' } });
    expect(rows.engine).toMatchObject({ compactText: '112' });
  });

  it('takes values from car.detail and roles from the band readings; wear has no role', () => {
    const rows = cornerBlockRows(
      car(),
      bands({ fr: { carcassC: rd(k(109), { state: k('above') }) }, brakes: { fr: brake(k(1043), { outForFullLap: true }) } }),
      wear(),
    );
    expect(rows.corners.fr.carcass.role).toBe('warning');
    expect(rows.corners.fr.brake.role).toBe('critical');
    expect(rows.corners.fr.surface.role).toBeUndefined();
    expect(rows.corners.fr.wear.role).toBeUndefined();
    expect(rows.corners.fl.carcass.role).toBeUndefined();
  });

  it('colours the surface only for a whole lap out of band: no live state gives no role, outForFullLap gives critical', () => {
    const rows = cornerBlockRows(car(), bands({ fr: { surfaceC: surface(k(104), { outForFullLap: true }) } }), wear());
    expect(rows.corners.fr.surface.role).toBe('critical');
    expect(rows.corners.fl.surface.role).toBeUndefined();
  });

  it('colours a brake only for a whole lap out of band: a live value outside the band no longer warns, outForFullLap gives critical', () => {
    const rows = cornerBlockRows(
      car({ brake: { fl: k(278), fr: k(1043), rl: k(278) } }),
      bands({ brakes: { fl: brake(k(278)), fr: brake(k(1043)), rl: brake(k(278), { outForFullLap: true }) } }),
      wear(),
    );
    expect(rows.corners.fl.brake.role).toBeUndefined();
    expect(rows.corners.fr.brake.role).toBeUndefined();
    expect(rows.corners.rl.brake.role).toBe('critical');
    expect(rows.corners.rr.brake.role).toBeUndefined();
  });

  it('gives the engine its band role', () => {
    const rows = cornerBlockRows(car(), bands({ engine: rd(k(112), { state: k('above') }) }), wear());
    expect(rows.engine.role).toBe('warning');
  });

  it('renders a carcass that is notApplicable as an empty cell with its reason, in every corner', () => {
    const rows = cornerBlockRows(car({ carcass: unknown('notApplicable') }), bands(), wear());
    for (const name of ['fl', 'fr', 'rl', 'rr'] as const) {
      expect(rows.corners[name].carcass).toMatchObject({ text: '', compactText: '', reason: 'notApplicable' });
      expect(rows.corners[name].surface.text).not.toBe('');
    }
  });

  it('keeps the grid whole when the carcass is empty: the other cells stay in their columns', () => {
    const rows = cornerBlockRows(car({ carcass: unknown('notApplicable') }), bands(), wear());
    expect(fullRowText('fl', rows.corners.fl)).toBe('FL    98        23.1    812   18%');
    expect(fullRowText('fl', rows.corners.fl)).toHaveLength(fullHeader().length);
  });

  it('hides a value with its reason: empty text, reason kept', () => {
    const rows = cornerBlockRows(car({ engine: unknown('realism') }), bands(), wear({ rl: unknown('insufficientData') }));
    expect(rows.engine).toMatchObject({ text: '', compactText: '', reason: 'realism' });
    expect(rows.corners.rl.wear).toMatchObject({ text: '', reason: 'insufficientData' });
    expect(rows.corners.fl.wear.reason).toBeUndefined();
  });

  it('carries the raw value with every cell', () => {
    const rows = cornerBlockRows(car({ engine: unknown('realism') }), bands(), wear());
    expect(rows.corners.fr.brake.value).toEqual(k(1043));
    expect(rows.engine.value).toEqual(unknown('realism'));
  });

  it('has no reason on a known value', () => {
    expect(cornerBlockRows(car(), bands(), wear()).corners.fl.surface.reason).toBeUndefined();
  });
});

describe('staleness of the car fields', () => {
  const frOut = bands({ fr: { carcassC: rd(k(109), { state: k('above') }) }, brakes: { fr: brake(k(1043), { outForFullLap: true }) } });

  it('lists every car field it reads, so the display can ask the panel which are stale', () => {
    expect([...CAR_FIELDS].sort()).toEqual(
      ['condition.brakes.tempC', 'condition.engineTempC', 'tyres.corners.carcassTempC', 'tyres.corners.pressurePsi', 'tyres.corners.surfaceTempC'].sort(),
    );
  });

  it('marks a cell of a stale field stale and faint: an out-of-band value stays no longer amber or red', () => {
    const rows = cornerBlockRows(car(), frOut, wear(), (f) => f === 'tyres.corners.carcassTempC' || f === 'condition.brakes.tempC');
    expect(rows.corners.fr.carcass).toMatchObject({ text: '109', stale: true, role: 'textFaint' });
    expect(rows.corners.fr.brake).toMatchObject({ text: '1043', stale: true, role: 'textFaint' });
    expect(rows.corners.fr.surface.stale).toBeUndefined();
    expect(rows.corners.fr.wear.stale).toBeUndefined();
  });

  it('keeps the band roles while every field is fresh (the default)', () => {
    const rows = cornerBlockRows(car(), frOut, wear());
    expect(rows.corners.fr.carcass.role).toBe('warning');
    expect(rows.corners.fr.brake.role).toBe('critical');
    expect(rows.corners.fr.brake.stale).toBeUndefined();
  });
});

describe('full text layout', () => {
  it('has a header over fixed fields', () => {
    expect(fullHeader()).toBe('    SURF  CARC   PSI  BRAKE  WEAR');
  });

  it('right-aligns numbers in fixed fields so the rows line up', () => {
    const rows = cornerBlockRows(car(), bands(), wear());
    expect(fullRowText('fl', rows.corners.fl)).toBe('FL    98   101  23.1    812   18%');
    expect(fullRowText('fr', rows.corners.fr)).toBe('FR   104   109  23.1   1043   21%');
  });

  it('gives the fields the display renders: the fitted texts that join to fullRowText, each value with its cell', () => {
    const rows = cornerBlockRows(car(), bands(), wear());
    const fields = fullRowFields('fr', rows.corners.fr);
    expect(fields.map((f) => f.text).join(' ')).toBe(fullRowText('fr', rows.corners.fr));
    expect(fields[0]).toEqual({ text: 'FR' });
    expect(fields.slice(1).map((f) => f.cell)).toEqual([rows.corners.fr.surface, rows.corners.fr.carcass, rows.corners.fr.pressure, rows.corners.fr.brake, rows.corners.fr.wear]);
  });
});

describe('worstBrake', () => {
  it('picks the hottest brake when none is out of band', () => {
    const rows = cornerBlockRows(car({ brake: { rr: k(870) } }), bands(), wear());
    expect(worstBrake(rows)).toMatchObject({ corner: 'fr', cell: { text: '1043', compactText: '1043' } });
    const cooler = cornerBlockRows(car({ brake: { fr: k(700), rr: k(870) } }), bands(), wear());
    expect(worstBrake(cooler)?.corner).toBe('rr');
  });

  it('prefers a critical brake over a hotter one that was not out for a whole lap', () => {
    const rows = cornerBlockRows(
      car({ brake: { fl: k(290), rr: k(950) } }),
      bands({ brakes: { fl: brake(k(290), { outForFullLap: true }) } }),
      wear(),
    );
    expect(worstBrake(rows)?.corner).toBe('fl');
  });

  it('prefers warning over in band, and critical over warning', () => {
    const warn = cornerBlockRows(car(), bands({ brakes: { rl: rd(k(812), { state: k('above') }) } }), wear());
    expect(worstBrake(warn)?.corner).toBe('rl');
    const crit = cornerBlockRows(
      car(),
      bands({ brakes: { rl: rd(k(812), { state: k('above') }), rr: rd(k(812), { outForFullLap: true }) } }),
      wear(),
    );
    expect(worstBrake(crit)?.corner).toBe('rr');
  });

  it('breaks a role tie by the hotter brake', () => {
    const rows = cornerBlockRows(
      car({ brake: { fl: k(1050), rl: k(1090) } }),
      bands({ brakes: { fl: brake(k(1050), { outForFullLap: true }), rl: brake(k(1090), { outForFullLap: true }) } }),
      wear(),
    );
    expect(worstBrake(rows)?.corner).toBe('rl');
  });

  it('ranks by the raw temperature, not by its rounded text', () => {
    const rows = cornerBlockRows(car({ brake: { fl: k(1043.2), fr: k(1043.4) } }), bands(), wear());
    expect(worstBrake(rows)?.corner).toBe('fr');
  });

  it('skips hidden brakes and is undefined when all are hidden', () => {
    const some = cornerBlockRows(car({ brake: { fr: unknown('realism') } }), bands(), wear());
    expect(worstBrake(some)?.corner).not.toBe('fr');
    const none = cornerBlockRows(
      car({ brake: four(() => unknown('realism')) }),
      bands(),
      wear(),
    );
    expect(worstBrake(none)).toBeUndefined();
  });
});

describe('compactBrake', () => {
  it('names the worst brake and its compact value', () => {
    const rows = cornerBlockRows(car(), bands({ brakes: { fr: brake(k(1043), { outForFullLap: true }) } }), wear());
    expect(compactBrake(rows)).toMatchObject({ text: 'FR 1043', cell: { role: 'critical' } });
  });

  it('is empty with the reason when every brake is hidden', () => {
    const rows = cornerBlockRows(car({ brake: four(() => unknown('realism')) }), bands(), wear());
    expect(compactBrake(rows)).toMatchObject({ text: '', cell: { reason: 'realism' } });
  });
});
