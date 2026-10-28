import { toSessionTime, type ForecastSample, type GameSettings, type SessionKind, type SessionState } from '@pitwall/domain';
import type { SessionPacket } from '@pitwall/protocol';
import { pick } from './pick.ts';
import type { SubStep } from './types.ts';

// Code tables from the struct comments of the Session packet; a code the spec does not list reads as the first entry.
const WEATHER = ['clear', 'lightCloud', 'overcast', 'lightRain', 'heavyRain', 'storm'] as const;
const TREND = ['up', 'down', 'flat'] as const;
/** Indexed by `zoneFlag + 1`: the game sends -1 for unknown. */
const ZONE_FLAG = ['unknown', 'none', 'green', 'blue', 'yellow'] as const;
const SAFETY_CAR_STATUS = ['green', 'sc', 'vsc', 'formation'] as const;
const FORECAST_ACCURACY = ['perfect', 'approximate'] as const;
const LEVEL = ['off', 'reduced', 'standard', 'increased'] as const;
const CAR_DAMAGE = ['off', 'reduced', 'standard', 'simulation'] as const;
const CAR_DAMAGE_RATE = ['reduced', 'standard', 'simulation'] as const;
const TYRE_TEMPERATURE = ['surfaceOnly', 'surfaceAndCarcass'] as const;
const LOW_FUEL_MODE = ['easy', 'hard'] as const;
const RECOVERY_MODE = ['none', 'flashbacks', 'autoRecovery'] as const;
const FLASHBACK_LIMIT = ['low', 'medium', 'high', 'unlimited'] as const;
const SURFACE_TYPE = ['simplified', 'realistic'] as const;
const COLLISIONS = ['off', 'playerToPlayerOff', 'on'] as const;

/** The last session type code of each kind (appendix "Session types"), in ascending order. */
const KIND_BY_LAST_CODE: ReadonlyArray<readonly [lastCode: number, kind: SessionKind]> = [
  [0, 'unknown'],
  [4, 'practice'],
  [9, 'qualifying'],
  [14, 'sprintShootout'],
  [17, 'race'],
  [18, 'timeTrial'],
];

export const sessionKindOf = (sessionType: number): SessionKind =>
  KIND_BY_LAST_CODE.find(([lastCode]) => sessionType <= lastCode)?.[1] ?? 'unknown';

const forecastFrom = (s: SessionPacket['weatherForecastSamples'][number]): ForecastSample => ({
  sessionType: s.sessionType,
  offsetMin: s.timeOffset,
  weather: pick(WEATHER, s.weather),
  trackTempC: s.trackTemperature,
  trackTempTrend: pick(TREND, s.trackTemperatureChange),
  airTempC: s.airTemperature,
  airTempTrend: pick(TREND, s.airTemperatureChange),
  rainPct: s.rainPercentage,
});

const settingsFrom = (p: SessionPacket): GameSettings => ({
  safetyCar: pick(LEVEL, p.safetyCar),
  redFlags: pick(LEVEL, p.redFlags),
  carDamage: pick(CAR_DAMAGE, p.carDamage),
  carDamageRate: pick(CAR_DAMAGE_RATE, p.carDamageRate),
  tyreTemperature: pick(TYRE_TEMPERATURE, p.tyreTemperature),
  lowFuelMode: pick(LOW_FUEL_MODE, p.lowFuelMode),
  recoveryMode: pick(RECOVERY_MODE, p.recoveryMode),
  flashbackLimit: pick(FLASHBACK_LIMIT, p.flashbackLimit),
  surfaceType: pick(SURFACE_TYPE, p.surfaceType),
  collisions: pick(COLLISIONS, p.collisions),
  // The game sends 0 = on.
  pitLaneTyreSim: p.pitLaneTyreSim === 0,
  parcFerme: p.parcFermeRules === 1,
  equalCarPerformance: p.equalCarPerformance === 1,
  formationLap: p.formationLap === 1,
  aiDifficulty: p.aiDifficulty,
  gameMode: p.gameMode,
  ruleSet: p.ruleSet,
});

/** The session as the Session packet describes it; `numActiveCars` comes from Participants, so the caller passes it in. */
export const sessionStateFrom = (p: SessionPacket, numActiveCars: number): SessionState => ({
  trackId: p.trackId,
  sessionType: p.sessionType,
  kind: sessionKindOf(p.sessionType),
  formula: p.formula,
  totalLaps: p.totalLaps,
  trackLengthM: p.trackLength,
  sector2StartM: p.sector2LapDistanceStart,
  sector3StartM: p.sector3LapDistanceStart,
  durationMs: p.sessionDuration * 1000,
  timeLeftMs: p.sessionTimeLeft * 1000,
  pitSpeedLimitKmh: p.pitSpeedLimit,
  weather: pick(WEATHER, p.weather),
  trackTempC: p.trackTemperature,
  airTempC: p.airTemperature,
  forecast: p.weatherForecastSamples.slice(0, p.numWeatherForecastSamples).map(forecastFrom),
  forecastAccuracy: pick(FORECAST_ACCURACY, p.forecastAccuracy),
  flag: pick(SAFETY_CAR_STATUS, p.safetyCarStatus),
  marshalZones: p.marshalZones
    .slice(0, p.numMarshalZones)
    .map((z) => ({ startFraction: z.zoneStart, flag: pick(ZONE_FLAG, z.zoneFlag + 1) })),
  periods: { sc: p.numSafetyCarPeriods, vsc: p.numVirtualSafetyCarPeriods, red: p.numRedFlagPeriods },
  pitWindow: {
    idealLap: p.pitStopWindowIdealLap,
    latestLap: p.pitStopWindowLatestLap,
    rejoinPosition: p.pitStopRejoinPosition,
  },
  settings: settingsFrom(p),
  networkGame: p.networkGame === 1,
  numActiveCars,
  link: { season: p.seasonLinkIdentifier, weekend: p.weekendLinkIdentifier, session: p.sessionLinkIdentifier },
  weekendStructure: p.weekendStructure.slice(0, p.numSessionsInWeekend),
  updatedAt: toSessionTime(p.header.sessionTime),
});

export const applySession: SubStep = (state, frame, out) => {
  if (!frame.session) return;
  state.session = sessionStateFrom(frame.session, state.session.numActiveCars);
  out.changed.add('session');
};
