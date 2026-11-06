// The stint-scatter declaration (spec 6, plan Task 13; C74): one data entry, `stintAnalysis.car` for the link group's
// primary car; the mockup sizes (README: compact 36x8, full 72x16); no uiActions.
import { carId, feedId } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import type { ResolvedLink } from '../../kit/types.ts';
import { widget } from './widget.ts';

const link = (primary: number): ResolvedLink =>
  ({ group: 1, feedId: feedId('live'), primary: carId(primary), compare: [], window: { kind: 'session' } }) as unknown as ResolvedLink;

describe('stint-scatter: the declaration', () => {
  it('is named stint-scatter and titled "Stint scatter"', () => {
    expect([widget.name, widget.title]).toEqual(['stint-scatter', 'Stint scatter']);
  });

  it('reads only stintAnalysis.car, as a required state topic', () => {
    expect(Object.keys(widget.data)).toEqual(['analysis']);
    expect(widget.data.analysis).toMatchObject({ topic: 'stintAnalysis.car', kind: 'state' });
    expect(widget.data.analysis).not.toHaveProperty('optional');
  });

  it('asks for the link group\'s primary car', () => {
    expect(widget.data.analysis.params?.({ link: link(7), options: {} })).toEqual({ carId: carId(7) });
    expect(widget.data.analysis.params?.({ link: link(12), options: {} })).toEqual({ carId: carId(12) });
  });

  it('has the mockup sizes: compact 36x8, full 72x16', () => {
    expect(widget.sizes).toEqual({ compact: { minCols: 36, minRows: 8 }, full: { minCols: 72, minRows: 16 } });
  });

  it('sends no uiAction', () => {
    expect(widget.actions).toEqual([]);
  });
});
