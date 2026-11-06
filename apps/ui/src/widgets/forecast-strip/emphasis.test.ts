// The forecast strip's emphasis (C68; mockup 5-weather.html). Contract assumed of `emphasis.ts`:
//  - `firstRainRole(firstRain: boolean): Role | undefined`: the first rain sample (full: its column; compact: the rain
//    part) white bold, the role `ownCar` (the component sets the weight); every other sample in the text colour. The
//    widget holds no threshold: which sample is the first rain is the topic's `firstRainIndex` (C43);
//  - `labelRole: Role`: the row labels and the minutes row are faint (`textFaint`);
//  - `noteRole: Role`: the `approximate` note is dim (`textDim`).
// Colour only to highlight: nothing else of the strip takes a role here.
import { describe, expect, it } from 'vitest';
import { firstRainRole, labelRole, noteRole } from './emphasis.ts';

describe('firstRainRole', () => {
  it('marks the first rain sample white bold (the ownCar role)', () => {
    expect(firstRainRole(true)).toBe('ownCar');
  });

  it('leaves every other sample in the text colour', () => {
    expect(firstRainRole(false)).toBeUndefined();
  });
});

describe('labels and the note', () => {
  it('makes the row labels and the minutes row faint', () => {
    expect(labelRole).toBe('textFaint');
  });

  it('makes the accuracy note dim', () => {
    expect(noteRole).toBe('textDim');
  });
});
