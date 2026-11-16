import { describe, expect, it } from 'vitest';
import { carId, known, unknown } from '@pitwall/domain';
import type { BattleCard, BattleSide, DrsOffReason, DrsStatus, Known, RaceMoment } from '@pitwall/domain';
import type { CarOverview } from '@pitwall/contracts';
import { battleHeader, battleRowText, battleRows, columnsFor } from './rows.ts';

const k = <T>(v: T): Known<T> => known(v, 0);
const OURS = carId(1);

const overview = (id: number, name: string): CarOverview =>
  ({ id: carId(id), identity: { name, raceNumber: id }, timing: {}, tyres: {}, updatedAt: 0 }) as unknown as CarOverview;
const cars = [overview(1, 'Kuhnlein'), overview(3, 'Charles Leclerc'), overview(7, 'Alexander Albon')];

// SP4.3c Task 15 (O13): each side's PASS is battle's pass chance (race-interaction's curve at the gap), 0–1, shown as a
// whole percent (`formatShare`): ahead our chance to pass, behind theirs to pass us. The fixed margin is gone.
const aheadSide: BattleSide = {
  carId: carId(3), gapMs: k(3199), lapsToDrs: k(7.1), paceDeltaMs: k(430),
  passChance: k(0.31),
  ours: { compound: 'medium', age: 12 }, theirs: { compound: 'hard', age: 23 }, theirErsStoreJ: k(3_100_000),
};
const behindSide: BattleSide = {
  carId: carId(7), gapMs: k(841), lapsToDrs: k(0), paceDeltaMs: k(-420),
  passChance: k(0.42),
  ours: { compound: 'medium', age: 12 }, theirs: { compound: 'medium', age: 1 }, theirErsStoreJ: unknown('realism'),
};
const card = (over: Partial<BattleCard> = {}): BattleCard => ({ carId: OURS, ahead: k(aheadSide), behind: k(behindSide), drs: { enabled: true }, ...over });

/** A card as battle gives it while race control has DRS off: both sides' lapsToDrs notApplicable. */
const drsOff = (reason: DrsOffReason, over: Partial<BattleCard> = {}): BattleCard => {
  const drs: DrsStatus = { enabled: false, reason };
  return card({ ahead: k({ ...aheadSide, lapsToDrs: unknown('notApplicable') }), behind: k({ ...behindSide, lapsToDrs: unknown('notApplicable') }), drs, ...over });
};

const battle = (params: Record<string, number | string> = { carId: 1, side: 'behind', lapsToDrs: 0, gapMs: 841 }): Known<RaceMoment> =>
  k({ moment: 'battle', since: unknown('notApplicable'), cause: { rule: 'battle', params }, active: ['battle'] });

