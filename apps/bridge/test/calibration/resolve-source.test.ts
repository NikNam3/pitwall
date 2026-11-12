// A calibration source resolved against the stored sessions (C62a; SP4.3a plan Task 12, delegated): `resolveSource`
// gives a unit's priors aggregate, besides the stint and its laps, the session's AI difficulty, from the stored row's
// game settings (`settings.aiDifficulty`; `notReceived` when the row holds none), and the session's stored projection
// (`race-interaction` reads its following episodes from the crossings, spec 5.4).
import { describe, expect, it } from 'vitest';
import { known, unknown, type CarId, type SessionUid } from '@pitwall/domain';
import type { ProjectionState } from '@pitwall/engine/readers';
import { resolveSource } from '../../src/calibration/compute.ts';
import type { TrackSession } from '../../src/storage/weekend-repository.ts';
import { lap, stint } from '../storage/records.ts';

const car = (n: number): CarId => n as CarId;

/** A complete stored race session of car 0's feed with car 0's stint of laps 1 to 5; `settings` its stored game settings. */
const sessionWith = (settings: TrackSession['settings']): TrackSession => {
  const projection: ProjectionState = {
    laps: [1, 2, 3, 4, 5].map((n) => lap(0, n)),
    stints: [stint(0, 1, { lastLap: 5 })],
    pitStops: [], crossings: [], events: [], penalties: [], decisions: [], clock: [], spans: {}, appendedAt: {},
  };
  return {
    sessionUid: '7' as SessionUid, weekendId: 'W1', seasonId: 'S1', playerCar: car(0), teammateCar: car(1), trackId: 10,
    startedAt: '2026-10-01T20:00:00.000Z', pwrecPath: null, settings, cars: [], rulesVersion: 'current', complete: true,
    phase: { kind: 'race', format: 'grandPrix' }, stale: false, projection, track: unknown('notApplicable'),
  };
};

const SOURCE = { sessionUid: '7' as SessionUid, weekendId: 'W1', feedCar: car(0), car: car(0), firstLap: 1, excludedLaps: [] };

describe('resolveSource: the AI difficulty and the projection (SP4.3a Task 12)', () => {
  it("fills aiDifficulty from the stored session's game settings", () => {
    const resolved = resolveSource(SOURCE, [sessionWith({ aiDifficulty: 62 })]);
    if (!('stored' in resolved)) throw new Error(`skipped: ${resolved.skipped}`);
    expect(resolved.stored.aiDifficulty).toEqual(known(62, 0));
  });

  it('a stored session without an AI difficulty gives notReceived', () => {
    const resolved = resolveSource(SOURCE, [sessionWith({})]);
    if (!('stored' in resolved)) throw new Error(`skipped: ${resolved.skipped}`);
    expect(resolved.stored.aiDifficulty).toEqual(unknown('notReceived'));
  });

  it("hands the aggregate the session's stored projection", () => {
    const session = sessionWith({ aiDifficulty: 90 });
    const resolved = resolveSource(SOURCE, [session]);
    if (!('stored' in resolved)) throw new Error(`skipped: ${resolved.skipped}`);
    expect(resolved.stored.projection).toBe(session.projection);
  });
});
