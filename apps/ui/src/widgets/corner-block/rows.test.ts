import { describe, expect, it } from 'vitest';
import { known, unknown } from '@pitwall/domain';
import type { BandReading, CarBands, CarState, Corners, Known, TyreWear } from '@pitwall/domain';
import { cornerBlockRows, fullHeader, fullRowText, worstBrake } from './rows.ts';

const k = <T>(v: T): Known<T> => known(v, 0);
const BAND = { lo: 80, hi: 100 };
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

function bands(over: { fr?: Partial<CarBands['tyres']['fr']>; brakes?: Partial<CarBands['brakesC']>; engine?: BandReading } = {}): CarBands {
  return {
    tyres: four((n) => ({ surfaceC: rd(k(98)), carcassC: rd(k(101)), pressurePsi: rd(k(23.1)), ...(n === 'fr' ? over.fr : {}) })),
    brakesC: { ...four(() => rd(k(812))), ...over.brakes },
    engineC: over.engine ?? rd(k(112)),
  };
}

const wear = (over: Partial<Corners<Known<number>>> = {}): TyreWear => ({
  corners: four((n) => ({
    wearPct: over[n] ?? k(n === 'fr' ? 21 : 18), ratePctPerLap: k(1.5), lapsToLimit: k(30),
  })),
  limitPct: 70,
  gameLifeSpanLaps: k(25),
});

describe('cornerBlockRows', () => {
  it('formats each channel with the centralised formats: whole degrees, one-decimal psi, whole percent', () => {
    const rows = cornerBlockRows(car(), bands(), wear());
    expect(rows.corners.fr).toMatchObject({
      surface: { text: '104°' }, carcass: { text: '109°' }, pressure: { text: '23.1' }, brake: { text: '1043°' }, wear: { text: '21%' },
    });
    expect(rows.engine).toMatchObject({ text: '112°' });
  });

  it('takes values from car.detail and roles from the band readings; wear has no role', () => {
    const rows = cornerBlockRows(
      car(),
      bands({ fr: { carcassC: rd(k(109), { state: k('above') }) }, brakes: { fr: rd(k(1043), { state: k('above'), outForFullLap: true }) } }),
      wear(),
    );
    expect(rows.corners.fr.carcass.role).toBe('warning');
    expect(rows.corners.fr.brake.role).toBe('critical');
    expect(rows.corners.fr.surface.role).toBeUndefined();
    expect(rows.corners.fr.wear.role).toBeUndefined();
    expect(rows.corners.fl.carcass.role).toBeUndefined();
  });

  it('gives the engine its band role', () => {
    const rows = cornerBlockRows(car(), bands({ engine: rd(k(112), { state: k('above') }) }), wear());
    expect(rows.engine.role).toBe('warning');
  });

  it('renders a carcass that is notApplicable as an empty cell with its reason, in every corner', () => {
    const rows = cornerBlockRows(car({ carcass: unknown('notApplicable') }), bands(), wear());
    for (const name of ['fl', 'fr', 'rl', 'rr'] as const) {
      expect(rows.corners[name].carcass).toMatchObject({ text: '', reason: 'notApplicable' });
      expect(rows.corners[name].surface.text).not.toBe('');
    }
  });

  it('keeps the grid whole when the carcass is empty: the other cells stay in their columns', () => {
    const rows = cornerBlockRows(car({ carcass: unknown('notApplicable') }), bands(), wear());
    expect(fullRowText('fl', rows.corners.fl)).toBe('FL   98°        23.1   812°   18%');
    expect(fullRowText('fl', rows.corners.fl)).toHaveLength(fullHeader().length);
  });

  it('hides a value with its reason: empty text, reason kept', () => {
    const rows = cornerBlockRows(car({ engine: unknown('realism') }), bands(), wear({ rl: unknown('insufficientData') }));
    expect(rows.engine).toMatchObject({ text: '', reason: 'realism' });
    expect(rows.corners.rl.wear).toMatchObject({ text: '', reason: 'insufficientData' });
    expect(rows.corners.fl.wear.reason).toBeUndefined();
  });

  it('has no reason on a known value', () => {
    expect(cornerBlockRows(car(), bands(), wear()).corners.fl.surface.reason).toBeUndefined();
  });
});

describe('full text layout', () => {
  it('has a header over fixed fields', () => {
    expect(fullHeader()).toBe('    SURF  CARC   PSI  BRAKE  WEAR');
  });

  it('right-aligns numbers in fixed fields so the rows line up', () => {
    const rows = cornerBlockRows(car(), bands(), wear());
    expect(fullRowText('fl', rows.corners.fl)).toBe('FL   98°  101°  23.1   812°   18%');
    expect(fullRowText('fr', rows.corners.fr)).toBe('FR  104°  109°  23.1  1043°   21%');
  });
});

describe('worstBrake', () => {
  it('picks the hottest brake when none is out of band', () => {
    const rows = cornerBlockRows(car({ brake: { rr: k(870) } }), bands(), wear());
    expect(worstBrake(rows)).toMatchObject({ corner: 'fr', cell: { text: '1043°' } });
    const cooler = cornerBlockRows(car({ brake: { fr: k(700), rr: k(870) } }), bands(), wear());
    expect(worstBrake(cooler)?.corner).toBe('rr');
  });

  it('prefers a critical brake over a hotter one that is only in band', () => {
    const rows = cornerBlockRows(
      car({ brake: { fl: k(300), rr: k(950) } }),
      bands({ brakes: { fl: rd(k(300), { state: k('below'), outForFullLap: true }) } }),
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
      car({ brake: { fl: k(950), rl: k(990) } }),
      bands({ brakes: { fl: rd(k(950), { state: k('above') }), rl: rd(k(990), { state: k('above') }) } }),
      wear(),
    );
    expect(worstBrake(rows)?.corner).toBe('rl');
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
