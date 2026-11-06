// The lap overview's rows (spec 4; C65: the display formats and maps, it computes nothing; mockups 4-longrun.html and
// changes.html). Contract assumed of `rows.ts`:
//  - `type LapCell = { lapNumber: number; time: string; mark: string; heat: Known<Ratio>; best; status: LapStatus;
//    strip: string }`: the lap time in minutes and tenths (kit `formatMinutesTenths`), the mark `i` for an in-lap, `o`
//    for an out-lap, '' for a normal lap (wording in text.ts), heat, best and status as the topic gives them (for
//    emphasis), the strip text `VSC`, `SC`, `red` or '' for green (text.ts);
//  - `gridLines(laps: readonly LapOverviewLap[], maxRows?: number): GridLine[]`, the full grid's lines top to bottom,
//    `GridLine = { kind: 'stint'; text } | { kind: 'laps'; label; cells: LapCell[] } | { kind: 'strip'; cells: LapCell[] }`:
//    each stint opens with its title `STINT <n> · <letter>` (kit `COMPOUND_MARK`), then its laps ten to a row aligned to
//    the lap number (a row starts at L01, L11, L21, …, and a stint's first lap), the row's label its first lap as `L01`
//    (kit `formatLapNumber(n, 2)`); under a row holding a lap that is not green, a strip line with the same cells. With
//    `maxRows` (the panel's body rows), strip lines are dropped, the oldest first, before a lap line would be (Task 0 Q4 A);
//  - `compactLine(laps: readonly LapOverviewLap[], cols: number): { label: string; cells: CompactCell[] }`, one cell per
//    lap for the newest `cols − 1` laps (one lead cell), oldest first,
//    `CompactCell = { lapNumber; block: string; heat; best; status; strip: string }`: the block's height by the heat
//    (`▁▂▃▄▅▆▇█`, index = heat × 7 rounded), `·` without heat; the strip `━` under a lap that is not green, else '';
//    the label the newest lap's compound letter, two spaces and the shown laps' range (kit `formatLapRange`); no laps:
//    an empty label and no cells.
import { describe, expect, it } from 'vitest';
import type { LapOverviewLap } from '@pitwall/domain';
import { heat, kuhLaps, lap, linLaps, noHeat } from './fixtures.ts';
import { compactLine, gridLines } from './rows.ts';

const kinds = (laps: LapOverviewLap[], maxRows?: number) => gridLines(laps, maxRows).map((l) => l.kind);
const lapLines = (laps: LapOverviewLap[]) => gridLines(laps).flatMap((l) => (l.kind === 'laps' ? [l] : []));
const cellOf = (laps: LapOverviewLap[], n: number) => lapLines(laps).flatMap((l) => l.cells).find((c) => c.lapNumber === n);

