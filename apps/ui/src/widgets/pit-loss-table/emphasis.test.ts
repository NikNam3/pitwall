// The pit-loss table's emphasis (C68; mockups 4-longrun.html and source-badge.html): a condition resting on a default
// is muted (dim); a stop that does not count (no clean reference, or a penalty served, R12) is faint. Colour only to
// highlight: nothing else of the table takes a role here (our cars take the kit's own-car role).
import { describe, expect, it } from 'vitest';
import { conditionRole, stopRole } from './emphasis.ts';

describe('conditionRole', () => {
  it('mutes a condition whose loss is a default', () => {
    expect(conditionRole('default')).toBe('textDim');
  });

  it('leaves a measured or calibrated condition in the text colour', () => {
    expect(conditionRole('session')).toBeUndefined();
    expect(conditionRole('calibration')).toBeUndefined();
  });
});

describe('stopRole', () => {
  it('leaves a counted stop in the text colour', () => {
    expect(stopRole('used')).toBeUndefined();
  });

  it('makes a stop without clean reference laps faint', () => {
    expect(stopRole('noReference')).toBe('textFaint');
  });

  it('makes a stop that served a penalty faint', () => {
    expect(stopRole('penalty')).toBe('textFaint');
  });
});
