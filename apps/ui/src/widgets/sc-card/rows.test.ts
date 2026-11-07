// The sc-card's rows (SP4.2 spec 4; C65: the display formats and maps, it computes nothing). Contract assumed of `rows.ts`:
//  - `buildRows(call: ScCall, active: 'sc' | 'vsc' | undefined): ScRow[]`, one row per topic row in its order (SC, VSC),
//    with `{ condition, active: boolean, rejoin: CellPart, loss: CellPart, gain: CellPart, source: EstimateSource }`:
//    the rejoin position as `P9` (kit `formatPosition`), the loss as seconds to one decimal (kit `formatSeconds(ms, 1)`),
//    the gain signed to one decimal (kit `formatSignedSeconds(ms, 1)`, positive = good for us), an unknown value empty
//    with its reason (kit `knownPart`); `source` the loss's source as the topic gives it (the calculator decided its kind,
//    C43; the gain rests on the same loss and takes the same badge); `active` the row of the condition that is out.
import { describe, expect, it } from 'vitest';
import { calibrationSource, call, defaultSource, mockupSc, mockupVsc, row, sessionSource } from './fixtures.ts';
import { buildRows } from './rows.ts';

describe('buildRows', () => {
  it('gives the SC row, then the VSC row', () => {
    expect(buildRows(call(), undefined).map((r) => r.condition)).toEqual(['sc', 'vsc']);
  });

  it('formats the rejoin position, the loss to the tenth and the gain signed to the tenth', () => {
    expect(buildRows(call(), undefined).map((r) => [r.rejoin, r.loss, r.gain])).toEqual([
      [{ text: 'P9' }, { text: '9.8' }, { text: '+10.5' }],
      [{ text: 'P10' }, { text: '13.1' }, { text: '+7.2' }],
    ]);
  });

  it('signs a negative gain with the minus', () => {
    const [sc] = buildRows(call(row('sc', 9, 9_800, -1_200, defaultSource)), undefined);
    expect(sc?.gain).toEqual({ text: '−1.2' });
  });

  it('carries the loss\'s source as the topic gives it', () => {
    expect(buildRows(call(), undefined).map((r) => r.source)).toEqual([defaultSource, calibrationSource]);
    expect(buildRows(call(row('sc', 9, 9_800, 10_500, sessionSource)), undefined)[0]?.source).toEqual(sessionSource);
  });

  it('shows an unknown value empty with its reason, each cell on its own', () => {
    const [sc] = buildRows(call(row('sc', 'notReceived', 9_800, 'insufficientData', defaultSource)), undefined);
    expect([sc?.rejoin, sc?.loss, sc?.gain]).toEqual([
      { text: '', reason: 'notReceived' },
      { text: '9.8' },
      { text: '', reason: 'insufficientData' },
    ]);
  });

  it('marks the row of the condition that is out, and no other', () => {
    expect(buildRows(call(), 'sc').map((r) => r.active)).toEqual([true, false]);
    expect(buildRows(call(), 'vsc').map((r) => r.active)).toEqual([false, true]);
    expect(buildRows(call(), undefined).map((r) => r.active)).toEqual([false, false]);
  });

  it('does no arithmetic of its own: the values are the topic\'s, only rounded to the tenth', () => {
    const [sc] = buildRows(call(row('sc', 9, 9_849, 10_451, defaultSource), mockupVsc), undefined);
    expect([sc?.loss, sc?.gain]).toEqual([{ text: '9.8' }, { text: '+10.5' }]);
    expect(buildRows(call(mockupSc, mockupVsc), undefined)[1]?.gain).toEqual({ text: '+7.2' });
  });
});
