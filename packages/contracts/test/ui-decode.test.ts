import { describe, expect, it } from 'vitest';
import { decodeUiAction } from '../src/ui/decode.ts';

describe('decodeUiAction alertGroup.mute', () => {
  it.each(['strategy', 'tyres', 'energy', 'car', 'damage', 'race', 'feed', 'system'])('accepts the %s category', (category) =>
    expect(decodeUiAction({ kind: 'alertGroup.mute', category, muted: true })).toEqual({ kind: 'alertGroup.mute', category, muted: true }));
  it('rejects an unknown category', () => expect(decodeUiAction({ kind: 'alertGroup.mute', category: 'brakes', muted: true })).toBeUndefined());
});

// SP4.1a Task 4: `calibration.choose` crosses the wire (C62a, C73, C76): a feed and a set of its session's track, or
// `null` for `defaults`. The decoder checks the shape only; the bridge's pipeline resolves the set.
describe('decodeUiAction calibration.choose', () => {
  const actions = [
    { kind: 'calibration.choose', feedId: 'f1', setId: 'dry-baseline' },
    { kind: 'calibration.choose', feedId: 'f1', setId: null },
  ];
  it.each(actions)('decodes calibration.choose with setId $setId', (action) => expect(decodeUiAction(action)).toEqual(action));
  it.each(actions)('drops the unknown fields of calibration.choose with setId $setId', (action) =>
    expect(decodeUiAction({ ...action, snapshot: 'abc', entries: {} })).toEqual(action));

  const invalid: Array<[string, unknown]> = [
    ['a missing feedId', { kind: 'calibration.choose', setId: 'dry' }],
    ['a feedId that is no string', { kind: 'calibration.choose', feedId: 1, setId: 'dry' }],
    ['a missing setId (defaults is an explicit null)', { kind: 'calibration.choose', feedId: 'f1' }],
    ['a setId that is no string', { kind: 'calibration.choose', feedId: 'f1', setId: 7 }],
  ];
  it.each(invalid)('rejects %s', (_what, raw) => expect(decodeUiAction(raw)).toBeUndefined());
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

// SP4.3a Task 6, delegated (R4): the driver-profile uiActions (C62c, C73) cross the wire. The decoder checks their shape
// only and rebuilds them from the known fields; the bridge's profile store validates them against the persons, the
// stored sessions and the entries' declarations.
describe('decodeUiAction drivers', () => {
  const session = { sessionUid: '123', weekendId: '77', feedCar: 0 };
  const actions = [
    { kind: 'drivers.add', person: 'anna', displayName: 'Anna' },
    { kind: 'drivers.link', team: 3, raceNumber: 7, person: 'anna' },
    { kind: 'drivers.link', team: 3, raceNumber: 7, person: null },
    { kind: 'drivers.exclude', person: 'anna', session },
    { kind: 'drivers.override', person: 'anna', key: 'driverNoise.coreScatterMs', value: 310.5 },
    { kind: 'drivers.override.clear', person: 'anna', key: 'driverNoise.coreScatterMs' },
  ];
  it.each(actions)('decodes $kind', (action) => expect(decodeUiAction(action)).toEqual(action));
  it.each(actions)('drops the unknown fields of $kind', (action) =>
    expect(decodeUiAction({ ...action, extra: 1, ...('session' in action && { session: { ...session, extra: 2 } }) })).toEqual(action));

  const invalid: Array<[string, unknown]> = [
    ['a person that is no string', { kind: 'drivers.add', person: 7, displayName: 'Anna' }],
    ['a missing display name', { kind: 'drivers.add', person: 'anna' }],
    ['a link without its team', { kind: 'drivers.link', raceNumber: 7, person: 'anna' }],
    ['a link race number that is no integer', { kind: 'drivers.link', team: 3, raceNumber: '7', person: 'anna' }],
    ['a session uid that is no string', { kind: 'drivers.exclude', person: 'anna', session: { ...session, sessionUid: 123 } }],
    ['a session feed car that is no integer', { kind: 'drivers.exclude', person: 'anna', session: { ...session, feedCar: 0.5 } }],
    ['a session without its weekend', { kind: 'drivers.exclude', person: 'anna', session: { sessionUid: '123', feedCar: 0 } }],
    ['an override value that is no number', { kind: 'drivers.override', person: 'anna', key: 'k', value: '5' }],
    ['an override value that is not finite', { kind: 'drivers.override', person: 'anna', key: 'k', value: Number.NaN }],
    ['an override clear without its key', { kind: 'drivers.override.clear', person: 'anna' }],
  ];
  it.each(invalid)('rejects %s', (_what, raw) => expect(decodeUiAction(raw)).toBeUndefined());
});