describe('battleRows', () => {
  it('gives two rows, ahead first, labelled AHEAD and BEHIND', () => {
    const rows = battleRows(card(), cars, undefined);
    expect(rows.map((r) => r.label)).toEqual(['AHEAD', 'BEHIND']);
  });

  it('formats every column as in the mockup', () => {
    const [ahead] = battleRows(card(), cars, undefined);
    expect(Object.fromEntries(Object.entries(ahead!.cells).map(([c, cell]) => [c, cell.text]))).toEqual({
      drv: 'LEC', gap: '−3.199', paceDelta: '+0.43 s/lap', passChance: '31%', toDrs: '7.1 laps', tyres: 'M12 H23', ers: '3.1 MJ',
    });
  });

  it('signs the gap by side as the tower does: a car ahead negative (U+2212), a car behind positive', () => {
    const [ahead, behind] = battleRows(card(), cars, undefined);
    expect(ahead!.cells.gap.text).toBe('−3.199');
    expect(behind!.cells.gap.text).toBe('+0.841');
    expect(behind!.cells.paceDelta.text).toBe('−0.42 s/lap');
    expect(behind!.cells.passChance.text).toBe('42%');
  });

  it('writes "in DRS" for 0 laps to DRS', () => {
    const rows = battleRows(card(), cars, undefined);
    expect(rows[1]!.cells.toDrs.text).toBe('in DRS');
  });

  it('has no CLOSING column or cell', () => {
    expect(columnsFor('full')).not.toContain('closing');
    const [ahead] = battleRows(card(), cars, undefined);
    expect(Object.keys(ahead!.cells)).not.toContain('closing');
    expect(battleHeader('full')).not.toContain('CLOSING');
  });

  it('shows the pass chance as a whole percent on both rows: 0 % and 100 % included; no margin column or cell', () => {
    const [ahead, behind] = battleRows(card(), cars, undefined);
    expect(ahead!.cells.passChance.text).toBe('31%');
    expect(behind!.cells.passChance.text).toBe('42%');
    const edges = battleRows(card({ ahead: k({ ...aheadSide, passChance: k(0) }), behind: k({ ...behindSide, passChance: k(1) }) }), cars, undefined);
    expect(edges.map((r) => r.cells.passChance.text)).toEqual(['0%', '100%']);
    expect(columnsFor('full')).not.toContain('margin');
    expect(Object.keys(ahead!.cells)).not.toContain('margin');
    expect(battleHeader('full')).not.toContain('MARGIN');
  });

  it('renders an unknown pass chance as an empty cell with its reason', () => {
    const [ahead] = battleRows(card({ ahead: k({ ...aheadSide, passChance: unknown('insufficientData') }) }), cars, undefined);
    expect(ahead!.cells.passChance).toMatchObject({ text: '', reason: 'insufficientData' });
  });

  it('writes no verdict word in any cell, header or row text', () => {
    const rows = battleRows(card(), cars, undefined);
    const all = [battleHeader('full'), ...rows.flatMap((r) => [battleRowText('full', r), ...Object.values(r.cells).map((c) => c.text)])].join(' ').toLowerCase();
    expect(all).not.toMatch(/can pass|safe/);
  });

  it('a likely pass (passChanceRole) is bold white (text) ahead and warning behind; an unlikely one lights nothing', () => {
    const [ahead, behind] = battleRows(card(), cars, undefined);
    expect(ahead!.cells.passChance.role).toBe('text');
    expect(behind!.cells.passChance.role).toBe('warning');
    const unlikely = battleRows(card({
      ahead: k({ ...aheadSide, passChance: k(0.12) }),
      behind: k({ ...behindSide, passChance: k(0.08) }),
    }), cars, undefined);
    expect(unlikely[0]!.cells.passChance.role).toBeUndefined();
    expect(unlikely[1]!.cells.passChance.role).toBeUndefined();
  });

  it('shows tyres as letter and age, ours then theirs', () => {
    const [, behind] = battleRows(card(), cars, undefined);
    expect(behind!.cells.tyres.text).toBe('M12 M1');
  });

  it('renders a hidden rival ERS as an empty cell with its reason; the rest of the row stays', () => {
    const [, behind] = battleRows(card(), cars, undefined);
    expect(behind!.cells.ers).toMatchObject({ text: '', reason: 'realism' });
    expect(behind!.cells.gap.text).toBe('+0.841');
    expect(behind!.cells.drv.text).toBe('ALB');
  });

  it('renders each unknown value as an empty cell with its reason', () => {
    const rows = battleRows(card({ ahead: k({ ...aheadSide, lapsToDrs: unknown('insufficientData'), gapMs: unknown('notReceived') }) }), cars, undefined);
    expect(rows[0]!.cells.toDrs).toMatchObject({ text: '', reason: 'insufficientData' });
    expect(rows[0]!.cells.gap).toMatchObject({ text: '', reason: 'notReceived' });
  });

  it('renders a side that is not applicable (leader, last car) as a labelled row of empty cells with the reason', () => {
    const rows = battleRows(card({ ahead: unknown('notApplicable') }), cars, undefined);
    expect(rows[0]!.label).toBe('AHEAD');
    for (const cell of Object.values(rows[0]!.cells)) expect(cell).toMatchObject({ text: '', reason: 'notApplicable' });
    expect(rows[1]!.cells.drv.text).toBe('ALB');
  });

  it('shows an empty DRV with the reason on hover when the car is missing from cars.overview', () => {
    const rows = battleRows(card(), cars.slice(0, 2), undefined);
    expect(rows[1]!.cells.drv).toEqual({ text: '', reason: 'notReceived' });
    expect(rows[1]!.cells.gap.text).toBe('+0.841');
  });

  it('lights drv, gap and toDrs of the row the moment names (BEHIND of card car 1) as text (white bold) in the battle moment, nothing else', () => {
    const [ahead, behind] = battleRows(card(), cars, battle());
    expect(behind!.highlighted).toBe(true);
    expect(behind!.cells.drv.role).toBe('text');
    expect(behind!.cells.gap.role).toBe('text');
    expect(behind!.cells.toDrs.role).toBe('text');
    expect(behind!.cells.paceDelta.role).toBeUndefined();
    expect(behind!.cells.passChance.role).toBe('warning');
    expect(ahead!.highlighted).toBe(false);
    // No other moment light: the unnamed row keeps only its own pass-chance emphasis (a likely pass ahead is text).
    expect(Object.entries(ahead!.cells).filter(([c, cell]) => c !== 'passChance' && cell.role !== undefined)).toEqual([]);
    expect(ahead!.cells.passChance.role).toBe('text');
  });

  it('lights nothing without the moment, outside the battle moment, or for another car\'s card', () => {
    const other = k({ moment: 'battle', since: unknown('notApplicable'), cause: { rule: 'battle', params: { carId: 2, side: 'behind' } }, active: ['battle'] } as RaceMoment);
    expect(battleRows(card(), cars, other).some((r) => r.highlighted)).toBe(false);
    for (const m of [undefined, unknown('notApplicable')] as const) {
      expect(battleRows(card(), cars, m).some((r) => r.highlighted)).toBe(false);
    }
  });
});

