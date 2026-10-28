import { expect, it } from 'vitest';
import { driverKeyString, type FeedId } from '@pitwall/domain';
import { initialState, step, type EngineState } from '@pitwall/engine';
import { describeWithFixture } from '../../../../test-support/fixtures.ts';
import { trackFixture } from './replay.ts';

describeWithFixture('raceSingapore', 'session and identity of the Singapore race', () => {
  it('5-lap race, 20 active cars, human player HAMILTON at index 19, teammate LECLERC at 14', async () => {
    const box: { st?: EngineState } = {};
    await trackFixture('raceSingapore', (f) => {
      if (!box.st && f.session) box.st = initialState({ feedId: 'race' as FeedId, sessionUid: f.sessionUid, session: f.session });
      if (box.st) step(box.st, f);
    });
    const st = box.st;
    expect(st!.session).toMatchObject({ kind: 'race', sessionType: 15, trackId: 12, totalLaps: 5, trackLengthM: 4928, numActiveCars: 20 });
    expect([st!.playerCar, st!.teammateCar]).toEqual([19, 14]);
    expect(st!.cars[19]!.identity).toMatchObject({ ai: false, visibility: 'own', driverKey: { kind: 'human', networkId: 255, name: 'HAMILTON', raceNumber: 44 } });
    expect(driverKeyString(st!.cars[0]!.identity.driverKey)).toBe('ai:9');
    expect(st!.cars.filter((c) => c.active)).toHaveLength(20);
    expect([st!.cars[20]!.active, st!.cars[21]!.active]).toEqual([false, false]);
  });
});
