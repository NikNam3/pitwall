// SP4.3e Task 0a (C62): `basisKey` names a basis canonically: the practice refs in any order give the same key, and no
// basis with a session shares the key of `NO_BASIS`.
import { describe, expect, it } from 'vitest';
import { basisKey, IMPORTED, NO_BASIS, type SessionBasis } from '../src/index.ts';

const P1 = { sessionUid: '4011121896695002375', weekendId: '548397152' };
const P2 = { sessionUid: '1111111111111111111', weekendId: '548397152' };
const Q = { sessionUid: '2222222222222222222', weekendId: '548397152' };

describe('basisKey', () => {
  it('is equal for the practice refs in different orders', () => {
    const a: SessionBasis = { practice: [P1, P2], qualifying: Q };
    const b: SessionBasis = { practice: [P2, P1], qualifying: Q };
    expect(basisKey(a)).toBe(basisKey(b));
  });
  it.each<[string, SessionBasis]>([
    ['a practice', { practice: [P1], qualifying: null }],
    ['a qualifying', { practice: [], qualifying: Q }],
    ['both', { practice: [P1, P2], qualifying: Q }],
  ])('of NO_BASIS differs from a basis with %s', (_what, basis) => expect(basisKey(basis)).not.toBe(basisKey(NO_BASIS)));
  it('tells a practice from a qualifying of the same session', () =>
    expect(basisKey({ practice: [Q], qualifying: null })).not.toBe(basisKey({ practice: [], qualifying: Q })));
  it('tells different sessions apart', () =>
    expect(basisKey({ practice: [P1], qualifying: null })).not.toBe(basisKey({ practice: [P2], qualifying: null })));
  it('NO_BASIS has no practice and no qualifying', () => expect(NO_BASIS).toEqual({ practice: [], qualifying: null }));
});

describe('IMPORTED', () => {
  it('is the imported race conditions', () => expect(IMPORTED).toEqual({ kind: 'imported' }));
});
