// The forecast-strip declaration (spec 4; C74): one data entry, `weather.forecast`; the mockup sizes
// (docs/design/2026-10-30-sp4a-displays/5-weather.html: compact 34×2, full 56×6 (ruling R10: the accuracy note's own row)); no uiActions.
import { describe, expect, it } from 'vitest';
import { widget } from './widget.ts';

describe('forecast-strip: the declaration', () => {
  it('is named forecast-strip and titled "Forecast"', () => {
    expect([widget.name, widget.title]).toEqual(['forecast-strip', 'Forecast']);
  });

  it('reads only weather.forecast, as a required state topic', () => {
    expect(Object.keys(widget.data)).toEqual(['forecast']);
    expect(widget.data.forecast).toMatchObject({ topic: 'weather.forecast', kind: 'state' });
    expect(widget.data.forecast).not.toHaveProperty('optional');
  });

  it('has the mockup sizes: compact 34×2, full 56×6 (ruling R10: a row for the accuracy note)', () => {
    expect(widget.sizes).toEqual({ compact: { minCols: 34, minRows: 2 }, full: { minCols: 56, minRows: 6 } });
  });

  it('sends no uiAction', () => {
    expect(widget.actions).toEqual([]);
  });
});
