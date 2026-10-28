import { describe, expect, it } from 'vitest';
import { known, unknown } from '@pitwall/domain';
import type { ChangeTag } from '../../src/index.ts';
import { ScenarioBuilder } from '../builders/index.ts';
import { runFrames, runScenario } from '../support/run.ts';

const R = unknown('restricted'), NR = unknown('notReceived');
// car 1 = human with "Your Telemetry: restricted", car 2 = human public; player = car 0
const online = () => new ScenarioBuilder({ cars: 3 }).participants({ participants: {
  1: { aiControlled: 0, networkId: 5, yourTelemetry: 0 }, 2: { aiControlled: 0, networkId: 6, yourTelemetry: 1 } } });

describe('tyres', () => {
  it('translates RL,RR,FL,FR into named corners once, for every per-wheel source', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(1, (d) => {
      Object.assign(d.telemetry.carTelemetryData[0]!, { tyresSurfaceTemperature: [80, 81, 90, 91], tyresInnerTemperature: [100, 101, 110, 111],
        tyresPressure: [21.5, 21.75, 23, 23.25], brakesTemperature: [400, 410, 500, 510] });
      Object.assign(d.status.carStatusData[0]!, { actualTyreCompound: 18, visualTyreCompound: 16, tyresAgeLaps: 4 });
      d.add('carDamage', { carDamageData: { 0: { tyresWear: [10, 11, 20, 21], tyresDamage: [1, 2, 3, 4], tyreBlisters: [5, 6, 7, 8], brakesDamage: [9, 10, 11, 12] } } });
    }));
    const { tyres, condition } = st.cars[0]!;
    expect(tyres.corners.fl).toEqual({ surfaceTempC: known(90, 0), carcassTempC: known(110, 0), pressurePsi: known(23, 0), wearPct: known(20, 0), damagePct: known(3, 0), blistersPct: known(7, 0) });
    expect(tyres.corners.rr).toMatchObject({ surfaceTempC: known(81, 0), pressurePsi: known(21.75, 0), blistersPct: known(6, 0) });
    expect(condition.brakes.fr).toEqual({ tempC: known(510, 0), damagePct: known(12, 0) });
    expect([tyres.actualCompound, tyres.visualCompound, tyres.age]).toEqual(['C3', 'soft', 4]);
  });
  it('carcass temperature is notApplicable with the "surface only" tyre temperature setting', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).session({ tyreTemperature: 0 }).frames(1, () => {}));
    for (const c of ['fl', 'fr', 'rl', 'rr'] as const) expect(st.cars[0]!.tyres.corners[c].carcassTempC).toEqual(unknown('notApplicable'));
  });
  it('maps tyre sets by carIdx', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(1, (d) => {
      d.add('tyreSets', { carIdx: 0, fittedIdx: 2, tyreSetData: { 2: { actualTyreCompound: 18, visualTyreCompound: 16, wear: 5, available: 1, fitted: 1,
        recommendedSession: 15, lifeSpan: 20, usableLife: 22, lapDeltaTime: -150 } } });
    }));
    const sets = st.cars[0]!.tyres.sets;
    expect(sets).toMatchObject({ known: true, value: { fittedIdx: 2 } });
    expect(sets.known && sets.value.sets[2]).toEqual({ actualCompound: 'C3', visualCompound: 'soft', wearPct: 5, available: true, fitted: true,
      recommendedSession: 15, lifeSpanLaps: 20, usableLifeLaps: 22, lapDeltaMs: -150 });
  });
});