describe('battleRows while race control has DRS off', () => {
  it('TO DRS reads "DRS off" on both rows, with the reason in its title, and no unknown reason', () => {
    for (const row of battleRows(drsOff('wetTrack'), cars, undefined)) {
      expect(row.cells.toDrs).toEqual({ text: 'DRS off', title: 'DRS off: wet track' });
    }
  });

  it('every reason has its own title, each starting "DRS off"', () => {
    const reasons: DrsOffReason[] = ['notEnabledYet', 'wetTrack', 'safetyCar', 'redFlag', 'minLapNotReached', 'unknown'];
    const titles = reasons.map((r) => (battleRows(drsOff(r), cars, undefined)[0]!.cells.toDrs as Record<string, unknown>)['title']);
    for (const t of titles) expect(t).toMatch(/^DRS off/);
    expect(new Set(titles).size).toBe(reasons.length);
  });

  it('the other cells are those with DRS enabled', () => {
    const on = battleRows(card(), cars, undefined);
    const off = battleRows(drsOff('safetyCar'), cars, undefined);
    off.forEach((row, i) => {
      const { toDrs: _off, ...rest } = row.cells;
      const { toDrs: _on, ...restOn } = on[i]!.cells;
      expect(rest).toEqual(restOn);
    });
  });

  it('a side that is not applicable stays a row of empty cells with the reason', () => {
    const rows = battleRows(drsOff('wetTrack', { ahead: unknown('notApplicable') }), cars, undefined);
    for (const cell of Object.values(rows[0]!.cells)) expect(cell).toEqual({ text: '', reason: 'notApplicable' });
    expect(rows[1]!.cells.toDrs.text).toBe('DRS off');
  });

  it('the battle moment still lights TO DRS of its row', () => {
    const [, behind] = battleRows(drsOff('wetTrack'), cars, battle({ carId: 1, side: 'behind', gapMs: 841 }));
    expect(behind!.cells.toDrs).toMatchObject({ text: 'DRS off', role: 'text' });
  });

  it('full and compact rows show DRS off in the TO DRS field', () => {
    const [ahead] = battleRows(drsOff('wetTrack'), cars, undefined);
    expect(battleRowText('full', ahead!)).toContain('DRS off');
    expect(battleRowText('compact', ahead!)).toBe('AHEAD  LEC −3.199  DRS off');
  });
});

describe('text layout', () => {
  it('full header names the columns in order: DRV GAP PACE Δ, PASS (the pass chance), TO DRS, TYRES, ERS', () => {
    const h = battleHeader('full');
    const at = ['DRV', 'GAP', 'PACE Δ', 'PASS', 'TO DRS', 'TYRES', 'ERS'].map((t) => h.indexOf(t));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
  });

  it('full rows are as long as the header and keep the column order', () => {
    const [ahead, behind] = battleRows(card(), cars, undefined);
    expect(columnsFor('full')).toEqual(['drv', 'gap', 'paceDelta', 'passChance', 'toDrs', 'tyres', 'ers']);
    expect(battleRowText('full', behind!)).toHaveLength(battleHeader('full').length);
    expect(battleRowText('full', ahead!)).toMatch(/AHEAD +LEC +−3\.199 +\+0\.43 s\/lap +31% +7\.1 laps +M12 H23 +3\.1 MJ/);
    expect(battleRowText('full', behind!)).toMatch(/BEHIND +ALB +\+0\.841 +−0\.42 s\/lap +42% +in DRS +M12 M1/);
    // a 100 % chance fits its field: the row stays as long as the header
    const [full] = battleRows(card({ ahead: k({ ...aheadSide, passChance: k(1) }) }), cars, undefined);
    expect(battleRowText('full', full!)).toHaveLength(battleHeader('full').length);
  });

  it('compact shows DRV, GAP and TO DRS only', () => {
    expect(columnsFor('compact')).toEqual(['drv', 'gap', 'toDrs']);
    const [ahead] = battleRows(card(), cars, undefined);
    expect(battleHeader('compact')).toBe('       DRV    GAP   TO DRS');
    expect(battleRowText('compact', ahead!)).toBe('AHEAD  LEC −3.199 7.1 laps');
  });
});
