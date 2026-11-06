// The crossover-chart declaration (SP4.1b spec 4, plan Task 12; C74): `crossover.car` for the link group's primary car,
// `cars.overview` for the first faster car's code (the mockup names it, `GAS`); the mockup sizes (compact 40×3, full
// 72×16); no uiActions.
import { carId, feedId } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import type { ResolvedLink } from '../../kit/types.ts';
import { widget } from './widget.ts';

const link = (primary: number): ResolvedLink =>
  ({ group: 1, feedId: feedId('live'), primary: carId(primary), compare: [], window: { kind: 'session' } }) as unknown as ResolvedLink;

describe('crossover-chart: the declaration', () => {
  it('is named crossover-chart and titled "Crossover"', () => {
    expect([widget.name, widget.title]).toEqual(['crossover-chart', 'Crossover']);
  });

  it('reads crossover.car and cars.overview, both required state topics', () => {
    expect(Object.fromEntries(Object.entries(widget.data).map(([key, d]) => [key, d.topic]))).toEqual({
      crossover: 'crossover.car',
      cars: 'cars.overview',
    });
    expect(widget.data.crossover).toMatchObject({ kind: 'state' });
    expect(widget.data.crossover).not.toHaveProperty('optional');
    expect(widget.data.cars).not.toHaveProperty('optional');
  });

  it('asks crossover.car for the link group\'s primary car', () => {
    expect(widget.data.crossover.params?.({ link: link(0), options: {} })).toEqual({ carId: carId(0) });
    expect(widget.data.crossover.params?.({ link: link(1), options: {} })).toEqual({ carId: carId(1) });
  });

  it('has the mockup sizes: compact 40×3, full 72×16', () => {
    expect(widget.sizes).toEqual({ compact: { minCols: 40, minRows: 3 }, full: { minCols: 72, minRows: 16 } });
  });

  it('sends no uiAction', () => {
    expect(widget.actions).toEqual([]);
  });
});
