// Gallery declaration of the feed-status display (spec 9.1). Test-phase file: the implementer does not edit it.
import type { FeedStatus, SessionInfo } from '@pitwall/contracts';
import { carId, feedId, toSessionTime } from '@pitwall/domain';
import type { SessionState } from '@pitwall/domain';
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import type { widget } from './widget.ts';

const feed = feedId('gallery');

const healthyFeed: FeedStatus = {
  feedId: feed,
  connected: true,
  stale: false,
  lossPercent: 0,
  latePackets: 0,
  decodeErrors: 0,
  packetsPerSecond: 60,
  cadenceMs: 100,
  latencyMs: 12,
};

const { latencyMs: _latency, ...withoutLatency } = healthyFeed;

const session: SessionState = {
  trackId: 10,
  sessionType: 8,
  kind: 'race',
  formula: 0,
  totalLaps: 5,
  trackLengthM: 5000,
  sector2StartM: 1600,
  sector3StartM: 3300,
  durationMs: 1_800_000,
  timeLeftMs: 1_700_000,
  pitSpeedLimitKmh: 80,
  weather: 'clear',
  trackTempC: 30,
  airTempC: 25,
  forecast: [],
  forecastAccuracy: 'perfect',
  flag: 'green',
  marshalZones: [],
  periods: { sc: 0, vsc: 0, red: 0 },
  pitWindow: { idealLap: 0, latestLap: 0, rejoinPosition: 0 },
  settings: {
    safetyCar: 'standard',
    redFlags: 'standard',
    carDamage: 'standard',
    carDamageRate: 'standard',
    tyreTemperature: 'surfaceAndCarcass',
    lowFuelMode: 'easy',
    recoveryMode: 'none',
    flashbackLimit: 'unlimited',
    surfaceType: 'realistic',
    collisions: 'on',
    pitLaneTyreSim: true,
    parcFerme: true,
    equalCarPerformance: false,
    formationLap: true,
    aiDifficulty: 90,
    gameMode: 0,
    ruleSet: 0,
  },
  networkGame: false,
  numActiveCars: 20,
  link: { season: 1, weekend: 1, session: 1 },
  weekendStructure: [],
  updatedAt: toSessionTime(10),
};

const sessionInfo: SessionInfo = {
  feedId: feed,
  sessionUid: '1',
  playerCar: carId(0),
  session,
  realism: false,
};

/** Synthetic cases and fit expectations for `feed-status`. */
const gallery: GalleryEntry<typeof widget> = {
  moments: ['ttZandvoortLap1.crossing', 'raceSingaporeStart.grid'],
  cases: {
    lossy: {
      feed: { ...healthyFeed, lossPercent: 8.5, latePackets: 17, decodeErrors: 3, packetsPerSecond: 48 },
      session: sessionInfo,
    },
    disconnected: {
      feed: { ...withoutLatency, connected: false, packetsPerSecond: 0 },
      session: undefined,
    },
    wrongFormat: {
      feed: { ...healthyFeed, wrongFormat: 42 },
      session: sessionInfo,
    },
  },
  // Task 22: sizes between the modes, one at each mode's minimum plus the edges just inside it.
  fit: [
    { mode: 'compact', cols: 24, rows: 3 },
    { mode: 'compact', cols: 36, rows: 4 },
    { mode: 'compact', cols: 47, rows: 7 },
    { mode: 'full', cols: 48, rows: 8 },
    { mode: 'full', cols: 64, rows: 12 },
  ],
};

export default gallery;
