import { describe, expect, it } from 'vitest';
import { known, unknown } from '@pitwall/domain';
import type { Corners, DamageJump, DamageParts, DamageState, UnknownReason } from '@pitwall/domain';
import { unknownPart } from '../../kit/grid/grid.ts';
import { damageRows } from './rows.ts';

const PARTS: DamageParts = {
  frontLeftWingPct: 12, frontRightWingPct: 0, rearWingPct: 0, floorPct: 4, diffuserPct: 0, sidepodPct: 2, gearboxPct: 8, enginePct: 11,
};
const corner = (tyre: number, brake: number) => ({ tyrePct: known(tyre, 0), brakePct: known(brake, 0) });
const CORNERS: Corners<{ tyrePct: ReturnType<typeof known<number>>; brakePct: ReturnType<typeof known<number>> }> = {
  fl: corner(3, 0), fr: corner(1, 0), rl: corner(0, 0), rr: corner(0, 0),
};
/** The jumps without measuring or an estimate (the plain loss texts); `damageRows measuring and estimate` sets both. */
const wing: DamageJump = {
  at: 200_000, lap: 14, parts: ['frontLeftWingPct'], deltaPct: 12, lossMsPerLap: unknown('insufficientData'),
  measuring: unknown('notApplicable'), estimateMsPerLap: unknown('notApplicable'),
};
const floor: DamageJump = {
  at: 100_000, lap: 9, parts: ['floorPct'], deltaPct: 4, lossMsPerLap: known(120, 150_000),
  measuring: unknown('notApplicable'), estimateMsPerLap: unknown('notApplicable'),
};
/** The reasons of a loss the card does not say in words ("measuring", "not measurable"): it shows their mark. */
const HIDDEN: UnknownReason[] = ['restricted', 'notReceived', 'realism'];

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
    expect(newest).toMatchObject({ loss: { text: 'loss: measuring' }, role: 'critical' });
    expect(older!.loss).toStrictEqual({ text: 'loss +0.12 s/lap' });
    expect(older!.role).toBeUndefined();
  });

  it('has no role on the newest jump once its loss is measured', () => {
    const [newest] = damageRows(state({ jumps: [{ ...wing, lossMsPerLap: known(1230, 400_000) }] })).jumps;
    expect(newest!.loss).toStrictEqual({ text: 'loss +1.23 s/lap' });
    expect(newest!.role).toBeUndefined();
  });

  it('shows "loss: not measurable" for a loss that can never be measured, titled with the reason, and no critical role', () => {
    const [row] = damageRows(state({ jumps: [{ ...wing, lossMsPerLap: unknown('notApplicable') }] })).jumps;
    expect(row!.loss).toStrictEqual({ text: 'loss: not measurable' });
    expect(row!.title).toBe('too few clean laps before the hit');
    expect(row!.role).toBeUndefined();
  });

  it('keeps "loss: measuring" with no title for a loss still waiting for laps', () => {
    const [row] = damageRows(state({ jumps: [wing] })).jumps;
    expect(row!.loss).toStrictEqual({ text: 'loss: measuring' });
    expect(row).not.toHaveProperty('title');
  });

  it.each(HIDDEN)('gives a %s loss as the unknown part (its mark shows in place), with no title and no role', (reason) => {
    const [row] = damageRows(state({ jumps: [{ ...wing, lossMsPerLap: unknown(reason) }] })).jumps;
    expect(row!.loss).toStrictEqual(unknownPart(reason));
    expect(row).not.toHaveProperty('title');
    expect(row!.role).toBeUndefined();
  });

  // R9-1: the loss is a CellPart; the row holds no reason of its own beside it, in any loss state.
  const LOSSES: Array<[string, DamageJump['lossMsPerLap']]> = [
    ['measured', known(120, 150_000)],
    ['measuring', unknown('insufficientData')],
    ['not measurable', unknown('notApplicable')],
    ...HIDDEN.map((reason): [string, DamageJump['lossMsPerLap']] => [reason, unknown(reason)]),
  ];
  it.each(LOSSES)('keeps no reason on the row itself for a %s loss: it is the loss part\'s', (_, lossMsPerLap) => {
    const [row] = damageRows(state({ jumps: [{ ...wing, lossMsPerLap }] })).jumps;
    expect(row).not.toHaveProperty('reason');
  });

  it('joins several parts with " + " and rounds the delta to whole percent', () => {
    const [row] = damageRows(state({ jumps: [{ ...wing, parts: ['floorPct', 'diffuserPct'], deltaPct: 7.6 }] })).jumps;
    expect(row!.text).toBe('L14 floor + diffuser +8 %');
  });

  it('keeps each jump\'s time, so two jumps with the same text stay two rows (the display keys by it)', () => {
    const twin = { ...wing, at: 205_000 };
    const rows = damageRows(state({ jumps: [wing, twin] })).jumps;
    expect(rows.map((r) => r.text)).toEqual([rows[0]!.text, rows[0]!.text]);
    expect(rows.map((r) => r.at)).toEqual([205_000, 200_000]);
  });

  it('is empty without jumps', () => {
    expect(damageRows(state()).jumps).toEqual([]);
  });
});

