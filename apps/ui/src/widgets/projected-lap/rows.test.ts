import { describe, expect, it } from 'vitest';
import { known, toSessionTime, unknown } from '@pitwall/domain';
import { PROJECTION_COLUMNS, projectionHeader, projectionRows } from './rows.ts';
import { insideCutOff, ms, outLap, outsideCutOff, projection } from './fixtures.ts';

const text = (rows: ReturnType<typeof projectionRows>) =>
  rows.map((r) => [r.key, r.name, r.time, r.pos, r.delta, r.label]);

describe('projectionRows', () => {
  it('always returns the rows proj, cutOff, finish in that order', () => {
    expect(projectionRows(insideCutOff).map((r) => r.key)).toEqual(['proj', 'cutOff', 'finish']);
    expect(projectionRows(projection()).map((r) => r.key)).toEqual(['proj', 'cutOff', 'finish']);
  });

  it('formats the push lap inside the cut-off like the mockup', () => {
    expect(text(projectionRows(insideCutOff))).toEqual([
      ['proj', 'PROJ', '1:23.412', 'P6', '-0.118', 'to best'],
      ['cutOff', 'CUT-OFF', '1:24.006', 'P15', '+0.594', 'margin'],
      ['finish', 'FINISH', '', '', '38.2 s', 'left at line'],
    ]);
  });

  it('puts the finish margin in the delta column, never in the time column', () => {
    const finish = projectionRows(insideCutOff)[2]!;
    expect(finish.time).toBe('');
    expect(finish.pos).toBe('');
    expect(finish.delta).toBe('38.2 s');
  });

  it('writes a negative finish margin with a minus sign', () => {
    const rows = projectionRows(projection({ finishMs: -4_100 }));
    expect(rows[2]!.delta).toBe('-4.1 s');
    expect(rows[2]!.deltaRole).toBe('critical');
  });

  it('colours the delta to best green for a new personal best, nothing otherwise', () => {
    expect(projectionRows(insideCutOff)[0]!.deltaRole).toBe('personalBest');
    expect(projectionRows(outsideCutOff)[0]!.deltaRole).toBeUndefined();
  });

  it('colours the margin red outside the cut-off, nothing inside', () => {
    expect(projectionRows(outsideCutOff)[1]!.delta).toBe('-0.305');
    expect(projectionRows(outsideCutOff)[1]!.deltaRole).toBe('critical');
    expect(projectionRows(insideCutOff)[1]!.deltaRole).toBeUndefined();
  });

  it('colours the finish margin by finishRole', () => {
    expect(projectionRows(insideCutOff)[2]!.deltaRole).toBeUndefined();
  });

  it('shows "out lap" on an out lap and no projection', () => {
    const [proj] = projectionRows(outLap);
    expect(proj).toMatchObject({ time: 'out lap', pos: '', delta: '', label: '', deltaRole: undefined });
  });

  it('on an out lap shows the cut-off time and position without a margin, and the finish margin', () => {
    expect(text(projectionRows(outLap))).toEqual([
      ['proj', 'PROJ', 'out lap', '', '', ''],
      ['cutOff', 'CUT-OFF', '1:23.870', 'P10', '', ''],
      ['finish', 'FINISH', '', '', '3.9 s', 'left at line'],
    ]);
    expect(projectionRows(outLap)[1]!.deltaRole).toBeUndefined();
  });

  it('on an out lap without a cut-off shows the finish margin only', () => {
    const rows = projectionRows(projection({ onLap: false, finishMs: 3_900 }));
    expect(rows[0]!.time).toBe('out lap');
    expect(rows[1]).toMatchObject({ time: '', pos: '', delta: '', label: '' });
    expect(rows[2]!.delta).toBe('3.9 s');
  });

  it('leaves unknown values as empty cells, with the reason for the hover, and no label', () => {
    const rows = projectionRows(projection({ lapMs: 83_900, deltaMs: 240, position: 4 }));
    expect(rows[1]).toMatchObject({ time: '', pos: '', delta: '', label: '', reason: 'notApplicable' });
    expect(rows[2]).toMatchObject({ delta: '', label: '', reason: 'notApplicable' });
    expect(rows[0]!.reason).toBeUndefined();
  });

  it('keeps the reason of a hidden value (realism)', () => {
    const rows = projectionRows({ ...projection(), projectedLapMs: unknown('realism'), deltaToBestMs: unknown('realism'), projectedPosition: unknown('realism') });
    expect(rows[0]).toMatchObject({ time: '', pos: '', delta: '', label: '', reason: 'realism' });
  });

  it('shows the PROJ row partly when only some values are known', () => {
    const rows = projectionRows({ ...projection({ lapMs: 83_900 }), projectedPosition: known(3, toSessionTime(0)), deltaToBestMs: ms(0) });
    expect(rows[0]).toMatchObject({ time: '1:23.900', pos: 'P3', delta: '+0.000', label: 'to best', deltaRole: undefined });
  });
});

describe('PROJECTION_COLUMNS and projectionHeader', () => {
  it('has the columns name, time, pos, delta, label with the widths 7, 8, 3, 7, 12', () => {
    expect(PROJECTION_COLUMNS.map((c) => [c.key, c.width])).toEqual([
      ['name', 7], ['time', 8], ['pos', 3], ['delta', 7], ['label', 12],
    ]);
  });
  it('right-aligns time, pos and delta', () => {
    expect(PROJECTION_COLUMNS.filter((c) => c.align === 'right').map((c) => c.key)).toEqual(['time', 'pos', 'delta']);
  });
  it('writes the header TIME POS Δ over their columns', () => {
    expect(projectionHeader().trimEnd()).toBe('            TIME POS       Δ');
  });
});
