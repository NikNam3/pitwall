// SP4.3f Task 0b (C62d, C73, C3): the planning round's uiActions cross the wire with the team and the race's conditions;
// the decoder checks the shape and the ranges checkable alone (at most 64 samples: the game's array).
import { describe, expect, it } from 'vitest';
import { decodeUiAction } from '../../src/ui/decode.ts';

const PRACTICE = { sessionUid: '4011121896695002375', weekendId: '548397152' };
const QUALIFYING = { sessionUid: '1234567890123456789', weekendId: '548397152' };
const SAMPLE = { offsetMs: 0, weather: 'clear', trackTempC: 30, trackTempTrend: 'flat', airTempC: 24, airTempTrend: 'flat', rainPct: 12 };
const setWith = (conditions: unknown) => ({ kind: 'plans.race.set', feedId: 'f1', race: { laps: 28, sets: 'fresh', conditions } });

describe('decodeUiAction plans.round.open', () => {
  it('decodes team 0 and no race to itself', () => {
    const action = { kind: 'plans.round.open', feedId: 'f1', qualifying: QUALIFYING, team: 0, practice: [PRACTICE] };
    expect(decodeUiAction(action)).toEqual(action);
  });
  it('rejects a missing team', () =>
    expect(decodeUiAction({ kind: 'plans.round.open', feedId: 'f1', qualifying: QUALIFYING, practice: [PRACTICE] })).toBeUndefined());
});

describe('decodeUiAction plans.race.set conditions', () => {
  it('decodes entered samples to themselves', () => {
    const action = setWith({ kind: 'entered', samples: [SAMPLE] });
    expect(decodeUiAction(action)).toEqual(action);
  });
  it('decodes imported', () => {
    const action = setWith({ kind: 'imported' });
    expect(decodeUiAction(action)).toEqual(action);
  });
  it.each([
    ['rainPct 101', { ...SAMPLE, rainPct: 101 }],
    ['offsetMs -1', { ...SAMPLE, offsetMs: -1 }],
    ['offsetMs 1.5', { ...SAMPLE, offsetMs: 1.5 }],
    ['weather snow', { ...SAMPLE, weather: 'snow' }],
  ])('rejects %s', (_what, sample) => expect(decodeUiAction(setWith({ kind: 'entered', samples: [sample] }))).toBeUndefined());
  it('rejects offsets not strictly rising', () =>
    expect(decodeUiAction(setWith({ kind: 'entered', samples: [SAMPLE, SAMPLE] }))).toBeUndefined());
  it('rejects 0 samples', () => expect(decodeUiAction(setWith({ kind: 'entered', samples: [] }))).toBeUndefined());
  it('rejects 65 samples', () => {
    const samples = Array.from({ length: 65 }, (_, i) => ({ ...SAMPLE, offsetMs: i * 1000 }));
    expect(decodeUiAction(setWith({ kind: 'entered', samples }))).toBeUndefined();
  });
  it('accepts 64 samples', () => {
    const samples = Array.from({ length: 64 }, (_, i) => ({ ...SAMPLE, offsetMs: i * 1000 }));
    expect(decodeUiAction(setWith({ kind: 'entered', samples }))).toEqual(setWith({ kind: 'entered', samples }));
  });
  it('rejects missing conditions', () =>
    expect(decodeUiAction({ kind: 'plans.race.set', feedId: 'f1', race: { laps: 28, sets: 'fresh' } })).toBeUndefined());
});
