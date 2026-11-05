import { describe, expect, it } from 'vitest';
import * as text from './text.ts';

// The widget's text file holds the widget's own words; a kit glyph is read from the kit's text, one import path for
// each (review 6, R6-2).
describe('incident-feed text', () => {
  it('has no word for our cars: they read their driver code', () => {
    expect('us' in text).toBe(false);
  });

  it('does not re-export the kit\'s arrow', () => {
    expect('arrow' in text).toBe(false);
  });
});
