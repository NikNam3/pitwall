// The crossover chart's emphasis (C68; mockup 5-weather.html): tyre types are told apart by colour, the one place colour
// distinguishes here (slick grey `textDim`, inter `series3`, wet `series1`); the 110 % line dim, the dry reference faint.
// Contract assumed of `emphasis.ts`: `typeRole(type: TyreType): Role` and `referenceRole: { line110: Role; dryRef: Role }`.
import { describe, expect, it } from 'vitest';
import { referenceRole, typeRole } from './emphasis.ts';

describe('typeRole', () => {
  it('draws slick in textDim', () => {
    expect(typeRole('slick')).toBe('textDim');
  });

  it('draws inter in series3', () => {
    expect(typeRole('inter')).toBe('series3');
  });

  it('draws wet in series1', () => {
    expect(typeRole('wet')).toBe('series1');
  });
});

describe('referenceRole', () => {
  it('draws the 110 % line in textDim and the dry reference in textFaint', () => {
    expect(referenceRole).toEqual({ line110: 'textDim', dryRef: 'textFaint' });
  });
});
