import { describe, expect, it } from 'vitest';
import { known, unknown } from '@pitwall/domain';
import type { Corners, DamageJump, DamageParts, DamageState } from '@pitwall/domain';
import { damageRows } from './rows.ts';

const PARTS: DamageParts = {
  frontLeftWingPct: 12, frontRightWingPct: 0, rearWingPct: 0, floorPct: 4, diffuserPct: 0, sidepodPct: 2, gearboxPct: 8, enginePct: 11,
};
const corner = (tyre: number, brake: number) => ({ tyrePct: known(tyre, 0), brakePct: known(brake, 0) });
const CORNERS: Corners<{ tyrePct: ReturnType<typeof known<number>>; brakePct: ReturnType<typeof known<number>> }> = {
  fl: corner(3, 0), fr: corner(1, 0), rl: corner(0, 0), rr: corner(0, 0),
};
const wing: DamageJump = { at: 200_000, lap: 14, parts: ['frontLeftWingPct'], deltaPct: 12, lossMsPerLap: unknown('insufficientData') };
const floor: DamageJump = { at: 100_000, lap: 9, parts: ['floorPct'], deltaPct: 4, lossMsPerLap: known(120, 150_000) };

const state = (over: Partial<DamageState> = {}): DamageState => ({
  parts: known(PARTS, 0), corners: CORNERS, drsFault: known(false, 0), ersFault: false, jumps: [], ...over,
});

describe('damageRows parts', () => {
  it('gives each part as a percentage text', () => {
    const { parts } = damageRows(state());
    expect(parts.wingL).toMatchObject({ text: '12%' });
    expect(parts.wingR).toMatchObject({ text: '0%' });
    expect(parts.wingRear).toMatchObject({ text: '0%' });
    expect(parts.floor).toMatchObject({ text: '4%' });
    expect(parts.diffuser).toMatchObject({ text: '0%' });
    expect(parts.sidepod).toMatchObject({ text: '2%' });
    expect(parts.gearbox).toMatchObject({ text: '8%' });
    expect(parts.engine).toMatchObject({ text: '11%' });
  });

  it('hides every part with the reason when the parts are unknown', () => {
    const { parts } = damageRows(state({ parts: unknown('realism') }));
    for (const cell of Object.values(parts)) expect(cell).toMatchObject({ text: '', reason: 'realism' });
  });
});

describe('damageRows corners', () => {
  it('gives tyre and brake damage per corner', () => {
    const { corners } = damageRows(state());
    expect(corners.fl).toMatchObject({ tyre: { text: '3%' }, brake: { text: '0%' } });
    expect(corners.fr.tyre.text).toBe('1%');
  });

  it('hides one unknown value with its reason and keeps the others', () => {
    const { corners } = damageRows(state({ corners: { ...CORNERS, rl: { tyrePct: unknown('notReceived'), brakePct: known(5, 0) } } }));
    expect(corners.rl.tyre).toMatchObject({ text: '', reason: 'notReceived' });
    expect(corners.rl.brake.text).toBe('5%');
  });
});

describe('damageRows faults', () => {
  it('lists no fault when there is none', () => {
    expect(damageRows(state()).faults).toEqual([]);
  });

  it('lists the DRS fault and the ERS fault', () => {
    expect(damageRows(state({ drsFault: known(true, 0) })).faults).toEqual(['DRS fault']);
    expect(damageRows(state({ ersFault: true })).faults).toEqual(['ERS fault']);
    expect(damageRows(state({ drsFault: known(true, 0), ersFault: true })).faults).toEqual(['DRS fault', 'ERS fault']);
  });

  it('lists no DRS fault when the flag is hidden', () => {
    expect(damageRows(state({ drsFault: unknown('realism') })).faults).toEqual([]);
  });
});

describe('damageRows jumps', () => {
  it('lists the jumps newest first, whatever the input order', () => {
    for (const jumps of [[floor, wing], [wing, floor]]) {
      const rows = damageRows(state({ jumps })).jumps;
      expect(rows.map((r) => r.text)).toEqual(['L14 FL wing +12 %', 'L09 floor +4 %']);
    }
  });

  it('shows "loss: measuring" and a critical role for the newest jump while the loss is unknown', () => {
    const [newest, older] = damageRows(state({ jumps: [floor, wing] })).jumps;
    expect(newest).toMatchObject({ loss: 'loss: measuring', role: 'critical' });
    expect(older!.loss).toBe('loss +0.12 s/lap');
    expect(older!.role).toBeUndefined();
  });

  it('has no role on the newest jump once its loss is measured', () => {
    const [newest] = damageRows(state({ jumps: [{ ...wing, lossMsPerLap: known(1230, 400_000) }] })).jumps;
    expect(newest).toMatchObject({ loss: 'loss +1.23 s/lap' });
    expect(newest!.role).toBeUndefined();
  });

  it('shows an empty loss with the reason when the loss is hidden', () => {
    const [row] = damageRows(state({ jumps: [{ ...wing, lossMsPerLap: unknown('realism') }] })).jumps;
    expect(row).toMatchObject({ loss: '', reason: 'realism' });
    expect(row!.role).toBeUndefined();
  });

  it('joins several parts with " + " and rounds the delta to whole percent', () => {
    const [row] = damageRows(state({ jumps: [{ ...wing, parts: ['floorPct', 'diffuserPct'], deltaPct: 7.6 }] })).jumps;
    expect(row!.text).toBe('L14 floor + diffuser +8 %');
  });

  it('is empty without jumps', () => {
    expect(damageRows(state()).jumps).toEqual([]);
  });
});

describe('damageRows compact', () => {
  it('gives the parts line (wings L/R/rear, floor, diffuser, sidepod, gearbox, engine) and the newest jump', () => {
    const { compact } = damageRows(state({ jumps: [floor, wing] }));
    expect(compact.parts).toBe('W12/0/0 F4 D0 S2 G8 E11');
    expect(compact.jump?.text).toBe('L14 FL wing +12 %');
    expect(compact.jump?.loss).toBe('loss: measuring');
  });

  it('has no jump without jumps, and an empty parts line when the parts are hidden', () => {
    expect(damageRows(state()).compact.jump).toBeUndefined();
    expect(damageRows(state({ parts: unknown('realism') })).compact.parts).toBe('');
  });
});