describe('restricted data (spec 6.2)', () => {
  it('a restricted human car: every field on the spec list is unknown("restricted"), not 0', () => {
    const { st } = runScenario(online().frames(1, (d) => { d.add('carDamage'); d.add('tyreSets', { carIdx: 1 }); }));
    const c = st.cars[1]!;
    expect([c.energy.fuel, c.energy.ers, c.energy.power]).toEqual([R, R, R]);
    expect([c.condition.bodywork, c.condition.powerUnit, c.condition.drsFault, c.condition.brakes.fl.damagePct]).toEqual([R, R, R, R]);
    expect([c.tyres.corners.fl.wearPct, c.tyres.corners.rr.damagePct, c.tyres.sets]).toEqual([R, R, R]);
    expect([c.condition.ersFault, c.tyres.corners.fl.blistersPct, c.tyres.actualCompound]).toEqual([false, known(0, 0), 'C3']);   // not on the list
  });
  it('restriction covers all four corners and brakes, and leaves the readable tyre channels as sent', () => {
    const { st } = runScenario(online().frames(1, (d) => {
      Object.assign(d.telemetry.carTelemetryData[1]!, { tyresSurfaceTemperature: [80, 81, 90, 91], brakesTemperature: [400, 410, 500, 510] });
      d.add('carDamage');
    }));
    const { tyres, condition } = st.cars[1]!;
    for (const c of ['fl', 'fr', 'rl', 'rr'] as const) {
      expect([tyres.corners[c].wearPct, tyres.corners[c].damagePct, condition.brakes[c].damagePct]).toEqual([R, R, R]);
    }
    expect([tyres.corners.fl.surfaceTempC, tyres.corners.rr.surfaceTempC, condition.brakes.fr.tempC]).toEqual([known(90, 0), known(81, 0), known(510, 0)]);
  });
  it('a car that Participants reveals as restricted withholds what earlier packets stored as known 0', () => {
    // frame 0: Status, Car Damage and Tyre Sets for car 1 before any Participants (it looks like a public AI car);
    // frame 1: Participants makes car 1 a human with restricted telemetry, and no Car Damage or Tyre Sets arrive
    const frames = new ScenarioBuilder({ cars: 3 })
      .frames(1, (d) => { d.add('carDamage'); d.add('tyreSets', { carIdx: 1 }); })
      .participants({ participants: { 1: { aiControlled: 0, networkId: 5, yourTelemetry: 0 } } })
      .frames(1, () => {})
      .build();
    const first = { ...frames[0]! };
    delete first.participants;
    expect([first.status !== undefined, first.damage !== undefined, first.tyreSets.length, first.participants]).toEqual([true, true, 1, undefined]);
    expect([frames[1]!.participants !== undefined, frames[1]!.damage, frames[1]!.tyreSets]).toEqual([true, undefined, []]);
    const { st } = runFrames([first, frames[1]!]);
    const c = st.cars[1]!;
    expect(c.identity.visibility).toBe('restricted');
    expect([c.energy.fuel, c.energy.ers, c.energy.power]).toEqual([R, R, R]);
    expect([c.condition.bodywork, c.condition.powerUnit, c.condition.drsFault]).toEqual([R, R, R]);
    for (const w of ['fl', 'fr', 'rl', 'rr'] as const) {
      expect([c.condition.brakes[w].damagePct, c.tyres.corners[w].wearPct, c.tyres.corners[w].damagePct], w).toEqual([R, R, R]);
    }
    expect(c.tyres.sets).toEqual(R);
  });
  it('a public human car with 0 fuel has known 0 fuel', () => {
    const { st } = runScenario(online().frames(1, () => {}));
    expect(st.cars[2]!.energy.fuel).toEqual(known({ kg: 0, capacityKg: 0, remainingLaps: 0, mix: 'lean' }, 0));
  });
  it('fields stay notReceived until their packet arrives', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 2 }).frames(1, (d) => { d.drop('status'); d.drop('motionEx'); }));
    expect([st.cars[1]!.energy.fuel, st.cars[1]!.condition.bodywork, st.cars[0]!.ownCar!.motionEx]).toEqual([NR, NR, NR]);
  });
});

