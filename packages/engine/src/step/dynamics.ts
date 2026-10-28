import type { SubStep } from './types.ts';

/**
 * Driving inputs from Car Telemetry, world motion from Motion, and limits from Car Status.
 * Speed is km/h; world position, velocity and G-forces stay as the game sends them (m, m/s, g).
 */
export const applyDynamics: SubStep = (state, frame, out) => {
  const { telemetry, motion, status } = frame;
  const at = frame.sessionTime;
  if (telemetry) {
    for (const car of state.cars) {
      const t = telemetry.carTelemetryData[car.id];
      if (!t) continue;
      car.updatedAt.telemetry = at;
      Object.assign(car.dynamics, {
        speedKmh: t.speed,
        throttle: t.throttle,
        brake: t.brake,
        steer: t.steer,
        clutchPct: t.clutch,
        gear: t.gear,
        rpm: t.engineRpm,
        revLightsPct: t.revLightsPercent,
        drs: t.drs === 1,
      });
    }
    out.changed.add('dynamics');
  }
  if (motion) {
    for (const car of state.cars) {
      const m = motion.carMotionData[car.id];
      if (!m) continue;
      car.updatedAt.motion = at;
      Object.assign(car.dynamics, {
        position: { x: m.worldPositionX, y: m.worldPositionY, z: m.worldPositionZ },
        velocity: { x: m.worldVelocityX, y: m.worldVelocityY, z: m.worldVelocityZ },
        gForce: { lateral: m.gForceLateral, longitudinal: m.gForceLongitudinal, vertical: m.gForceVertical },
        orientation: { yawRad: m.yaw, pitchRad: m.pitch, rollRad: m.roll },
      });
    }
    out.changed.add('dynamics');
  }
  if (status) {
    for (const car of state.cars) {
      const s = status.carStatusData[car.id];
      if (!s) continue;
      Object.assign(car.dynamics, {
        maxRpm: s.maxRpm,
        drsAllowed: s.drsAllowed === 1,
        drsActivationDistanceM: s.drsActivationDistance,
        pitLimiter: s.pitLimiterStatus === 1,
      });
    }
    out.changed.add('dynamics');
  }
};
