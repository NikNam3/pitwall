// The Box call declaration (SP4.3d spec §6.3, V18 reworked; mockup docs/design/2026-11-16-sp4.3d/sc-card.html: full
// 58×23, compact 26×3): the widget id stays `sc-card`, its title "Box call" from `text.ts` (C68). It sends no uiAction (C74).
import { carId, feedId } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import * as text from './text.ts';
import { widget } from './widget.ts';

describe('sc-card declaration', () => {
  it('is named sc-card and titled "Box call" (text.ts)', () => {
    expect([widget.name, widget.title]).toEqual(['sc-card', 'Box call']);
    expect(text.title).toBe('Box call');
  });

  it('reads scCall.car for the blocks and situation.sessionPhaseRace for the condition that is out', () => {
    expect(Object.fromEntries(Object.entries(widget.data).map(([key, d]) => [key, d.topic]))).toEqual({
      call: 'scCall.car',
      phase: 'situation.sessionPhaseRace',
    });
  });

  it('asks scCall.car for the panel\'s primary car', () => {
    const link = { group: 1, feedId: feedId('f'), primary: carId(3), compare: [carId(4)], window: { kind: 'live' as const } };
    expect(widget.data.call.params?.({ link, options: {} })).toEqual({ carId: carId(3) });
  });

  it('has the mockup sizes: compact 26×3, full 58×23', () => {
    expect(widget.sizes).toEqual({ compact: { minCols: 26, minRows: 3 }, full: { minCols: 58, minRows: 23 } });
  });

  it('sends no uiAction', () => {
    expect(widget.actions).toEqual([]);
  });
});