describe('energy, condition, dynamics', () => {
  it('energy: kg, J and W pass through; mix and ERS mode are named', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 2 }).frames(1, (d) => {
      Object.assign(d.status.carStatusData[1]!, { fuelInTank: 42.5, fuelCapacity: 110, fuelRemainingLaps: 12.25, fuelMix: 2, ersStoreEnergy: 3_000_000,
        ersDeployMode: 3, ersHarvestedThisLapMguk: 100_000, ersHarvestedThisLapMguh: 200_000, ersDeployedThisLap: 500_000, enginePowerIce: 560_000, enginePowerMguk: 120_000 });
    }));
    expect(st.cars[1]!.energy).toEqual({ fuel: known({ kg: 42.5, capacityKg: 110, remainingLaps: 12.25, mix: 'rich' }, 0),
      ers: known({ storeJ: 3_000_000, mode: 'overtake', harvestedMgukJ: 100_000, harvestedMguhJ: 200_000, deployedJ: 500_000 }, 0),
      power: known({ iceW: 560_000, mgukW: 120_000 }, 0) });
  });
  it('condition from Car Damage and Telemetry', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 2 }).frames(1, (d) => {
      d.add('carDamage', { carDamageData: { 1: { frontLeftWingDamage: 10, frontRightWingDamage: 11, rearWingDamage: 12, floorDamage: 13, diffuserDamage: 14,
        sidepodDamage: 15, engineDamage: 20, gearBoxDamage: 21, engineMguhWear: 30, engineEsWear: 31, engineCeWear: 32, engineIceWear: 33,
        engineMgukWear: 34, engineTcWear: 35, drsFault: 1, ersFault: 1, engineBlown: 0, engineSeized: 1 } } });
      d.telemetry.carTelemetryData[1]!.engineTemperature = 105;
    }));
    expect(st.cars[1]!.condition).toMatchObject({
      bodywork: known({ frontLeftWingPct: 10, frontRightWingPct: 11, rearWingPct: 12, floorPct: 13, diffuserPct: 14, sidepodPct: 15 }, 0),
      powerUnit: known({ engineDamagePct: 20, gearboxDamagePct: 21, mguhWearPct: 30, esWearPct: 31, ceWearPct: 32, iceWearPct: 33, mgukWearPct: 34, tcWearPct: 35 }, 0),
      drsFault: known(true, 0), ersFault: true, engineBlown: false, engineSeized: true, engineTempC: known(105, 0) });
  });
  it('dynamics from Telemetry and Car Status, motion from Motion', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 2 }).frames(1, (d) => {
      Object.assign(d.telemetry.carTelemetryData[1]!, { speed: 312, throttle: 0.75, brake: 0.25, steer: -0.5, clutch: 0, gear: 7, engineRpm: 11_500, revLightsPercent: 80, drs: 1 });
      Object.assign(d.status.carStatusData[1]!, { maxRpm: 13_000, drsAllowed: 1, drsActivationDistance: 120, pitLimiterStatus: 1 });
      Object.assign(d.motion.carMotionData[1]!, { worldPositionX: 100.5, worldPositionY: 2.25, worldPositionZ: -30, worldVelocityX: 80, worldVelocityY: 0,
        worldVelocityZ: -4.5, gForceLateral: 1.5, gForceLongitudinal: -2, gForceVertical: 0.5, yaw: 0.5, pitch: 0.25, roll: -0.125 });
    }));
    expect(st.cars[1]!.dynamics).toEqual(known({ speedKmh: 312, throttle: 0.75, brake: 0.25, steer: -0.5, clutchPct: 0, gear: 7, rpm: 11_500, maxRpm: 13_000,
      revLightsPct: 80, drs: true, drsAllowed: true, drsActivationDistanceM: 120, pitLimiter: true }, 0));
    expect(st.cars[1]!.motion).toEqual({ position: { x: 100.5, y: 2.25, z: -30 },
      velocityMps: { x: 80, y: 0, z: -4.5 }, gForce: { lateral: 1.5, longitudinal: -2, vertical: 0.5 }, orientation: { yawRad: 0.5, pitchRad: 0.25, rollRad: -0.125 } });
  });
  it('tags the areas that the packets in the first frame feed', () => {
    const { results } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(1, (d) => d.drop('motionEx')));
    const present: ChangeTag[] = ['session', 'identity', 'timing', 'tyres', 'energy', 'condition', 'dynamics', 'ownCar'], absent: ChangeTag[] = ['events', 'pitStops', 'flagPhases'];
    expect([present.filter((t) => !results[0]!.changed.has(t)), absent.filter((t) => results[0]!.changed.has(t))]).toEqual([[], []]);
  });
});

describe('ownCar (player only)', () => {
  it('fills MotionEx (named corners), setup and live brake bias for the player; other cars get no ownCar', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 2, player: 0 }).frames(1, (d) => {
      Object.assign(d.motionEx, { wheelSpeed: [1, 2, 3, 4], wheelCamber: [0.5, 0.25, -0.5, -0.25], frontWheelsAngle: 0.125, heightOfCogAboveGround: 0.25,
        localVelocityX: 1, localVelocityY: 2, localVelocityZ: 3, angularVelocityX: 4, angularVelocityY: 5, angularVelocityZ: 6,
        angularAccelerationX: 7, angularAccelerationY: 8, angularAccelerationZ: 9 });
      d.status.carStatusData[0]!.frontBrakeBias = 56;
      d.add('carSetups', { carSetupData: { 0: { onThrottle: 60, offThrottle: 50, brakeBias: 55, rearLeftTyrePressure: 21, rearRightTyrePressure: 21.5,
        frontLeftTyrePressure: 23, frontRightTyrePressure: 23.5, fuelLoad: 12.5 } } });
    }));
    const own = st.cars[0]!.ownCar!;
    expect(own.motionEx).toMatchObject({ known: true, value: { wheels: { fl: { speed: 3, camberRad: -0.5 }, rr: { speed: 2, camberRad: 0.25 } },
      frontWheelsAngleRad: 0.125, heightOfCogM: 0.25, localVelocityMps: { x: 1, y: 2, z: 3 }, angularVelocityRadPerS: { x: 4, y: 5, z: 6 },
      angularAccelerationRadPerS2: { x: 7, y: 8, z: 9 } } });
    expect(own.setup).toMatchObject({ known: true, value: { diffOnThrottlePct: 60, diffOffThrottlePct: 50, brakeBiasPct: 55,
      tyrePressurePsi: { fl: 23, fr: 23.5, rl: 21, rr: 21.5 }, fuelLoadKg: 12.5 } });
    expect(own.brakeBiasPct).toEqual(known(56, 0));
    expect(st.cars[1]!.ownCar).toBeUndefined();               // MotionEx is player-only data
  });
});

