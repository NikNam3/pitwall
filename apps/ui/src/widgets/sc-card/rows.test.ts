// The sc-card's rows (SP4.3b spec §10, V18; mockup docs/design/2026-11-12-sp4.3b/sc-card.html; C65: the display formats
// and maps, it computes nothing). Contract assumed of `rows.ts`:
//  - `buildRows(call: ScCall, active: 'sc' | 'vsc' | undefined): ScRow[]`, one row per topic row in its order (SC, VSC),
//    `{ condition, active: boolean, dPos, pGain, rejoin, loss, range: CellPart, strip: { bins: readonly number[] } | CellPart,
//    source: EstimateSource }`: ΔPOS `ePosDelta` through the kit's `formatPlacesGained`, P(GAIN) `pGain` through
//    `formatShare`, REJ `rejoinPosition` through `formatPosition`, LOSS `lossMs` through `formatSeconds(ms, 1)`, RANGE
//    `range` through `formatLapRange(fromLap, toLap)`; `strip` the topic's `gainBins` as they are; an unknown value its
//    reason's part (kit `knownPart`/`unknownPart`: `{ text: '', reason }`), the strip's too; `source` the loss's source as
//    the topic gives it (C43); `active` the row of the condition that is out;
//  - `scaleOf(rows: readonly ScRow[]): number`: the kit's `sharedScale` over the known strips' bins, so the strips compare.
import { describe, expect, it } from 'vitest';
import { sharedScale } from '../../kit/dist/dist.ts';
import { calibrationSource, call, cases, defaultSource, row, scGreen, scOut as scOutValues, vscGreen } from './fixtures.ts';
import { buildRows, scaleOf } from './rows.ts';

const valueOf = (name: keyof typeof cases) => cases[name].call.value;

describe('sc-card rows', () => {
  it('header ΔPOS P(GAIN) −4 0 +4 REJ LOSS RANGE; rows SC +1.4 75% <strip> P9 9.8ᵈ L12–24 and VSC +0.6 53% <strip> P10 13.1ᶜ L15–24', () => {
    const rows = buildRows(valueOf('green'), undefined);
    expect(rows.map((r) => [r.condition, r.dPos, r.pGain, r.strip, r.rejoin, r.loss, r.range, r.source])).toEqual([
      ['sc', { text: '+1.4' }, { text: '75%' }, { bins: scGreen.gainBins }, { text: 'P9' }, { text: '9.8' }, { text: 'L12–24' }, defaultSource],
      ['vsc', { text: '+0.6' }, { text: '53%' }, { bins: vscGreen.gainBins }, { text: 'P10' }, { text: '13.1' }, { text: 'L15–24' }, calibrationSource],
    ]);
    // a loss in places lost is signed with the minus; zero is +0.0 (kit formatPlacesGained)
    const [down] = buildRows(call(row('sc', { ...scGreen, ePosDelta: -0.64 }, defaultSource)), undefined);
    expect(down?.dPos).toEqual({ text: '−0.6' });
  });

  it('under a neutralised span with car SC: the header SC in warning, the SC row white bold with its strip lit, the VSC row – in every cell with notApplicable on hover (Q5 B)', () => {
    const rows = buildRows(valueOf('scOut'), 'sc');
    expect(rows.map((r) => r.active)).toEqual([true, false]);
    expect(rows[0]?.dPos).toEqual({ text: '+1.8' });
    const vsc = rows[1]!;
    expect([vsc.dPos, vsc.pGain, vsc.strip, vsc.rejoin, vsc.loss, vsc.range]).toEqual(Array(6).fill({ text: '', reason: 'notApplicable' }));
    expect(buildRows(valueOf('vscOut'), 'vsc').map((r) => r.active)).toEqual([false, true]);
    expect(buildRows(valueOf('green'), undefined).map((r) => r.active)).toEqual([false, false]);
  });

  it('the strips share one scale; a white tick under the zero bin\'s centre', () => {
    const flat = Array(9).fill(1 / 9) as number[];
    const rows = buildRows(call(row('sc', scGreen, defaultSource), row('vsc', { ...vscGreen, gainBins: flat }, calibrationSource)), undefined);
    expect(scaleOf(rows)).toBe(sharedScale([scGreen.gainBins, flat]));
    expect(scaleOf(rows)).toBe(0.286);
    // an unknown row adds no bins
    expect(scaleOf(buildRows(valueOf('scOut'), 'sc'))).toBe(Math.max(...scOutValues.gainBins));
  });

  it('unknown cells: the kit\'s marks', () => {
    const rows = buildRows(valueOf('unknown'), undefined);
    for (const r of rows) {
      expect([r.dPos, r.pGain, r.strip, r.rejoin, r.loss, r.range], r.condition).toEqual(Array(6).fill({ text: '', reason: 'insufficientData' }));
    }
    // each cell on its own
    const [sc] = buildRows(call({ ...row('sc', scGreen, defaultSource), rejoinPosition: { known: false, reason: 'notReceived' } }), undefined);
    expect([sc?.dPos, sc?.rejoin]).toEqual([{ text: '+1.4' }, { text: '', reason: 'notReceived' }]);
  });
});
