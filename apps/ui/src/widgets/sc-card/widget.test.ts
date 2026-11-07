// The sc-card declaration (SP4.2 spec 4, plan Task 12): what it reads and its sizes from the mockup
// (docs/design/2026-11-07-sp4.2/sc-card.html: full 30×3, compact 26×2). It sends no uiAction (C74).
import { carId, feedId } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { widget } from './widget.ts';

describe('sc-card declaration', () => {
  it('is named sc-card and titled "SC / VSC call"', () => {
    expect([widget.name, widget.title]).toEqual(['sc-card', 'SC / VSC call']);
  });

  it('reads scCall.car for the sheet and situation.sessionPhaseRace for the condition that is out', () => {
    expect(Object.fromEntries(Object.entries(widget.data).map(([key, d]) => [key, d.topic]))).toEqual({
      call: 'scCall.car',
      phase: 'situation.sessionPhaseRace',
    });
  });

  it('asks scCall.car for the panel\'s primary car', () => {
    const link = { group: 1, feedId: feedId('f'), primary: carId(3), compare: [carId(4)], window: { kind: 'live' as const } };
    expect(widget.data.call.params?.({ link, options: {} })).toEqual({ carId: carId(3) });
  });

  it('has the mockup sizes: compact 26×2, full 30×3', () => {
    expect(widget.sizes).toEqual({ compact: { minCols: 26, minRows: 2 }, full: { minCols: 30, minRows: 3 } });
  });

  it('sends no uiAction', () => {
    expect(widget.actions).toEqual([]);
  });
});