describe('hideable car data is Known (spec 7.9)', () => {
  const corners = ['fl', 'fr', 'rl', 'rr'] as const;
  // frames 0..2 (session time 0 .. 32): the packet's value is stamped with the session time of the frame that carried it
  const withTelemetry = (omit: 'telemetry' | 'carDamage' | null) => runScenario(new ScenarioBuilder({ cars: 1 }).frames(3, (d) => {
    Object.assign(d.telemetry.carTelemetryData[0]!, { tyresSurfaceTemperature: [80, 81, 90, 91], tyresPressure: [21.5, 21.75, 23, 23.25],
      brakesTemperature: [400, 410, 500, 510], engineTemperature: 105, speed: 250 });
    if (omit !== 'carDamage') d.add('carDamage', { carDamageData: { 0: { tyreBlisters: [5, 6, 7, 8], brakesDamage: [9, 10, 11, 12] } } });
    if (omit === 'telemetry') d.drop('telemetry');
  }));

  it('tyre surface temperature, pressure, brake temperature and engine temperature: notReceived without Car Telemetry', () => {
    const { st } = withTelemetry('telemetry');
    const car = st.cars[0]!;
    for (const c of corners) expect([car.tyres.corners[c].surfaceTempC, car.tyres.corners[c].pressurePsi, car.condition.brakes[c].tempC]).toEqual([NR, NR, NR]);
    expect([car.condition.engineTempC, car.dynamics]).toEqual([NR, NR]);
  });
  it('tyre surface temperature, pressure, brake temperature and engine temperature: known at the frame session time after Car Telemetry', () => {
    const { st } = withTelemetry(null);
    const car = st.cars[0]!, at = car.updatedAt.telemetry!;
    expect(at).toBeGreaterThan(0);
    expect(car.tyres.corners.fl.surfaceTempC).toEqual(known(90, at));
    expect(car.tyres.corners.rr.pressurePsi).toEqual(known(21.75, at));
    expect(car.condition.brakes.fl.tempC).toEqual(known(500, at));
    expect(car.condition.engineTempC).toEqual(known(105, at));
    expect(car.dynamics).toMatchObject({ known: true, at, value: { speedKmh: 250 } });
  });
  it('blisters: notReceived without Car Damage, known at the frame session time with it', () => {
    const before = withTelemetry('carDamage').st.cars[0]!;
    for (const c of corners) expect(before.tyres.corners[c].blistersPct).toEqual(NR);
    const { st } = withTelemetry(null);
    expect(st.cars[0]!.tyres.corners.fl.blistersPct).toEqual(known(7, st.cars[0]!.updatedAt.telemetry!));
  });
  it('brake temperature of a restricted car stays readable (not on the spec 6.2 list)', () => {
    const { st } = runScenario(online().frames(1, (d) => { Object.assign(d.telemetry.carTelemetryData[1]!, { brakesTemperature: [1, 2, 3, 4], engineTemperature: 90 }); }));
    expect([st.cars[1]!.condition.brakes.fl.tempC, st.cars[1]!.condition.engineTempC]).toEqual([known(3, 0), known(90, 0)]);
    expect(st.cars[1]!.dynamics.known).toBe(true);
  });
  it('motion is filled from the Motion packet and moves updatedAt.motion', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(3, (d) => { Object.assign(d.motion.carMotionData[0]!, { worldPositionX: 7 }); }));
    expect(st.cars[0]!.motion.position.x).toBe(7);
    expect(st.cars[0]!.updatedAt.motion).toBe(st.cars[0]!.updatedAt.telemetry);
  });
});
