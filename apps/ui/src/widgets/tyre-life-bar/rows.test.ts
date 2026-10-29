import { describe, expect, it } from 'vitest';
import { known, toSessionTime, unknown } from '@pitwall/domain';
import type { TyreWear } from '@pitwall/domain';
import { ageText, barColumns, tyreLifeRows } from './rows.ts';

const at = toSessionTime(10);
const c = (wearPct: number, rate: number, laps: number) => ({
  wearPct: known(wearPct, at),
  ratePctPerLap: known(rate, at),
  lapsToLimit: known(laps, at),
});
const base = (over: Partial<TyreWear['corners']> = {}, life: TyreWear['gameLifeSpanLaps'] = known(22, at)): TyreWear => ({
  corners: { fl: c(18, 2, 37.9), fr: c(21, 1.7, 29), rl: c(15, 1.2, 46), rr: c(17, 1.3, 41), ...over },
  limitPct: 70,
  warnLaps: 3,
  gameLifeSpanLaps: life,
});

describe('barColumns', () => {
  it('gives the bar what is left of the width after the fixed columns (27 cells)', () => {
    expect(barColumns(47)).toBe(20);
    expect(barColumns(36)).toBe(9);
  });

  it('keeps at least 4 cells', () => {
    expect(barColumns(20)).toBe(4);
    expect(barColumns(0)).toBe(4);
  });
});

describe('ageText', () => {
  it('counts laps', () => {
    expect(ageText(12)).toBe('12 laps old');
    expect(ageText(1)).toBe('1 lap old');
  });

  it('calls a fresh set new', () => {
    expect(ageText(0)).toBe('new');
  });
});

describe('tyreLifeRows', () => {
  it('has the corners in the order FL, FR, RL, RR with their labels', () => {
    const rows = tyreLifeRows(base(), 20);
    expect(rows.map((r) => r.corner)).toEqual(['fl', 'fr', 'rl', 'rr']);
    expect(rows.map((r) => r.label)).toEqual(['FL', 'FR', 'RL', 'RR']);
  });

  it('formats wear as a percentage, the rate to one decimal and the laps to the limit rounded down', () => {
    const fl = tyreLifeRows(base(), 20)[0]!;
    expect(fl.wearText).toBe('18%');
    expect(fl.rateText).toBe('2.0');
    expect(fl.lapsText).toBe('37');
    expect(fl.lapsToLimit).toEqual(known(37.9, at));
  });

  it('draws the bar over 0..100 % with the limit as `|`', () => {
    const fl = tyreLifeRows(base(), 20)[0]!;
    expect(fl.bar.kinds).toHaveLength(20);
    expect(fl.bar.kinds.slice(0, 4)).toEqual(['fill', 'fill', 'fill', 'fill']); // 18 % of 20 cells, rounded
    expect(fl.bar.kinds[14]).toBe('limit'); // 70 %
    expect(fl.bar.text[14]).toBe('|');
  });

  it("puts the game's life span as `:` at the wear the corner's rate reaches by then (rate x life span laps)", () => {
    const fl = tyreLifeRows(base(), 20)[0]!; // 2 %/lap x 22 laps = 44 %
    expect(fl.bar.kinds[8]).toBe('marker');
    expect(fl.bar.text[8]).toBe(':');
    expect(fl.bar.kinds.filter((k) => k === 'marker')).toHaveLength(1);
  });

  it('draws no marker when the game gives no life span', () => {
    const fl = tyreLifeRows(base({}, unknown('notReceived')), 20)[0]!;
    expect(fl.bar.kinds).not.toContain('marker');
  });

  it('leaves the bar tail empty when the rate is unknown: no marker, only the limit past the fill', () => {
    const rows = tyreLifeRows(
      base({ fl: { wearPct: known(18, at), ratePctPerLap: unknown('insufficientData'), lapsToLimit: unknown('insufficientData') } }),
      20,
    );
    const fl = rows[0]!;
    expect(fl.bar.kinds).not.toContain('marker');
    expect(fl.bar.kinds.slice(0, 4)).toEqual(['fill', 'fill', 'fill', 'fill']);
    const tail = fl.bar.kinds.slice(4).map((k, i) => (i + 4 === 14 ? 'limit' : k));
    expect(tail.every((k) => k === 'empty' || k === 'limit')).toBe(true);
    expect(fl.bar.kinds[14]).toBe('limit');
    expect(fl.rateText).toBe('');
    expect(fl.lapsText).toBe('');
    expect(fl.reasons).toEqual({ wear: undefined, rate: 'insufficientData', laps: 'insufficientData' });
    // The other corners are untouched.
    expect(rows[1]!.bar.kinds).toContain('marker');
  });

  it('shows an unknown wear as an empty cell with its reason and an unfilled bar', () => {
    const hidden = { wearPct: unknown('realism'), ratePctPerLap: unknown('realism'), lapsToLimit: unknown('realism') };
    const fl = tyreLifeRows(base({ fl: hidden }), 20)[0]!;
    expect(fl.wearText).toBe('');
    expect(fl.rateText).toBe('');
    expect(fl.lapsText).toBe('');
    expect(fl.bar.kinds).not.toContain('fill');
    expect(fl.reasons).toEqual({ wear: 'realism', rate: 'realism', laps: 'realism' });
  });

  it('sizes the bar to the columns it is given', () => {
    expect(tyreLifeRows(base(), 9)[0]!.bar.kinds).toHaveLength(9);
  });
});
