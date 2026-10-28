import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createRng } from '../../src/index.ts';

describe('createRng (mulberry32)', () => {
  it('matches the mulberry32 reference sequence for seed 42', () => {
    const r = createRng(42);
    expect([r.next(), r.next(), r.next()]).toEqual([0.6011037519201636, 0.44829055899754167, 0.8524657934904099]);
  });
  it('same seed, same sequence; values in [0,1); int within inclusive bounds', () => {
    fc.assert(fc.property(fc.integer(), fc.integer({ min: -50, max: 50 }), fc.integer({ min: 0, max: 50 }), (seed, min, span) => {
      const a = createRng(seed), b = createRng(seed);
      for (let i = 0; i < 20; i++) {
        const x = a.next();
        expect(x).toBe(b.next());
        expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1);
        const n = a.int(min, min + span); b.int(min, min + span);
        expect(Number.isInteger(n)).toBe(true); expect(n).toBeGreaterThanOrEqual(min); expect(n).toBeLessThanOrEqual(min + span);
      }
    }));
  });
});
