// The stint scatter's marks and compounds table (spec 6, plan Task 13; C65, C68). `rows.ts` maps `stintAnalysis.car` to
// what the component draws: formatting and mapping only, no arithmetic on the values (the fit and its band come from the
// analysis, Q12). Contract the tests assume of `rows.ts`:
//  - `stintPlots(stints: readonly StintFit[], mode: 'compact' | 'full'): StintPlot[]`, where
//    `StintPlot = { stint: number; label: string; role: Role; marks: ScatterMark[]; fit: Known<FitPoint[]> }` and
//    `ScatterMark = { lapNumber: number; tyreAge: number; ms: Ms; shape: 'dot' | 'ring' | 'dottedRing'; role: Role; pinned: boolean }`;
//    full: one plot per stint in stint order; compact: the current (last) stint only, with no fit label (mockup README:
//    compact drops the fit labels). The label is the compound letter, a space, the first lap as `L01`, an en dash, and the
//    last lap as two digits for a closed stint, nothing for the current one (`S L01–15`, `M L16–`). The current stint in
//    the `ownCar` role, earlier ones `textDim` (the approved mockup). `pinned`: drawn at the plot's edge when off-scale and
//    never widening the y-range (excluded laps only);
//  - `compoundRows(compounds: readonly CompoundPrior[]): CompoundRow[]`, where
//    `CompoundRow = { compound: string; toSoft: CellPart; degPerLap: CellPart; sd: CellPart; source: EstimateSource; role: Role | undefined }`:
//    one row per compound in the analysis's order; `compound` is the kit compound letter; TO SOFT and DEG/LAP in signed
//    seconds, SD in seconds, three decimals each (kit formats); an unknown value is the kit's unknown part; the source
//    passes through for the kit badge (no switch on its kind here, C68); a default row is muted (`textDim`).
import { unknown } from '@pitwall/domain';
import type { StintFit } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { unknownPart } from '../../kit/grid/grid.ts';
import { cases, compound, defaultCompound, excluded, k, kuhStint, lap, linCompounds, linStints, stint } from './fixtures.ts';
import { compoundRows, stintPlots } from './rows.ts';

const [soft, medium, hard] = linStints as [StintFit, StintFit, StintFit];
/** A stint's marks in full: plotted with LIN's other stints when it is one of them (so its role is that of its place), else alone (current). */
const marksOf = (s: StintFit) => {
  const at = linStints.indexOf(s);
  return (at >= 0 ? stintPlots(linStints, 'full')[at] : stintPlots([s], 'full')[0])!.marks;
};
const markOf = (s: StintFit, lapNumber: number) => marksOf(s).find((m) => m.lapNumber === lapNumber);

describe('stintPlots: one plot per stint', () => {
  it('makes one plot per stint in stint order in full, labelled with its compound and laps, the current one open-ended', () => {
    expect(stintPlots(linStints, 'full').map((p) => [p.stint, p.label])).toEqual([[1, 'S L01–08'], [2, 'M L09–20'], [3, 'H L21–']]);
  });

  it('labels a lone current stint open-ended from its first lap', () => {
    expect(stintPlots([kuhStint], 'full').map((p) => p.label)).toEqual(['M L01–']);
  });

  it('draws the current stint in the ownCar role and every earlier stint in textDim', () => {
    expect(stintPlots(linStints, 'full').map((p) => p.role)).toEqual(['textDim', 'textDim', 'ownCar']);
  });

  it('shows only the current stint in compact, without a fit label', () => {
    expect(stintPlots(linStints, 'compact').map((p) => [p.stint, p.label, p.role])).toEqual([[3, '', 'ownCar']]);
  });

  it('makes no plot without stints', () => {
    expect(stintPlots([], 'full')).toEqual([]);
    expect(stintPlots([], 'compact')).toEqual([]);
  });
});

