import type { SessionTime } from './ids.ts';
import type { Celsius, Kmh, Metres, Ms, Percent } from './units.ts';

export type SessionKind = 'unknown' | 'practice' | 'qualifying' | 'sprintShootout' | 'race' | 'timeTrial';
export type Weather = 'clear' | 'lightCloud' | 'overcast' | 'lightRain' | 'heavyRain' | 'storm';
export type Trend = 'up' | 'down' | 'flat';
export type ZoneFlag = 'unknown' | 'none' | 'green' | 'blue' | 'yellow';

/** One forecast sample of this session (step 1 keeps only these). */
export type ForecastSample = {
  offsetMin: number;
  weather: Weather;
  trackTempC: Celsius;
  trackTempTrend: Trend;
  airTempC: Celsius;
  airTempTrend: Trend;
  rainPct: Percent;
};

type Level = 'off' | 'reduced' | 'standard' | 'increased';

/** The game's assists and rules for this session. */
export type GameSettings = {
  safetyCar: Level;
  redFlags: Level;
  carDamage: 'off' | 'reduced' | 'standard' | 'simulation';
  carDamageRate: 'reduced' | 'standard' | 'simulation';
  tyreTemperature: 'surfaceOnly' | 'surfaceAndCarcass';
  lowFuelMode: 'easy' | 'hard';
  recoveryMode: 'none' | 'flashbacks' | 'autoRecovery';
  flashbackLimit: 'low' | 'medium' | 'high' | 'unlimited';
  surfaceType: 'simplified' | 'realistic';
  collisions: 'off' | 'playerToPlayerOff' | 'on';
  pitLaneTyreSim: boolean;
  parcFerme: boolean;
  equalCarPerformance: boolean;
  formationLap: boolean;
  aiDifficulty: number;
  gameMode: number;
};

/** The session's values as the Session packet describes them (spec 6.1); its signals are no part of it (C13). */
export type SessionState = {
  trackId: number;
  formula: number;
  totalLaps: number;
  trackLengthM: Metres;
  sector2StartM: Metres;
  sector3StartM: Metres;
  durationMs: Ms;
  timeLeftMs: Ms;
  pitSpeedLimitKmh: Kmh;
  weather: Weather;
  trackTempC: Celsius;
  airTempC: Celsius;
  forecast: ForecastSample[];
  forecastAccuracy: 'perfect' | 'approximate';
  /** The player's strategy; 0 = none. */
  pitWindow: { idealLap: number; latestLap: number; rejoinPosition: number };
  settings: GameSettings;
  networkGame: boolean;
  link: { season: number; weekend: number; session: number };
  updatedAt: SessionTime;
};
