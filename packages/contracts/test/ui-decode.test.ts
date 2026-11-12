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

// SP4.3b Task 17, delegated (C73, C76; spec §8.2): `plan.commit` and `plan.clear` cross the wire. The decoder checks
// their shape and the ranges it can check alone: `feedId` a string, `carId` a car slot (0…21), stop laps whole, at least 1 and strictly
// ascending, known compounds, triggers of the closed kinds with their fields; it rebuilds them from the known fields.
// The race's laps are the bridge's check; whether the plan can still be followed is `strategy`'s (C43).
describe('decodeUiAction plan', () => {
  const policy = {
    stops: [{ lap: 12, compound: 'medium' }, { lap: 30, compound: 'hard' }],
    triggers: [
      { kind: 'neutralised', condition: 'sc', fromLap: 8, toLap: 30, action: { box: 'medium' } },
      { kind: 'neutralised', condition: 'vsc', fromLap: 8, toLap: 30, action: 'stayOut' },
      { kind: 'rain', wetnessMs: 4_000, action: { box: 'inter' } },
      { kind: 'rivalPits', carId: 5, withinMs: 1_500, action: 'cover' },
      { kind: 'rivalPits', carId: 6, withinMs: 1_500, action: 'extend' },
      { kind: 'degradationOff', wearRateDeltaPct: 20, action: { switchTo: [{ lap: 24, compound: 'soft' }] } },
      { kind: 'damage', lossMsPerLap: 800, action: { box: 'wet' } },
    ],
  };
  // `feedId`: the feed the user commits from; the bridge routes the plan to that feed's team (`TeamFeeds.teamOf`), as
  // `calibration.choose` names its feed.
  const actions = [
    { kind: 'plan.commit', feedId: 'f1', carId: 0, policy },
    { kind: 'plan.commit', feedId: 'f1', carId: 21, policy: { stops: [], triggers: [] } },
    { kind: 'plan.clear', feedId: 'f2', carId: 3 },
  ];
  it.each(actions)('decodes $kind for car $carId', (action) => expect(decodeUiAction(action)).toEqual(action));
  it('drops the unknown fields of plan.commit, its stops and its triggers', () => {
    const raw = {
      kind: 'plan.commit', feedId: 'f1', carId: 0, extra: 1,
      policy: { ...policy, score: 3, stops: policy.stops.map((s) => ({ ...s, x: 1 })), triggers: policy.triggers.map((t) => ({ ...t, x: 1 })) },
    };
    expect(decodeUiAction(raw)).toEqual({ kind: 'plan.commit', feedId: 'f1', carId: 0, policy });
  });

  const commit = (over: Record<string, unknown>) => ({ kind: 'plan.commit', feedId: 'f1', carId: 0, policy, ...over });
  const withStops = (stops: unknown) => commit({ policy: { ...policy, stops } });
  const withTrigger = (trigger: unknown) => commit({ policy: { ...policy, triggers: [trigger] } });
  const invalid: Array<[string, unknown]> = [
    ['a commit without its car', { kind: 'plan.commit', feedId: 'f1', policy }],
    ['a commit without its feed', { kind: 'plan.commit', carId: 0, policy }],
    ['a feed that is no string', commit({ feedId: 7 })],
    ['a car that is no slot (22)', commit({ carId: 22 })],
    ['a car that is no slot (-1)', commit({ carId: -1 })],
    ['a car that is no integer', commit({ carId: 0.5 })],
    ['a commit without its policy', { kind: 'plan.commit', feedId: 'f1', carId: 0 }],
    ['a policy without triggers', commit({ policy: { stops: policy.stops } })],
    ['a stop lap below 1', withStops([{ lap: 0, compound: 'hard' }])],
    ['a stop lap that is no integer', withStops([{ lap: 12.5, compound: 'hard' }])],
    ['stop laps not ascending', withStops([{ lap: 30, compound: 'hard' }, { lap: 12, compound: 'medium' }])],
    ['two stops on one lap', withStops([{ lap: 12, compound: 'hard' }, { lap: 12, compound: 'medium' }])],
    ['an unknown compound', withStops([{ lap: 12, compound: 'supersoft' }])],
    ['a trigger of an unknown kind', withTrigger({ kind: 'blueFlag', action: 'stayOut' })],
    ['a neutralised trigger of an unknown condition', withTrigger({ kind: 'neutralised', condition: 'red', fromLap: 1, toLap: 2, action: 'stayOut' })],
    ['a rain trigger boxing for an unknown compound', withTrigger({ kind: 'rain', wetnessMs: 4_000, action: { box: 'slick' } })],
    ['a rivalPits trigger with an unknown action', withTrigger({ kind: 'rivalPits', carId: 5, withinMs: 1_500, action: 'mirror' })],
    ['a rivalPits trigger on no car slot', withTrigger({ kind: 'rivalPits', carId: 30, withinMs: 1_500, action: 'cover' })],
    ['a degradationOff trigger with a non-finite threshold', withTrigger({ kind: 'degradationOff', wearRateDeltaPct: Number.NaN, action: { switchTo: [] } })],
    ['a degradationOff trigger whose plan is not ascending', withTrigger({ kind: 'degradationOff', wearRateDeltaPct: 20, action: { switchTo: [{ lap: 30, compound: 'hard' }, { lap: 20, compound: 'hard' }] } })],
    ['a damage trigger without its threshold', withTrigger({ kind: 'damage', action: { box: 'hard' } })],
    ['a clear without its car', { kind: 'plan.clear', feedId: 'f1' }],
    ['a clear without its feed', { kind: 'plan.clear', carId: 3 }],
    ['a clear of no car slot', { kind: 'plan.clear', feedId: 'f1', carId: 22 }],
  ];
  it.each(invalid)('an invalid policy is rejected and never stored: %s', (_what, raw) => expect(decodeUiAction(raw)).toBeUndefined());
});
