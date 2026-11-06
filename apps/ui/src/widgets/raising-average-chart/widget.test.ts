// The raising-average-chart declaration (spec 4, plan Task 9; Task 0 answers Q2, Q3 A; C74): `raisingAverage.field`, the
// field's `cars.overview` and, optional, `session.info` (our cars: the player and the teammate); the options
// `rival1`–`rival3`, car options whose unset choice is no car; the sizes of the approved mockup; no uiActions.
import { carId, feedId } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import type { ResolvedLink } from '../../kit/types.ts';
import { widget } from './widget.ts';

const link = { group: 1, feedId: feedId('live'), primary: carId(0), compare: [], window: { kind: 'live' } } as unknown as ResolvedLink;

describe('raising-average-chart: the declaration', () => {
  it('is named raising-average-chart and titled "Raising average"', () => {
    expect([widget.name, widget.title]).toEqual(['raising-average-chart', 'Raising average']);
  });

  it('reads raisingAverage.field and cars.overview, required, and session.info, optional', () => {
    expect(Object.keys(widget.data).sort()).toEqual(['analysis', 'cars', 'session']);
    expect(widget.data.analysis).toMatchObject({ topic: 'raisingAverage.field', kind: 'state' });
    expect(widget.data.analysis).not.toHaveProperty('optional');
    expect(widget.data.cars).toMatchObject({ topic: 'cars.overview' });
    expect(widget.data.cars).not.toHaveProperty('optional');
    expect(widget.data.session).toMatchObject({ topic: 'session.info', optional: true });
  });

  it('asks every topic without params (one value holds every car)', () => {
    const entries = Object.values(widget.data) as Array<{ params?: (ctx: { link: ResolvedLink; options: Record<string, unknown> }) => unknown }>;
    for (const d of entries) expect(d.params?.({ link, options: {} }) ?? {}).toEqual({});
  });

  it('has the options Rival 1 to Rival 3, car options unset to none', () => {
    expect(Object.keys(widget.options)).toEqual(['rival1', 'rival2', 'rival3']);
    expect(widget.options).toEqual({
      rival1: { kind: 'car', label: 'Rival 1', default: undefined, unset: 'none' },
      rival2: { kind: 'car', label: 'Rival 2', default: undefined, unset: 'none' },
      rival3: { kind: 'car', label: 'Rival 3', default: undefined, unset: 'none' },
    });
  });

  it('has the mockup sizes: compact 36x8, full 60x14', () => {
    expect(widget.sizes).toEqual({ compact: { minCols: 36, minRows: 8 }, full: { minCols: 60, minRows: 14 } });
  });

  it('sends no uiAction', () => {
    expect(widget.actions).toEqual([]);
  });
});
