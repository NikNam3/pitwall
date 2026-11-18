// SP4.3e Task 0a (C62, C62d, C73, C76): the basis and planning-round uiActions cross the wire. The decoder checks their
// shape and the ranges checkable alone (race laps a whole number of at least 1); the bridge checks the sessions and plans.
import { describe, expect, it } from 'vitest';
import { decodeUiAction } from '../../src/ui/decode.ts';

const PRACTICE = { sessionUid: '4011121896695002375', weekendId: '548397152' };
const QUALIFYING = { sessionUid: '1234567890123456789', weekendId: '548397152' };

describe('decodeUiAction basis.choose', () => {
  it('decodes a practice basis without a qualifying and no plan', () => {
    const action = { kind: 'basis.choose', feedId: 'udp-20777', basis: { practice: [PRACTICE], qualifying: null }, plan: null };
    expect(decodeUiAction(action)).toEqual(action);
  });
  it('decodes a basis with a qualifying and a plan id', () => {
    const action = { kind: 'basis.choose', feedId: 'udp-20777', basis: { practice: [], qualifying: QUALIFYING }, plan: 'texas-0940' };
    expect(decodeUiAction(action)).toEqual(action);
  });
  it('decodes a missing plan as keep (undefined)', () => {
    const decoded = decodeUiAction({ kind: 'basis.choose', feedId: 'f1', basis: { practice: [], qualifying: null } });
    expect(decoded).toEqual({ kind: 'basis.choose', feedId: 'f1', basis: { practice: [], qualifying: null }, plan: undefined });
  });
  const invalid: Array<[string, unknown]> = [
    ['a practice that is no list', { kind: 'basis.choose', feedId: 'f1', basis: { practice: 'x', qualifying: null }, plan: null }],
    ['a practice ref without a weekend id', { kind: 'basis.choose', feedId: 'f1', basis: { practice: [{ sessionUid: '1' }], qualifying: null }, plan: null }],
    ['a missing qualifying (none is an explicit null)', { kind: 'basis.choose', feedId: 'f1', basis: { practice: [] }, plan: null }],
    ['a plan that is no string', { kind: 'basis.choose', feedId: 'f1', basis: { practice: [], qualifying: null }, plan: 3 }],
    ['a missing feedId', { kind: 'basis.choose', basis: { practice: [], qualifying: null }, plan: null }],
  ];
  it.each(invalid)('rejects %s', (_what, raw) => expect(decodeUiAction(raw)).toBeUndefined());
});

describe('decodeUiAction plans.round.open', () => {
  it('decodes a qualifying and its practice', () => {
    const action = { kind: 'plans.round.open', feedId: 'f1', qualifying: QUALIFYING, practice: [PRACTICE] };
    expect(decodeUiAction(action)).toEqual(action);
  });
  it('rejects a missing qualifying', () => expect(decodeUiAction({ kind: 'plans.round.open', feedId: 'f1', qualifying: null, practice: [] })).toBeUndefined());
});

describe('decodeUiAction plans.race.set', () => {
  it.each(['carried', 'fresh'])('decodes sets %s', (sets) => {
    const action = { kind: 'plans.race.set', feedId: 'f1', race: { laps: 28, sets } };
    expect(decodeUiAction(action)).toEqual(action);
  });
  it('rejects unknown sets', () => expect(decodeUiAction({ kind: 'plans.race.set', feedId: 'f1', race: { laps: 28, sets: 'new' } })).toBeUndefined());
  it.each([0, -1, 2.5])('rejects laps %s (a whole number of at least 1)', (laps) =>
    expect(decodeUiAction({ kind: 'plans.race.set', feedId: 'f1', race: { laps, sets: 'fresh' } })).toBeUndefined());
});

describe('decodeUiAction saved plans', () => {
  it('decodes plans.save without a name', () => expect(decodeUiAction({ kind: 'plans.save', feedId: 'f1' })).toEqual({ kind: 'plans.save', feedId: 'f1' }));
  it('decodes plans.save with a name and the plan it replaces', () => {
    const action = { kind: 'plans.save', feedId: 'f1', name: 'Texas', replaces: 'texas-0940' };
    expect(decodeUiAction(action)).toEqual(action);
  });
  it('rejects plans.save with a name that is no string', () => expect(decodeUiAction({ kind: 'plans.save', feedId: 'f1', name: 1 })).toBeUndefined());
  it('decodes plans.rename', () => {
    const action = { kind: 'plans.rename', feedId: 'f1', id: 'texas-0940', name: 'Texas dry' };
    expect(decodeUiAction(action)).toEqual(action);
  });
  it('rejects plans.rename without a name', () => expect(decodeUiAction({ kind: 'plans.rename', feedId: 'f1', id: 'texas-0940' })).toBeUndefined());
  it('decodes plans.delete', () => expect(decodeUiAction({ kind: 'plans.delete', feedId: 'f1', id: 'x' })).toEqual({ kind: 'plans.delete', feedId: 'f1', id: 'x' }));
  it('rejects plans.delete without an id', () => expect(decodeUiAction({ kind: 'plans.delete', feedId: 'f1' })).toBeUndefined());
});
