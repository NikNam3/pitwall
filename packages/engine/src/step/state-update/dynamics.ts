import type { CarDynamics } from '@pitwall/domain';
import { known } from '../../util/hot-domain.ts';
import { maskForRealism } from './realism.ts';
import type { StateUpdate } from './types.ts';

/**
 * Driving inputs from Car Telemetry, world motion from Motion, and limits from Car Status.
 * Speed is km/h; world position, velocity and G-forces stay as the game sends them (m, m/s, g).
 * `dynamics` is `notReceived` until Car Telemetry arrives; the Car Status limits fill into it from then on.
 */
export const dynamicsUpdate: StateUpdate = { id: 'dynamics', apply: (frame, live, _signals, out) => {
  const { telemetry, motion, status } = frame;
  const at = frame.sessionTime;
  if (telemetry) {
    for (const car of live.cars) {
      const t = telemetry.carTelemetryData[car.id];
      if (!t) continue;
      car.updatedAt.telemetry = at;
      const limits = car.dynamics.known
        ? car.dynamics.value
        : { maxRpm: 0, drsActivationDistanceM: 0, pitLimiter: false };
      const dynamics: CarDynamics = {
        ...limits,
        speedKmh: t.speed,
        throttle: t.throttle,
        brake: t.brake,
        steer: t.steer,
        clutchPct: t.clutch,
        gear: t.gear,
        rpm: t.engineRpm,
        revLightsPct: t.revLightsPercent,
        drs: t.drs === 1,
      };
      car.dynamics = known(dynamics, at);
    }
    out.changed.add('dynamics');
  }
  if (motion) {
    for (const car of live.cars) {
      const m = motion.carMotionData[car.id];
      if (!m) continue;
      car.updatedAt.motion = at;
      const { motion: carMotion } = car;
      carMotion.position = { x: m.worldPositionX, y: m.worldPositionY, z: m.worldPositionZ };
      carMotion.velocityMps = { x: m.worldVelocityX, y: m.worldVelocityY, z: m.worldVelocityZ };
      carMotion.gForce = { lateral: m.gForceLateral, longitudinal: m.gForceLongitudinal, vertical: m.gForceVertical };
      carMotion.orientation = { yawRad: m.yaw, pitchRad: m.pitch, rollRad: m.roll };
    }
    out.changed.add('dynamics');
  }
  if (status) {
    for (const car of live.cars) {
      const s = status.carStatusData[car.id];
      if (!s || !car.dynamics.known) continue;
      // A new value with the limits, known since the telemetry's time as before: a `Known` is never changed once made,
      // so a snapshot may keep it as it is (`copyPlainSharingKnown`).
      const { value, at: telemetryAt } = car.dynamics;
      car.dynamics = known({ ...value, maxRpm: s.maxRpm, drsActivationDistanceM: s.drsActivationDistance, pitLimiter: s.pitLimiterStatus === 1 }, telemetryAt);
    }
    out.changed.add('dynamics');
  }
  maskForRealism(live, 'dynamics');
} };