describe('stintPlots: one mark per lap', () => {
  it('marks every lap of the stint once, in lap order', () => {
    for (const s of linStints) expect(marksOf(s).map((m) => m.lapNumber)).toEqual(s.laps.map((l) => l.lapNumber));
  });

  it('draws a used lap as a dot in its stint\'s role at its tyre age and fuel-corrected time, unchanged', () => {
    expect(markOf(hard, 23)).toEqual({ lapNumber: 23, tyreAge: 3, ms: 91_323, shape: 'dot', role: 'ownCar', pinned: false });
    expect(markOf(soft, 3)).toEqual({ lapNumber: 3, tyreAge: 3, ms: 90_755, shape: 'dot', role: 'textDim', pinned: false });
  });

  it('draws an excluded lap as a faint ring, pinned to the plot\'s edge when off-scale', () => {
    expect(markOf(soft, 8)).toEqual({ lapNumber: 8, tyreAge: 8, ms: 93_200, shape: 'ring', role: 'textFaint', pinned: true });
  });

  it.each(['notForPace', 'inLap', 'outLap', 'neutralised'] as const)('draws a lap excluded as %s the same faint pinned ring', (reason) => {
    const s = stint(1, 'medium', 1, 2, { laps: [lap(1, 1, 93_000, excluded(reason)), lap(2, 2, 91_000)], fitLine: k([]) });
    expect(marksOf(s)[0]).toEqual({ lapNumber: 1, tyreAge: 1, ms: 93_000, shape: 'ring', role: 'textFaint', pinned: true });
  });

  it('draws a down-weighted lap as a dotted ring in its stint\'s role, never pinned', () => {
    expect(markOf(soft, 6)).toEqual({ lapNumber: 6, tyreAge: 6, ms: 91_600, shape: 'dottedRing', role: 'textDim', pinned: false });
    expect(markOf(kuhStint, 14)).toEqual({ lapNumber: 14, tyreAge: 14, ms: 91_900, shape: 'dottedRing', role: 'ownCar', pinned: false });
  });

  it('plots the raw lap times of a stint fitted without the fuel correction', () => {
    const raw = { ...medium, fuelCorrected: false, laps: medium.laps.map((l) => ({ ...l, correctedMs: unknown('notApplicable') })) };
    expect(marksOf(raw).map((m) => m.ms)).toEqual(medium.laps.map((l) => l.lapTimeMs));
  });

  it('leaves out a lap of a fuel-corrected stint whose corrected time is not known', () => {
    const s = stint(1, 'medium', 1, 3, { laps: [lap(1, 1, 91_000), lap(2, 2, 'notReceived'), lap(3, 3, 91_100)], fitLine: k([]) });
    expect(marksOf(s).map((m) => m.lapNumber)).toEqual([1, 3]);
  });

  it('marks the compact plot\'s laps like the full one\'s', () => {
    expect(stintPlots(linStints, 'compact')[0]!.marks).toEqual(stintPlots(linStints, 'full')[2]!.marks);
  });
});

describe('stintPlots: the fit and its band come from the analysis', () => {
  it('passes the fit line with its band through as the analysis gives it', () => {
    expect(stintPlots(linStints, 'full').map((p) => p.fit)).toEqual(linStints.map((s) => s.fitLine));
  });

  it('keeps an unknown fit unknown with its reason', () => {
    const [plot] = stintPlots(cases.unknownFit.analysis.known ? cases.unknownFit.analysis.value.stints : [], 'full');
    expect(plot?.fit).toEqual(unknown('insufficientData'));
    expect(plot?.marks.map((m) => m.shape)).toEqual(['ring', 'dot', 'dot']);
  });
});

describe('compoundRows', () => {
  const rows = compoundRows([...linCompounds, defaultCompound]);

  it('makes one row per compound in the analysis\'s order, named by its letter', () => {
    expect(rows.map((r) => r.compound)).toEqual(['S', 'M', 'H', 'I']);
  });

  it('shows TO SOFT as the offset in signed seconds to three decimals', () => {
    expect(rows.slice(0, 3).map((r) => r.toSoft)).toEqual([{ text: '+0.000' }, { text: '+0.412' }, { text: '+0.780' }]);
  });

  it('shows DEG/LAP as ν in signed seconds per lap and SD in seconds, three decimals each', () => {
    expect(rows.map((r) => [r.degPerLap, r.sd])).toEqual([
      [{ text: '+0.085' }, { text: '0.018' }],
      [{ text: '+0.055' }, { text: '0.009' }],
      [{ text: '+0.041' }, { text: '0.015' }],
      [{ text: '+0.060' }, { text: '0.060' }],
    ]);
  });

  it('shows an unknown value as its reason\'s part', () => {
    expect(rows[3]?.toSoft).toEqual(unknownPart('notApplicable'));
    const hidden = compound('soft', unknown('notReceived'), 0, 0, linCompounds[0]!.source);
    const [row] = compoundRows([{ ...hidden, nuMsPerLap: unknown('insufficientData'), nuSdMs: unknown('insufficientData') }]);
    expect([row?.toSoft, row?.degPerLap, row?.sd]).toEqual([unknownPart('notReceived'), unknownPart('insufficientData'), unknownPart('insufficientData')]);
  });

  it('carries each compound\'s source as the analysis gives it, for the kit badge', () => {
    expect(rows.map((r) => r.source)).toEqual([...linCompounds, defaultCompound].map((c) => c.source));
  });

  it('mutes a default row; session and calibration rows stay plain', () => {
    expect(rows.map((r) => r.role)).toEqual([undefined, undefined, undefined, 'textDim']);
  });

  it('makes no row without compounds', () => {
    expect(compoundRows([])).toEqual([]);
  });
});
