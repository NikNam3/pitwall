// A chart's axis label never clips (review 7, R7-9: the gap chart's compact y label showed "behind referen"). The
// label text adapts: a display's text file gives each axis label in its forms (`AxisLabel`, e.g. `behind reference, s`,
// `behind ref, s`, `s`), and the chart draws the longest form that fits the plot's length along that axis. Contract
// assumed of kit/chart/labels.ts:
//  - `type AxisLabel = readonly [string, ...string[]]`: one form at least, in any order;
//  - `fitAxisLabel(forms, roomPx, widthOf)`: the longest form (by characters) whose `widthOf(form)` is at most `roomPx`;
//    among forms of one length the first; no form fits, the empty string: no label rather than a clipped one.
//    `widthOf` is the exact width of a form as drawn (review 8, R8-3): the chart passes the canvas context's
//    `measureText` under the font uPlot set for the label, so no estimate of the font (0.6 x its size) is involved.
// Chart.svelte draws `fitAxisLabel(xLabel, plot width, measure)` and `fitAxisLabel(yLabel, plot height, measure)`, in
// canvas px (kit/chart.test.ts); the fit check (e2e/fit.spec.ts) measures every drawn axis label against its plot in
// every gallery case (R8-2).
import { describe, expect, it } from 'vitest';
import { fitAxisLabel, type AxisLabel } from '../../src/kit/chart/labels.ts';

const CHAR = 8;
/** A monospace font of `px` per character: every form is its characters' width. */
const mono = (px: number) => (form: string): number => form.length * px;
const M = mono(CHAR);
const FORMS: AxisLabel = ['behind reference, s', 'behind ref, s', 's'];

describe('fitAxisLabel', () => {
  it('draws the longest form when the plot has room for it', () => {
    expect(fitAxisLabel(FORMS, 400, M)).toBe('behind reference, s');
  });

  it('fits a form exactly: its width may equal the room', () => {
    expect(fitAxisLabel(FORMS, 19 * CHAR, M)).toBe('behind reference, s');
    expect(fitAxisLabel(FORMS, 13 * CHAR, M)).toBe('behind ref, s');
  });

  it('falls back to a shorter form one pixel short of the longer', () => {
    expect(fitAxisLabel(FORMS, 19 * CHAR - 1, M)).toBe('behind ref, s');
    expect(fitAxisLabel(FORMS, 13 * CHAR - 1, M)).toBe('s');
  });

  it('draws nothing when no form fits', () => {
    expect(fitAxisLabel(FORMS, CHAR - 1, M)).toBe('');
    expect(fitAxisLabel(FORMS, 0, M)).toBe('');
  });

  it('picks by length, whatever order the forms come in', () => {
    const shuffled: AxisLabel = ['s', 'behind reference, s', 'behind ref, s'];
    expect(fitAxisLabel(shuffled, 400, M)).toBe('behind reference, s');
    expect(fitAxisLabel(shuffled, 15 * CHAR, M)).toBe('behind ref, s');
  });

  it('takes the first of forms of one length', () => {
    expect(fitAxisLabel(['gap, s', 'gap  s', 's'], 6 * CHAR, M)).toBe('gap, s');
  });

  it('a single form is drawn when it fits and left out when it does not', () => {
    expect(fitAxisLabel(['lap'], 3 * CHAR, M)).toBe('lap');
    expect(fitAxisLabel(['lap'], 3 * CHAR - 1, M)).toBe('');
  });

  it('scales with the font: a wider font needs more room for the same form', () => {
    expect(fitAxisLabel(FORMS, 160, mono(8))).toBe('behind reference, s');
    expect(fitAxisLabel(FORMS, 160, mono(9))).toBe('behind ref, s');
  });

  it('fits by the measured width, not by the count of characters (a proportional font, a rounded font size)', () => {
    // In this font `behind ref, s` is wider than 13 cells of 8 px and `ref, s` narrower than 6: the measure decides.
    const widths: Record<string, number> = { 'behind ref, s': 130, 'ref, s': 40, s: 6 };
    const measure = (form: string): number => widths[form] ?? Number.NaN;
    const forms: AxisLabel = ['behind ref, s', 'ref, s', 's'];
    expect(fitAxisLabel(forms, 129, measure)).toBe('ref, s');
    expect(fitAxisLabel(forms, 130, measure)).toBe('behind ref, s');
    expect(fitAxisLabel(forms, 39, measure)).toBe('s');
  });
});
