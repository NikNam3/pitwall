import { describe, expect, it } from 'vitest';
import type { FuelState } from '@pitwall/domain';
import { known, toSessionTime, unknown } from '@pitwall/domain';
import { fuelRows } from './rows.ts';

const at = toSessionTime(10);

const positive: FuelState = {
  kg: known(31.4, at),
  burnKgPerLap: known(1.62, at),
  lapsOfFuel: known(19.4, at),
  lapsLeft: known(17.6, at),
  marginLaps: known(1.8, at),
  saveTargetKgPerLap: unknown('notApplicable'),
  gameRemainingLaps: known(1.6, at),
  mix: known('standard', at),
};

const negative: FuelState = {
  ...positive,
  kg: known(26.2, at),
  burnKgPerLap: known(1.71, at),
  lapsOfFuel: known(15.3, at),
  lapsLeft: known(16, at),
  marginLaps: known(-0.7, at),
  saveTargetKgPerLap: known(0.07, at),
  gameRemainingLaps: known(-0.4, at),
};

const byKey = (fuel: FuelState) => Object.fromEntries(fuelRows(fuel).map((r) => [r.key, r]));

describe('fuelRows', () => {
  it('lists the rows in the mockup order with their labels', () => {
    expect(fuelRows(positive).map((r) => [r.key, r.label])).toEqual([
      ['margin', 'MARGIN'], ['lasts', 'LASTS'], ['toGo', 'TO GO'], ['burn', 'BURN'], ['save', 'SAVE'], ['game', 'GAME'],
    ]);
  });

  it('formats the positive case as in the mockup', () => {
    const r = byKey(positive);
    expect(r.margin?.text).toBe('+1.8 laps');
    expect(r.lasts?.text).toBe('19.4 laps (31.4 kg)');
    expect(r.toGo?.text).toBe('17.6 laps');
    expect(r.burn?.text).toBe('1.62 kg/lap');
    expect(r.game?.text).toBe('+1.6 laps margin');
  });

  it('formats the negative case with a true minus and shows the save target', () => {
    const r = byKey(negative);
    expect(r.margin?.text).toBe('−0.7 laps');
    expect(r.lasts?.text).toBe('15.3 laps (26.2 kg)');
    expect(r.save?.text).toBe('0.07 kg/lap');
    expect(r.game?.text).toBe('−0.4 laps margin');
  });

  it('leaves the save target empty, with its reason, when not applicable', () => {
    const save = byKey(positive).save;
    expect(save?.text).toBe('');
    expect(save?.reason).toBe('notApplicable');
  });

  it('makes the margin row bold, and red only when the margin is negative', () => {
    expect(byKey(positive).margin).toMatchObject({ bold: true, role: undefined });
    expect(byKey(negative).margin).toMatchObject({ bold: true, role: 'critical' });
  });

  it('dims the game row and labels it as the game figure; no other row is dim', () => {
    const rows = byKey(positive);
    expect(rows.game).toMatchObject({ label: 'GAME', dim: true });
    for (const key of ['margin', 'lasts', 'toGo', 'burn', 'save']) expect(rows[key]?.dim).toBeFalsy();
  });

  it('gives an empty cell with the reason for each unknown figure', () => {
    const r = byKey({
      ...positive,
      kg: unknown('realism'),
      burnKgPerLap: unknown('insufficientData'),
      lapsOfFuel: unknown('realism'),
      marginLaps: unknown('insufficientData'),
      gameRemainingLaps: unknown('notReceived'),
    });
    expect(r.margin).toMatchObject({ text: '', reason: 'insufficientData' });
    expect(r.lasts).toMatchObject({ text: '', reason: 'realism' });
    expect(r.burn).toMatchObject({ text: '', reason: 'insufficientData' });
    expect(r.game).toMatchObject({ text: '', reason: 'notReceived' });
  });

  it('keeps the laps when only the kg are unknown, and shows nothing for the kg alone', () => {
    expect(byKey({ ...positive, kg: unknown('realism') }).lasts).toEqual({ key: 'lasts', label: 'LASTS', text: '19.4 laps' });
    expect(byKey({ ...positive, lapsOfFuel: unknown('realism') }).lasts).toMatchObject({ text: '', reason: 'realism' });
  });

  it('shows no role on the other rows', () => {
    const r = byKey(negative);
    for (const key of ['lasts', 'toGo', 'burn', 'save', 'game']) expect(r[key]?.role).toBeUndefined();
  });
});
