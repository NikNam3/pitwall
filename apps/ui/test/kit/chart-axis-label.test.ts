// A chart's axis label never clips (review 7, R7-9: the gap chart's compact y label showed "behind referen"). The
// label text adapts: a display's text file gives each axis label in its forms (`AxisLabel`, e.g. `behind reference, s`,
// `behind ref, s`, `s`), and the chart draws the longest form that fits the plot's length along that axis. Contract
// assumed of kit/chart/labels.ts:
//  - `type AxisLabel = readonly [string, ...string[]]`: one form at least, in any order;
//  - `fitAxisLabel(forms, roomPx, charPx)`: the longest form whose `length * charPx` is at most `roomPx` (the label font
//    is the grid's monospace font, so a form takes its characters' cells); among forms of one length the first; no form
//    fits, the empty string: no label rather than a clipped one.
// Chart.svelte draws `fitAxisLabel(xLabel, plot width, cell width)` and `fitAxisLabel(yLabel, plot height, cell width)`,
// in the same pixels; the fit check (e2e/fit.spec.ts) measures every drawn label against its canvas in every gallery case.
import { describe, expect, it } from 'vitest';
import { fitAxisLabel, type AxisLabel } from '../../src/kit/chart/labels.ts';

const CHAR = 8;
const FORMS: AxisLabel = ['behind reference, s', 'behind ref, s', 's'];

describe('fitAxisLabel', () => {
  it('draws the longest form when the plot has room for it', () => {
    expect(fitAxisLabel(FORMS, 400, CHAR)).toBe('behind reference, s');
  });

  it('fits a form exactly: its width may equal the room', () => {
    expect(fitAxisLabel(FORMS, 19 * CHAR, CHAR)).toBe('behind reference, s');
    expect(fitAxisLabel(FORMS, 13 * CHAR, CHAR)).toBe('behind ref, s');
  });

  it('falls back to a shorter form one pixel short of the longer', () => {
    expect(fitAxisLabel(FORMS, 19 * CHAR - 1, CHAR)).toBe('behind ref, s');
    expect(fitAxisLabel(FORMS, 13 * CHAR - 1, CHAR)).toBe('s');
  });

  it('draws nothing when no form fits', () => {
    expect(fitAxisLabel(FORMS, CHAR - 1, CHAR)).toBe('');
    expect(fitAxisLabel(FORMS, 0, CHAR)).toBe('');
  });

  it('picks by length, whatever order the forms come in', () => {
    const shuffled: AxisLabel = ['s', 'behind reference, s', 'behind ref, s'];
    expect(fitAxisLabel(shuffled, 400, CHAR)).toBe('behind reference, s');
    expect(fitAxisLabel(shuffled, 15 * CHAR, CHAR)).toBe('behind ref, s');
  });

  it('takes the first of forms of one length', () => {
    expect(fitAxisLabel(['gap, s', 'gap  s', 's'], 6 * CHAR, CHAR)).toBe('gap, s');
  });

  it('a single form is drawn when it fits and left out when it does not', () => {
    expect(fitAxisLabel(['lap'], 3 * CHAR, CHAR)).toBe('lap');
    expect(fitAxisLabel(['lap'], 3 * CHAR - 1, CHAR)).toBe('');
  });

  it('scales with the cell: a wider font needs more room for the same form', () => {
    expect(fitAxisLabel(FORMS, 160, 8)).toBe('behind reference, s');
    expect(fitAxisLabel(FORMS, 160, 9)).toBe('behind ref, s');
  });
});
