// Which game packet each car field comes from, so a value can tell when its source has fallen behind (spec 5).
import type { DataSource } from '@pitwall/domain';

/**
 * Every number or `Known` field of `CarState` by dot path from the car root. `Corners` are collapsed: the corner key
 * is dropped, the `corners` / `brakes` key stays. `motion` is one path.
 */
export const CAR_FIELD_SOURCE = {
  'identity.teamId': 'participants',
  'identity.raceNumber': 'participants',
  'identity.nationality': 'participants',
  'identity.driverId': 'participants',
  'identity.networkId': 'participants',
  'identity.platform': 'participants',
  'identity.driverKey.driverId': 'participants',
  'timing.position': 'lapData',
  'timing.lap': 'lapData',
  'timing.lapDistanceM': 'lapData',
  'timing.totalDistanceM': 'lapData',
  'timing.currentLapTimeMs': 'lapData',
  'timing.lastLapTimeMs': 'lapData',
  'timing.sector': 'lapData',
  'timing.sector1TimeMs': 'lapData',
  'timing.sector2TimeMs': 'lapData',
  'timing.gapToLeaderMs': 'lapData',
  'timing.gapToCarAheadMs': 'lapData',
  'timing.safetyCarDeltaMs': 'lapData',
  'timing.numPitStops': 'lapData',
  'timing.pitLaneTimeMs': 'lapData',
  'timing.pitStopTimerMs': 'lapData',
  'timing.timePenaltyMs': 'lapData',
  'timing.totalWarnings': 'lapData',
  'timing.cornerCuttingWarnings': 'lapData',
  'timing.unservedDriveThroughs': 'lapData',
  'timing.unservedStopGos': 'lapData',
  'timing.gridPosition': 'lapData',
  'timing.speedTrapFastestKmh': 'lapData',
  'tyres.age': 'status',
  'tyres.corners.surfaceTempC': 'telemetry',
  'tyres.corners.carcassTempC': 'telemetry',
  'tyres.corners.pressurePsi': 'telemetry',
  'tyres.corners.wearPct': 'damage',
  'tyres.corners.damagePct': 'damage',
  'tyres.corners.blistersPct': 'damage',
  'tyres.sets': 'tyreSets',
  'energy.fuel': 'status',
  'energy.ers': 'status',
  'energy.power': 'status',
  'condition.bodywork': 'damage',
  'condition.powerUnit': 'damage',
  'condition.drsFault': 'damage',
  'condition.brakes.tempC': 'telemetry',
  'condition.brakes.damagePct': 'damage',
  'condition.engineTempC': 'telemetry',
  'motion': 'motion',
  'dynamics': 'telemetry',
} as const satisfies Record<string, DataSource>;

/** A path of a car field that has a data source. */
export type CarFieldPath = keyof typeof CAR_FIELD_SOURCE;
