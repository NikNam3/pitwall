import { describe, expect, it } from 'vitest';
import type { FeedId } from '@pitwall/domain';
import { initialState, step } from '../../src/index.ts';
import { driverKeyOf, isActiveCar } from '../../src/step/identity.ts';
import { ScenarioBuilder } from '../builders/index.ts';

const run = (b: ScenarioBuilder) => {
  const frames = b.build();
  const st = initialState({ feedId: 'test' as FeedId, sessionUid: frames[0]!.sessionUid, session: frames[0]!.session! });
  return { st, frames, results: frames.map((f) => step(st, f)) };
};

describe('car identity', () => {
  it('AI: DriverKey by driverId, public', () => {
    const { st } = run(new ScenarioBuilder({ cars: 4 }).frames(1, () => {}));
    expect(st.cars[2]!.identity).toMatchObject({ name: 'DRIVER 2', teamId: 1, raceNumber: 3, ai: true, driverKey: { kind: 'ai', driverId: 2 }, visibility: 'public' });
  });
  it('player = header.playerCarIndex: human DriverKey, own, holds ownCar', () => {
    const { st } = run(new ScenarioBuilder({ cars: 4, player: 3 }).frames(1, () => {}));
    expect(st.playerCar).toBe(3);
    expect(st.cars[3]!.identity).toMatchObject({ ai: false, driverKey: { kind: 'human', networkId: 0, name: 'DRIVER 3', raceNumber: 4 }, visibility: 'own' });
    expect([st.cars[3]!.ownCar !== undefined, st.cars[0]!.ownCar]).toEqual([true, undefined]);
  });
  it('human non-player with yourTelemetry 0 is restricted; 1 is public; AI is public regardless', () => {
    const { st } = run(new ScenarioBuilder({ cars: 4 }).participants({ participants: { 1: { aiControlled: 0, networkId: 5, yourTelemetry: 0 },
      2: { aiControlled: 0, networkId: 6, yourTelemetry: 1 }, 3: { yourTelemetry: 0 } } }).frames(1, () => {}));
    expect([1, 2, 3].map((i) => st.cars[i]!.identity.visibility)).toEqual(['restricted', 'public', 'public']);
    expect(st.cars[1]!.identity.driverKey).toEqual({ kind: 'human', networkId: 5, name: 'DRIVER 1', raceNumber: 2 });
  });
  it('driverKeyOf is the one DriverKey rule: AI by driverId, human by networkId, name and raceNumber', () => {
    const p = new ScenarioBuilder({ cars: 4, player: 3 }).frames(1, () => {}).build()[0]!.participants!;
    expect(driverKeyOf(p, 2)).toEqual({ kind: 'ai', driverId: 2 });
    expect(driverKeyOf(p, 3)).toEqual({ kind: 'human', networkId: 0, name: 'DRIVER 3', raceNumber: 4 });
  });
  it('active cars follow numActiveCars', () => {
    const { st } = run(new ScenarioBuilder({ cars: 4 }).participants({ numActiveCars: 3 }).frames(1, () => {}));
    expect(st.cars.slice(0, 5).map((c) => c.active)).toEqual([true, true, true, false, false]);
  });
  it.each([['active', true], ['finished', true], ['retired', true], ['didNotFinish', true], ['invalid', false], ['inactive', false]] as const)(
    'isActiveCar: resultStatus %s -> %s', (rs, active) => {
      expect(isActiveCar(2, 3, rs)).toBe(active);
      expect(isActiveCar(3, 3, rs)).toBe(false);
    });
  it('teammate: same teamId as the player, not the player, active', () => {
    expect(run(new ScenarioBuilder({ cars: 6, player: 4 }).frames(1, () => {})).st.teammateCar).toBe(5);
    expect(run(new ScenarioBuilder({ cars: 6, player: 4 }).participants({ numActiveCars: 5 }).frames(1, () => {})).st.teammateCar).toBeUndefined();
  });
  it('tags identity on Participants frames and when the player changes', () => {
    const { st, frames, results } = run(new ScenarioBuilder({ cars: 2 }).frames(2, () => {}));
    expect(results.map((r) => r.changed.has('identity'))).toEqual([true, false]);
    const r = step(st, { ...frames[1]!, playerCarIndex: 1 });
    expect([r.changed.has('identity'), st.playerCar, st.cars[1]!.identity.visibility, st.cars[0]!.identity.visibility]).toEqual([true, 1, 'own', 'public']);
    expect([st.cars[1]!.ownCar !== undefined, st.cars[0]!.ownCar]).toEqual([true, undefined]);
  });
});