describe('gridLines: the layout', () => {
  it('lays the mockup sample out in seven lines: stint, laps, strip, laps, stint, laps, laps', () => {
    expect(kinds(linLaps())).toEqual(['stint', 'laps', 'strip', 'laps', 'stint', 'laps', 'laps']);
  });

  it('opens each stint with its number and compound letter', () => {
    const titles = gridLines(linLaps()).flatMap((l) => (l.kind === 'stint' ? [l.text] : []));
    expect(titles).toEqual(['STINT 1 · S', 'STINT 2 · H']);
  });

  it('takes the stint number as the topic gives it', () => {
    const titles = gridLines([lap(30, 91_000, { stint: 3, compound: 'medium' })]).flatMap((l) => (l.kind === 'stint' ? [l.text] : []));
    expect(titles).toEqual(['STINT 3 · M']);
  });

  it('puts ten laps to a row aligned to the lap number, a new stint on a new row', () => {
    expect(lapLines(linLaps()).map((l) => l.cells.map((c) => c.lapNumber))).toEqual([
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      [11, 12, 13, 14, 15],
      [16, 17, 18, 19, 20],
      [21, 22, 23],
    ]);
  });

  it('labels each row with its first lap, padded to two digits', () => {
    expect(lapLines(linLaps()).map((l) => l.label)).toEqual(['L01', 'L11', 'L16', 'L21']);
  });

  it('puts a strip line only under a row holding a lap that is not green, with the row\'s cells', () => {
    const lines = gridLines(linLaps());
    const strip = lines[2];
    expect(strip?.kind).toBe('strip');
    expect(strip?.kind === 'strip' && strip.cells.map((c) => c.lapNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(lines.filter((l) => l.kind === 'strip')).toHaveLength(1);
  });

  it('adds a strip under the row of a red lap: the red case needs eight lines (Task 0, 84×8)', () => {
    expect(kinds(linLaps(11))).toEqual(['stint', 'laps', 'strip', 'laps', 'strip', 'stint', 'laps', 'laps']);
  });

  it('drops the oldest strip line first when the lines do not fit, never a lap line (Task 0 Q4 A)', () => {
    expect(kinds(linLaps(11), 7)).toEqual(['stint', 'laps', 'laps', 'strip', 'stint', 'laps', 'laps']);
    expect(kinds(linLaps(11), 6)).toEqual(['stint', 'laps', 'laps', 'stint', 'laps', 'laps']);
  });

  it('keeps every line when they fit', () => {
    expect(gridLines(linLaps(11), 8)).toEqual(gridLines(linLaps(11)));
    expect(gridLines(linLaps(11), 20)).toEqual(gridLines(linLaps(11)));
  });

  it('has no line without laps', () => {
    expect(gridLines([])).toEqual([]);
  });
});

describe('gridLines: the cells', () => {
  it('formats the lap time in minutes and tenths', () => {
    expect([cellOf(linLaps(), 1)?.time, cellOf(linLaps(), 9)?.time, cellOf(linLaps(), 21)?.time]).toEqual(['1:36.1', '1:43.4', '1:30.6']);
    expect(gridLines([lap(2, 90_650)]).flatMap((l) => (l.kind === 'laps' ? l.cells.map((c) => c.time) : []))).toEqual(['1:30.7']);
  });

  it('marks the in-lap `i` and the out-lap `o`, a normal lap nothing', () => {
    expect([cellOf(linLaps(), 15)?.mark, cellOf(linLaps(), 16)?.mark, cellOf(linLaps(), 14)?.mark]).toEqual(['i', 'o', '']);
  });

  it('carries heat, best and status as the topic gives them, unchanged', () => {
    const laps = [lap(2, 91_000, { heat: heat(0.4321), best: 'session' }), lap(3, 92_000, { heat: noHeat, status: 'sc' })];
    expect(lapLines(laps)[0]?.cells.map((c) => [c.heat, c.best, c.status])).toEqual([
      [heat(0.4321), 'session', 'green'],
      [noHeat, 'none', 'sc'],
    ]);
  });

  it('writes the strip text VSC, SC and red, nothing for green', () => {
    const laps = (['green', 'vsc', 'sc', 'red'] as const).map((status, i) => lap(i + 2, 100_000, { status }));
    expect(lapLines(laps)[0]?.cells.map((c) => c.strip)).toEqual(['', 'VSC', 'SC', 'red']);
  });

  it('keeps the personal best of the mockup sample on L21', () => {
    expect(cellOf(linLaps(), 21)?.best).toBe('personal');
  });
});

describe('compactLine', () => {
  it('gives one cell per lap, oldest first, labelled with the compound and the laps shown', () => {
    const line = compactLine(kuhLaps(), 30);
    expect(line.cells.map((c) => c.lapNumber)).toEqual(Array.from({ length: 23 }, (_, i) => i + 1));
    expect(line.label).toBe('M  L01–23');
  });

  it('takes the compound letter of the newest lap', () => {
    expect(compactLine(linLaps(), 30).label).toBe('H  L01–23');
  });

  it('sets the block height by the heat', () => {
    const laps = [0, 0.3, 0.5, 0.86, 1].map((h, i) => lap(i + 2, 91_000, { heat: heat(h) }));
    expect(compactLine(laps, 30).cells.map((c) => c.block)).toEqual(['▁', '▃', '▅', '▇', '█']);
  });

  it('shows a lap without heat as a dot', () => {
    expect(compactLine([lap(1, 96_000)], 30).cells.map((c) => c.block)).toEqual(['·']);
  });

  it('draws the strip under a lap that is not green', () => {
    const laps = (['green', 'vsc', 'sc', 'red'] as const).map((status, i) => lap(i + 2, 100_000, { status }));
    expect(compactLine(laps, 30).cells.map((c) => c.strip)).toEqual(['', '━', '━', '━']);
  });

  it('carries heat, best and status as the topic gives them, for the emphasis', () => {
    const cell = compactLine(kuhLaps(), 30).cells[19];
    expect(cell).toMatchObject({ lapNumber: 20, best: 'session', heat: heat(0), status: 'green', block: '▁' });
  });

  it('shows the newest laps that fit in one lead cell less than the width', () => {
    const laps = Array.from({ length: 52 }, (_, i) => lap(i + 1, 91_000, { compound: 'hard' }));
    const line = compactLine(laps, 30);
    expect(line.cells.map((c) => c.lapNumber)).toEqual(Array.from({ length: 29 }, (_, i) => i + 24));
    expect(line.label).toBe('H  L24–52');
    expect(compactLine(laps, 40).cells).toHaveLength(39);
  });

  it('is empty without laps', () => {
    expect(compactLine([], 30)).toEqual({ label: '', cells: [] });
  });
});
