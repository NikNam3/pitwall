// The crossover chart's lines and numbers (SP4.1b spec 4, plan Task 12; C65: the display formats and maps, it computes
// nothing; C68). Contract assumed of `rows.ts`:
//  - `chartSeries(c: Crossover): ChartSeries[]` (the kit chart's series): one line per tyre type that has at least one
//    known median, in the order slick, inter, wet, labelled `slick`, `inter`, `wet`, its points `[lapNumber, medianMs]`
//    at the lap numbers whose median of that type is known, in `byLap`'s order, coloured `{ colour: role(typeRole(type)),
//    dashed: false, ownCar: false }`; then, while `line110Ms` is known and `byLap` has a lap, the 110 % line labelled
//    `110%` from the first to the last lap number of `byLap` at `line110Ms`, dashed in `textDim`; then the dry reference
//    the same way at `dryRefMs`, labelled `dry ref`, dashed in `textFaint` (the mockup's lines);
//  - `crossoverNumbers(c: Crossover, cars: readonly CarOverview[]): CrossoverNumbers`, where
//    `CrossoverNumbers = { us: CellPart; dryRef: CellPart; firstFaster: FirstFasterCells | CellPart; payback: CellPart;
//    paybackSource: EstimateSource | undefined }` and `FirstFasterCells = { code: CellPart; type: TyreType; sector: string;
//    lap: string }`: US our % to one decimal with `%` (`109.3%`), the dry reference as a lap time (kit `formatLapTime`),
//    the first faster car's code (kit `carCodeById`), its type, its sector (kit `sectorNames`, `S2`) and its lap (kit
//    `formatLapNumber`, `L33`); an unknown first faster is the kit unknown part of its reason; the payback in laps to one
//    decimal (kit `formatLaps`, `12.3 laps`) with its loss source for the kit badge, or the unknown part and no source.
import { carId, unknown } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { unknownPart } from '../../kit/grid/grid.ts';
import { role } from '../../theme/index.ts';
import {
  DRY_REF_MS, GAS, KUH, LINE_110_MS, calibrationSource, cars, defaultSource, dry, k, lapOf, notApplicable, sessionSource, wet,
} from './fixtures.ts';
import { chartSeries, crossoverNumbers } from './rows.ts';

const line = (colour: string, dashed: boolean) => ({ colour, dashed, ownCar: false });

describe('chartSeries: the medians per type', () => {
  it('draws one line per type with a known median, in the order slick, inter, wet, then the 110 % line and the dry reference', () => {
    expect(chartSeries(wet()).map((s) => s.label)).toEqual(['slick', 'inter', '110%', 'dry ref']);
  });

  it('puts each type\'s known medians at their lap numbers, unchanged', () => {
    const [slick, inter] = chartSeries(wet());
    expect(slick?.points).toEqual([
      [25, 89_412], [26, 90_200], [27, 90_100], [28, 90_300], [29, 90_400], [30, 91_900], [31, 93_600], [32, 95_200], [33, 96_800], [34, 98_100],
    ]);
    expect(inter?.points).toEqual([[32, 97_400], [33, 96_000], [34, 95_300]]);
  });

  it('colours slick textDim, inter series3 and wet series1, solid', () => {
    const wetToo = { ...wet(), byLap: [lapOf(33, { slick: 96_800, inter: 96_000, wet: 99_000 }), lapOf(34, { slick: 98_100, inter: 95_300, wet: 98_500 })] };
    const byLabel = Object.fromEntries(chartSeries(wetToo).map((s) => [s.label, s.colour]));
    expect(byLabel['slick']).toEqual(line(role('textDim'), false));
    expect(byLabel['inter']).toEqual(line(role('series3'), false));
    expect(byLabel['wet']).toEqual(line(role('series1'), false));
  });

  it('draws no line for a type without a known median', () => {
    expect(chartSeries(dry).map((s) => s.label)).toEqual(['slick', '110%', 'dry ref']);
  });

  it('leaves a lap number out of a type\'s line where its median is unknown', () => {
    const gap = { ...wet(), byLap: [lapOf(32, { inter: 97_400 }), lapOf(33, { inter: 'notReceived' }), lapOf(34, { inter: 95_300 })] };
    expect(chartSeries(gap).find((s) => s.label === 'inter')?.points).toEqual([[32, 97_400], [34, 95_300]]);
  });
});

