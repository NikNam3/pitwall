import type { CarSetup, OwnCarMotionEx } from '@pitwall/domain';
import { known } from '../../util/hot-domain.ts';
import type { CarSetupsPacket, MotionExPacket } from '@pitwall/protocol';
import { cornersOf, mapCorners } from '../corners.ts';
import { createOwnCarState } from './identity.ts';
import type { StateUpdate } from './types.ts';

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
    localVelocityMps: { x: m.localVelocityX, y: m.localVelocityY, z: m.localVelocityZ },
    angularVelocityRadPerS: { x: m.angularVelocityX, y: m.angularVelocityY, z: m.angularVelocityZ },
    angularAccelerationRadPerS2: { x: m.angularAccelerationX, y: m.angularAccelerationY, z: m.angularAccelerationZ },
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

/**
 * What the game sends for the player's car only: MotionEx, the setup and the live brake bias. The player is the frame's
 * (C11: not identity's write); a new player's own data starts here, and placing the player keeps it.
 */
export const ownCarUpdate: StateUpdate = { id: 'ownCar', apply: (frame, live, _signals, out) => {
  const playerCar = frame.playerCarIndex;
  const player = live.cars[playerCar];
  if (!player) return;
  const at = frame.sessionTime;
  const ownOf = () => (player.ownCar ??= createOwnCarState());
  if (frame.motionEx) {
    ownOf().motionEx = known(motionExFrom(frame.motionEx), at);
    player.updatedAt.motionEx = at;
    out.changed.add('ownCar');
  }
  const setup = frame.setups?.carSetupData[playerCar];
  if (setup) {
    ownOf().setup = known(setupFrom(setup), at);
    player.updatedAt.setups = at;
    out.changed.add('ownCar');
  }
  const status = frame.status?.carStatusData[playerCar];
  if (status) {
    ownOf().brakeBiasPct = known(status.frontBrakeBias, at);
    out.changed.add('ownCar');
  }
} };
