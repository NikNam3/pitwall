import { toSessionTime, type ForecastSample, type GameSettings, type SessionState } from '@pitwall/domain';
import type { SessionPacket } from '@pitwall/protocol';
import type { SessionSignals } from '../../signals/types.ts';
import { pick } from '../pick.ts';
import type { StateUpdate } from './types.ts';

// Code tables from the struct comments of the Session packet; a code the spec does not list reads as the first entry.
const WEATHER = ['clear', 'lightCloud', 'overcast', 'lightRain', 'heavyRain', 'storm'] as const;
const TREND = ['up', 'down', 'flat'] as const;
/** Indexed by `zoneFlag + 1`: the game sends -1 for unknown. */
export const ZONE_FLAG = ['unknown', 'none', 'green', 'blue', 'yellow'] as const;
export const SAFETY_CAR_STATUS = ['green', 'sc', 'vsc', 'formation'] as const;
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

const forecastFrom = (s: SessionPacket['weatherForecastSamples'][number]): ForecastSample => ({
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
});

/**
 * The forecast of this session: the game sends the samples of every session of the weekend, each with its session type
 * (a signal, C12); step 1 keeps the values of the samples whose session type is this session's, in the packet's order.
 */
const forecastOf = (p: SessionPacket): ForecastSample[] =>
  p.weatherForecastSamples
    .slice(0, p.numWeatherForecastSamples)
    .filter((s) => s.sessionType === p.sessionType)
    .map(forecastFrom);

/** The session's values as the Session packet describes them; its signals go to `Signals` (C8, C13). */
export const sessionStateFrom = (p: SessionPacket): SessionState => ({
  trackId: p.trackId,
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
  forecast: forecastOf(p),
  forecastAccuracy: pick(FORECAST_ACCURACY, p.forecastAccuracy),
  pitWindow: {
    idealLap: p.pitStopWindowIdealLap,
    latestLap: p.pitStopWindowLatestLap,
    rejoinPosition: p.pitStopRejoinPosition,
  },
  settings: settingsFrom(p),
  networkGame: p.networkGame === 1,
  link: { season: p.seasonLinkIdentifier, weekend: p.weekendLinkIdentifier, session: p.sessionLinkIdentifier },
  updatedAt: toSessionTime(p.header.sessionTime),
});

/** The game simulates only the tyre surface: the carcass temperature does not apply (`settings.tyreTemperature`). */
export const surfaceOnly = (p: SessionPacket): boolean => pick(TYRE_TEMPERATURE, p.tyreTemperature) === 'surfaceOnly';

/** The marshal zones the Session packet sends, in its order (a signal, C12). */
export const marshalZonesOf = (p: SessionPacket): SessionSignals['marshalZones'] =>
  p.marshalZones.slice(0, p.numMarshalZones).map((z) => ({ startFraction: z.zoneStart, flag: pick(ZONE_FLAG, z.zoneFlag + 1) }));

/** The session from the Session packet. */
export const sessionUpdate: StateUpdate = {
  id: 'session',
  apply(frame, live, _signals, out) {
    if (!frame.session) return;
    live.session = sessionStateFrom(frame.session);
    out.changed.add('session');
  },
};