describe('chartSeries: the 110 % line and the dry reference', () => {
  it('draws the 110 % line from the first to the last lap at line110Ms, dashed textDim', () => {
    expect(chartSeries(wet()).find((s) => s.label === '110%')).toMatchObject({
      points: [[25, LINE_110_MS], [34, LINE_110_MS]],
      colour: line(role('textDim'), true),
    });
  });

  it('takes the 110 % line as the analysis gives it: no multiplication here', () => {
    const odd = { ...wet(), line110Ms: k(100_000) };
    expect(chartSeries(odd).find((s) => s.label === '110%')?.points).toEqual([[25, 100_000], [34, 100_000]]);
  });

  it('draws the dry reference from the first to the last lap at dryRefMs, dashed textFaint', () => {
    expect(chartSeries(dry).find((s) => s.label === 'dry ref')).toMatchObject({
      points: [[16, DRY_REF_MS], [23, DRY_REF_MS]],
      colour: line(role('textFaint'), true),
    });
  });

  it('draws neither line while the dry reference is not known yet', () => {
    const early = { ...dry, byLap: [lapOf(1, {})], dryRefMs: unknown('insufficientData'), line110Ms: unknown('insufficientData') };
    expect(chartSeries(early)).toEqual([]);
  });

  it('draws no line at all when nothing applies (a rival, or no race)', () => {
    expect(chartSeries(notApplicable)).toEqual([]);
  });
});

describe('crossoverNumbers', () => {
  it('shows US as our % to one decimal and the dry reference as a lap time', () => {
    expect(crossoverNumbers(wet(), cars)).toMatchObject({ us: { text: '109.3%' }, dryRef: { text: '1:29.412' } });
    expect(crossoverNumbers(dry, cars)).toMatchObject({ us: { text: '100.6%' }, dryRef: { text: '1:29.412' } });
  });

  it('names the first faster car by its code, its type, sector and lap', () => {
    expect(crossoverNumbers(wet(), cars).firstFaster).toEqual({ code: { text: 'GAS' }, type: 'inter', sector: 'S2', lap: 'L33' });
  });

  it('carries a slick first faster after our switch to inters (B9)', () => {
    const onInters = { ...wet(), ourType: k('inter' as const), firstFaster: k({ carId: carId(KUH), type: 'slick' as const, sector: 1 as const, lapNumber: 40 }) };
    expect(crossoverNumbers(onInters, cars).firstFaster).toEqual({ code: { text: 'KUH' }, type: 'slick', sector: 'S1', lap: 'L40' });
  });

  it('gives a first faster car the field lacks an empty code with the reason (kit carCodeById)', () => {
    const ff = crossoverNumbers(wet(), cars.filter((c) => c.id !== carId(GAS))).firstFaster;
    expect(ff).toMatchObject({ code: { text: '', reason: 'notReceived' }, type: 'inter', sector: 'S2', lap: 'L33' });
  });

  it('shows the payback in laps to one decimal, with the pit loss\'s source for the badge', () => {
    expect(crossoverNumbers(wet(), cars)).toMatchObject({ payback: { text: '12.3 laps' }, paybackSource: sessionSource });
    expect(crossoverNumbers(wet(calibrationSource), cars).paybackSource).toEqual(calibrationSource);
    expect(crossoverNumbers(wet(defaultSource), cars).paybackSource).toEqual(defaultSource);
  });

  it('does no arithmetic of its own: the payback is the topic\'s, only rounded to the tenth', () => {
    const p = { ...wet(), payback: k({ laps: 8.36, lossSource: sessionSource }) };
    expect(crossoverNumbers(p, cars).payback).toEqual({ text: '8.4 laps' });
  });

  it('shows first faster and payback not applicable when no other type is faster (dry)', () => {
    expect(crossoverNumbers(dry, cars)).toMatchObject({
      firstFaster: unknownPart('notApplicable'),
      payback: unknownPart('notApplicable'),
      paybackSource: undefined,
    });
  });

  it('shows every number as its reason\'s part when nothing applies (a rival, or no race)', () => {
    expect(crossoverNumbers(notApplicable, cars)).toEqual({
      us: unknownPart('notApplicable'),
      dryRef: unknownPart('notApplicable'),
      firstFaster: unknownPart('notApplicable'),
      payback: unknownPart('notApplicable'),
      paybackSource: undefined,
    });
  });

  it('keeps an unknown US with its own reason while the dry reference is known', () => {
    const noLap = { ...wet(), ourPct: unknown('insufficientData') };
    expect(crossoverNumbers(noLap, cars)).toMatchObject({ us: unknownPart('insufficientData'), dryRef: { text: '1:29.412' } });
  });
});
