// The run grouping of `Bar`: fill, empty and marker cells keep their own tone.
import { describe, expect, it } from 'vitest';
import { known, unknown, type SessionTime } from '@pitwall/domain';
import { barCells, barRuns } from '../../src/kit/bar/bar.ts';

const at = 0 as SessionTime;

describe('barRuns', () => {
  it('groups equal tones and treats limit, marker and reserve as marks', () => {
    const cells = barCells({ value: known(0.5, at), min: 0, max: 1, cols: 10, limit: 0.9, reserve: 0.1 });
    expect(barRuns(cells)).toEqual([
      { text: '█', tone: 'fill' },
      { text: '¦', tone: 'mark' },
      { text: '███', tone: 'fill' },
      { text: '░░░░', tone: 'empty' },
      { text: '|', tone: 'mark' },
    ]);
  });

  it('an unknown value is one empty run', () => {
    const cells = barCells({ value: unknown('notReceived'), min: 0, max: 1, cols: 4 });
    expect(barRuns(cells)).toEqual([{ text: '░░░░', tone: 'empty' }]);
  });
});
