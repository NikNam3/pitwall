// The lap-overview-grid declaration (spec 4; C74): one data entry, `lapOverview.car` for the link group's primary car;
// the Task 0 sizes (docs/design/2026-11-06-sp4.1b/README.md Q4 A: compact 30×3, full minimum 84×7, a strip row dropped
// before a lap row); no uiActions.
import { carId, feedId } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import type { ResolvedLink } from '../../kit/types.ts';
import { widget } from './widget.ts';

const link = (primary: number): ResolvedLink =>
  ({ group: 1, feedId: feedId('live'), primary: carId(primary), compare: [], window: { kind: 'session' } }) as unknown as ResolvedLink;

describe('lap-overview-grid: the declaration', () => {
  it('is named lap-overview-grid and titled "Lap overview"', () => {
    expect([widget.name, widget.title]).toEqual(['lap-overview-grid', 'Lap overview']);
  });

  it('reads only lapOverview.car, as a required state topic', () => {
    expect(Object.keys(widget.data)).toEqual(['overview']);
    expect(widget.data.overview).toMatchObject({ topic: 'lapOverview.car', kind: 'state' });
    expect(widget.data.overview).not.toHaveProperty('optional');
  });

  it('asks for the link group\'s primary car', () => {
    expect(widget.data.overview.params?.({ link: link(1), options: {} })).toEqual({ carId: carId(1) });
    expect(widget.data.overview.params?.({ link: link(14), options: {} })).toEqual({ carId: carId(14) });
  });

  it('has the Task 0 sizes: compact 30×3, full 84×7', () => {
    expect(widget.sizes).toEqual({ compact: { minCols: 30, minRows: 3 }, full: { minCols: 84, minRows: 7 } });
  });

  it('sends no uiAction', () => {
    expect(widget.actions).toEqual([]);
  });
});
