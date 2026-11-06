// The pit-loss-table declaration (spec 6, plan Task 14): what it reads and its sizes from the mockup
// (docs/design/2026-11-06-sp4.1a/README.md: compact 18×3, full 32×13). It sends no uiAction (C74).
import { describe, expect, it } from 'vitest';
import { widget } from './widget.ts';

describe('pit-loss-table declaration', () => {
  it('is named pit-loss-table and titled "Pit loss"', () => {
    expect([widget.name, widget.title]).toEqual(['pit-loss-table', 'Pit loss']);
  });

  it('reads pitLosses.track for the table, cars.overview for the driver codes and session.info for our cars', () => {
    expect(Object.fromEntries(Object.entries(widget.data).map(([key, d]) => [key, d.topic]))).toEqual({
      losses: 'pitLosses.track',
      cars: 'cars.overview',
      session: 'session.info',
    });
  });

  it('has the mockup sizes: compact 18×3, full 32×13', () => {
    expect(widget.sizes).toEqual({ compact: { minCols: 18, minRows: 3 }, full: { minCols: 32, minRows: 13 } });
  });

  it('sends no uiAction', () => {
    expect(widget.actions).toEqual([]);
  });
});
