// `track-wetness` declares `decisions` (SP4.3e Task 7a-2, round 2; C41, C62, spec §4.2): its dry reference reads the
// basis's sessions (`dry-reference.ts`, `weekendFieldReference`), and `view.basis` follows the projection's newest
// `basisChosen` decision, so the calculator declares `decisions` in its `reads` (C62).
import { describe, expect, it } from 'vitest';
import { trackWetnessCalculator } from '../../src/track-wetness/calculator.ts';

describe('track-wetness reads view.basis (C62)', () => {
  it('the calculator declares decisions in its reads', () => {
    expect(trackWetnessCalculator.reads).toContain('decisions');
  });
});
