import { known, type CarSetup, type OwnCarMotionEx } from '@pitwall/domain';
import type { CarSetupsPacket, MotionExPacket } from '@pitwall/protocol';
import { cornersOf, mapCorners } from './corners.ts';
import type { SubStep } from './types.ts';

const motionExFrom = (m: MotionExPacket): OwnCarMotionEx => {
  const suspensionPosition = cornersOf(m.suspensionPosition);
  const suspensionVelocity = cornersOf(m.suspensionVelocity);
  const suspensionAcceleration = cornersOf(m.suspensionAcceleration);
  const speed = cornersOf(m.wheelSpeed);
  const slipRatio = cornersOf(m.wheelSlipRatio);
  const slipAngle = cornersOf(m.wheelSlipAngle);
  const latForce = cornersOf(m.wheelLatForce);
  const longForce = cornersOf(m.wheelLongForce);
  const vertForce = cornersOf(m.wheelVertForce);
  const camber = cornersOf(m.wheelCamber);
  const camberGain = cornersOf(m.wheelCamberGain);
  return {
    wheels: mapCorners((corner) => ({
      suspensionPosition: suspensionPosition[corner],
      suspensionVelocity: suspensionVelocity[corner],
      suspensionAcceleration: suspensionAcceleration[corner],
      speed: speed[corner],
      slipRatio: slipRatio[corner],
      slipAngle: slipAngle[corner],
      latForce: latForce[corner],
      longForce: longForce[corner],
      vertForce: vertForce[corner],
      camberRad: camber[corner],
      camberGainRad: camberGain[corner],
    })),
    heightOfCogM: m.heightOfCogAboveGround,
    localVelocity: { x: m.localVelocityX, y: m.localVelocityY, z: m.localVelocityZ },
    angularVelocity: { x: m.angularVelocityX, y: m.angularVelocityY, z: m.angularVelocityZ },
    angularAcceleration: { x: m.angularAccelerationX, y: m.angularAccelerationY, z: m.angularAccelerationZ },
    frontWheelsAngleRad: m.frontWheelsAngle,
    frontAeroHeightM: m.frontAeroHeight,
    rearAeroHeightM: m.rearAeroHeight,
    frontRollAngleRad: m.frontRollAngle,
    rearRollAngleRad: m.rearRollAngle,
    chassisYawRad: m.chassisYaw,
    chassisPitchRad: m.chassisPitch,
  };
};

const setupFrom = (s: CarSetupsPacket['carSetupData'][number]): CarSetup => ({
  frontWing: s.frontWing,
  rearWing: s.rearWing,
  diffOnThrottlePct: s.onThrottle,
  diffOffThrottlePct: s.offThrottle,
  frontCamber: s.frontCamber,
  rearCamber: s.rearCamber,
  frontToe: s.frontToe,
  rearToe: s.rearToe,
  frontSuspension: s.frontSuspension,
  rearSuspension: s.rearSuspension,
  frontAntiRollBar: s.frontAntiRollBar,
  rearAntiRollBar: s.rearAntiRollBar,
  frontRideHeight: s.frontSuspensionHeight,
  rearRideHeight: s.rearSuspensionHeight,
  brakePressurePct: s.brakePressure,
  brakeBiasPct: s.brakeBias,
  engineBrakingPct: s.engineBraking,
  tyrePressurePsi: {
    fl: s.frontLeftTyrePressure,
    fr: s.frontRightTyrePressure,
    rl: s.rearLeftTyrePressure,
    rr: s.rearRightTyrePressure,
  },
  ballast: s.ballast,
  fuelLoadKg: s.fuelLoad,
});

/** What the game sends for the player's car only: MotionEx, the setup and the live brake bias. */
export const applyOwnCar: SubStep = (state, frame, out) => {
  const own = state.cars[state.playerCar]?.ownCar;
  if (!own) return;
  const at = frame.sessionTime;
  if (frame.motionEx) {
    own.motionEx = known(motionExFrom(frame.motionEx), at);
    out.changed.add('ownCar');
  }
  const setup = frame.setups?.carSetupData[state.playerCar];
  if (setup) {
    own.setup = known(setupFrom(setup), at);
    out.changed.add('ownCar');
  }
  const status = frame.status?.carStatusData[state.playerCar];
  if (status) {
    own.brakeBiasPct = known(status.frontBrakeBias, at);
    out.changed.add('ownCar');
  }
};