describe('damageRows measuring and estimate', () => {
  const NA = unknown('notApplicable');
  const measuringJump = (done: number, estimate: DamageJump['estimateMsPerLap'] = NA): DamageJump => ({
    ...wing, lossMsPerLap: unknown('insufficientData'), measuring: known({ lapsDone: done, lapsNeeded: 2 }, 0), estimateMsPerLap: estimate,
  });

  it('shows the laps done of the laps needed while measuring without an estimate', () => {
    const [row] = damageRows(state({ jumps: [measuringJump(0)] })).jumps;
    expect(row!.loss).toStrictEqual({ text: 'measuring 0/2 laps' });
    expect(row!.lossRole).toBeUndefined();
    const [later] = damageRows(state({ jumps: [measuringJump(1)] })).jumps;
    expect(later!.loss).toStrictEqual({ text: 'measuring 1/2 laps' });
  });

  it('shows the estimate in textFaint while measuring, replacing the measuring text', () => {
    const [row] = damageRows(state({ jumps: [measuringJump(1, known(800, 0))] })).jumps;
    expect(row!.loss).toStrictEqual({ text: '~+0.8 s/lap est.' });
    expect(row!.lossRole).toBe('textFaint');
  });

  it('shows the measured loss alone once known: no estimate text, no faint role', () => {
    const measured: DamageJump = {
      ...wing, lossMsPerLap: known(1230, 400_000), measuring: NA, estimateMsPerLap: NA,
    };
    const [row] = damageRows(state({ jumps: [measured] })).jumps;
    expect(row!.loss).toStrictEqual({ text: 'loss +1.23 s/lap' });
    expect(row!.lossRole).toBeUndefined();
  });

  it('shows the estimate of a jump that can never be measured, its only number', () => {
    const never: DamageJump = { ...wing, lossMsPerLap: NA, measuring: NA, estimateMsPerLap: known(800, 0) };
    const [row] = damageRows(state({ jumps: [never] })).jumps;
    expect(row!.loss).toStrictEqual({ text: '~+0.8 s/lap est.' });
    expect(row!.lossRole).toBe('textFaint');
  });

  it('keeps "loss: not measurable" for a never-measurable jump without an estimate', () => {
    const never: DamageJump = { ...wing, lossMsPerLap: NA, measuring: NA, estimateMsPerLap: NA };
    const [row] = damageRows(state({ jumps: [never] })).jumps;
    expect(row!.loss).toStrictEqual({ text: 'loss: not measurable' });
    expect(row!.lossRole).toBeUndefined();
  });

  it('gives the compact view the same loss and role for the newest jump', () => {
    const { compact } = damageRows(state({ jumps: [measuringJump(1, known(800, 0))] }));
    expect(compact.jump?.loss).toStrictEqual({ text: '~+0.8 s/lap est.' });
    expect(compact.jump?.lossRole).toBe('textFaint');
  });
});

describe('damageRows compact', () => {
  it('gives the parts line (wings L/R/rear, floor, diffuser, sidepod, gearbox, engine) and the newest jump', () => {
    const { compact } = damageRows(state({ jumps: [floor, wing] }));
    expect(compact.parts).toBe('W12/0/0 F4 D0 S2 G8 E11');
    expect(compact.jump?.text).toBe('L14 FL wing +12 %');
    expect(compact.jump?.loss).toStrictEqual({ text: 'loss: measuring' });
  });

  it('gives the not-measurable loss of the newest jump', () => {
    const { compact } = damageRows(state({ jumps: [floor, { ...wing, lossMsPerLap: unknown('notApplicable') }] }));
    expect(compact.jump?.loss).toStrictEqual({ text: 'loss: not measurable' });
    expect(compact.jump?.title).toBe('too few clean laps before the hit');
  });

  it('has no jump without jumps, and an empty parts line when the parts are hidden', () => {
    expect(damageRows(state()).compact.jump).toBeUndefined();
    expect(damageRows(state({ parts: unknown('realism') })).compact.parts).toBe('');
  });
});
