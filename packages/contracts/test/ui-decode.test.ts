import { describe, expect, it } from 'vitest';
import { decodeUiAction } from '../src/ui/decode.ts';

describe('decodeUiAction alertGroup.mute', () => {
  it.each(['strategy', 'tyres', 'energy', 'car', 'damage', 'race', 'feed', 'system'])('accepts the %s category', (category) =>
    expect(decodeUiAction({ kind: 'alertGroup.mute', category, muted: true })).toEqual({ kind: 'alertGroup.mute', category, muted: true }));
  it('rejects an unknown category', () => expect(decodeUiAction({ kind: 'alertGroup.mute', category: 'brakes', muted: true })).toBeUndefined());
});

// SP4.1a Task 5, delegated (R5): the calibration uiActions (C62a, C73) cross the wire. The decoder checks their shape
// only and rebuilds them from the known fields; the calibration store validates them against the sets and the stored
// sessions. `calibration.choose` is Task 4's.
describe('decodeUiAction calibration', () => {
  const source = { sessionUid: '123', weekendId: '77', feedCar: 0, car: 1, firstLap: 11, excludedLaps: [13, 14] };
  const at = { trackId: 10, setId: 'dry-baseline' };
  const actions = [
    { kind: 'calibration.set.create', trackId: 10, name: 'Dry baseline' },
    { kind: 'calibration.set.copy', ...at, name: 'Dry copy' },
    { kind: 'calibration.set.rename', ...at, name: 'Dry v2' },
    { kind: 'calibration.set.delete', ...at },
    { kind: 'calibration.source.add', ...at, source },
    { kind: 'calibration.source.remove', ...at, source },
    { kind: 'calibration.lap.exclude', ...at, source, lap: 12 },
    { kind: 'calibration.lap.include', ...at, source, lap: 13 },
    { kind: 'calibration.override.set', ...at, key: 'degradation.nuMsPerLap.medium', value: 55.5 },
    { kind: 'calibration.override.clear', ...at, key: 'degradation.nuMsPerLap.medium' },
  ];
  it.each(actions)('decodes $kind', (action) => expect(decodeUiAction(action)).toEqual(action));
  it.each(actions)('drops the unknown fields of $kind', (action) =>
    expect(decodeUiAction({ ...action, extra: 1, ...('source' in action && { source: { ...source, extra: 2 } }) })).toEqual(action));

  const invalid: Array<[string, unknown]> = [
    ['a trackId that is no integer', { kind: 'calibration.set.create', trackId: 10.5, name: 'x' }],
    ['a name that is no string', { kind: 'calibration.set.create', trackId: 10, name: 3 }],
    ['a missing setId', { kind: 'calibration.set.delete', trackId: 10 }],
    ['a missing source', { kind: 'calibration.source.add', ...at }],
    ['a source car that is no integer', { kind: 'calibration.source.add', ...at, source: { ...source, car: '1' } }],
    ['a source without its first lap', { kind: 'calibration.source.remove', ...at, source: { ...source, firstLap: undefined } }],
    ['excluded laps that are no integers', { kind: 'calibration.source.add', ...at, source: { ...source, excludedLaps: [1, 'x'] } }],
    ['a lap that is no integer', { kind: 'calibration.lap.exclude', ...at, source, lap: '12' }],
    ['an override value that is no number', { kind: 'calibration.override.set', ...at, key: 'k', value: '5' }],
    ['an override without its key', { kind: 'calibration.override.clear', ...at }],
  ];
  it.each(invalid)('rejects %s', (_what, raw) => expect(decodeUiAction(raw)).toBeUndefined());
});
