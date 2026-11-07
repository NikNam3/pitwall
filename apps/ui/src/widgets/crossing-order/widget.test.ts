// The crossing-order declaration (SP4.2 spec §4): what it reads and its sizes from the mockup
// (docs/design/2026-10-30-sp4a-displays/1-ghost-views.html: full 54×9, compact 20×7). It sends no uiAction (C74).
import { carId } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { widget } from './widget.ts';

describe('crossing-order declaration', () => {
  it('is named crossing-order and titled "Crossing order"', () => {
    expect([widget.name, widget.title]).toEqual(['crossing-order', 'Crossing order']);
  });

  it('reads rejoin.car, the race session phase, cars.overview for the codes and session.info for our cars', () => {
    expect(Object.fromEntries(Object.entries(widget.data).map(([key, d]) => [key, d.topic]))).toEqual({
      rejoin: 'rejoin.car',
      phase: 'situation.sessionPhaseRace',
      cars: 'cars.overview',
      session: 'session.info',
    });
  });

  it('reads rejoin.car for the link group\'s primary car', () => {
    const params = (widget.data.rejoin as unknown as { params: (ctx: { link: { primary: number } }) => unknown }).params;
    expect(params({ link: { primary: carId(4) } })).toEqual({ carId: carId(4) });
  });

  it('has the mockup sizes: compact 20×7, full 54×9', () => {
    expect(widget.sizes).toEqual({ compact: { minCols: 20, minRows: 7 }, full: { minCols: 54, minRows: 9 } });
  });

  it('sends no uiAction', () => {
    expect(widget.actions).toEqual([]);
  });
});
