// Topic definitions (spec 8.4) and the wire DTOs that are not plain domain types.
// Everything here is JSON-safe: `sessionUid` is the decimal string, never a `bigint`.
import type {
  CarDynamics,
  CarId,
  CarState,
  FeedId,
  FlagPhase,
  Insight,
  LapRecord,
  PitStopRecord,
  RaceEvent,
  SessionState,
  SessionTime,
  SessionUid,
  StintRecord,
  VisualCompound,
} from '@pitwall/domain';

export type FeedStatus = {
  feedId: FeedId;
  connected: boolean;
  stale: boolean;
  lossPercent: number;
  latePackets: number;
  decodeErrors: number;
  packetsPerSecond: number;
  latencyMs?: number;
  wrongFormat?: number;
};

export type SessionInfo = {
  feedId: FeedId;
  sessionUid: SessionUid;
  playerCar: CarId;
  teammateCar?: CarId;
  session: SessionState;
};

export type CarOverview = {
  id: CarId;
  identity: CarState['identity'];
  timing: CarState['timing'];
  tyres: Pick<CarState['tyres'], 'actualCompound' | 'visualCompound' | 'age'>;
};

/** Structurally the engine's `InsightChange`: an insight is raised, later resolved by its key. */
export type InsightEntry = { type: 'raised'; insight: Insight } | { type: 'resolved'; key: string; at: SessionTime };

export type FeedInfo = { feedId: FeedId; kind: 'udp' | 'replay'; label: string; sessionUid?: SessionUid };

/** Placeholder for sub-project 6; the MVP server answers every command with `notSupported`. */
export type ReservedCommand = { kind: 'boxCall'; tyre: VisualCompound };

/**
 * `params` and `value` are phantom: they only carry types and are absent at runtime.
 * `state` replaces the previous value, `append` adds entries.
 */
export type TopicDef<P, V> = {
  name: string;
  mode: 'state' | 'append';
  maxHz: number;
  params?: P;
  value?: V;
};

type NoParams = Record<string, never>;
type CarParams = { carId: number };

const def = <P, V>(name: string, mode: TopicDef<P, V>['mode'], maxHz: number): TopicDef<P, V> => ({ name, mode, maxHz });

export const TOPICS = {
  'feed.status': def<NoParams, FeedStatus>('feed.status', 'state', 2),
  'session.info': def<NoParams, SessionInfo>('session.info', 'state', 2),
  'cars.overview': def<NoParams, CarOverview[]>('cars.overview', 'state', 10),
  'car.detail': def<CarParams, CarState>('car.detail', 'state', 30),
  'car.telemetry': def<CarParams, CarDynamics>('car.telemetry', 'state', 60),
  laps: def<NoParams, LapRecord>('laps', 'append', Infinity),
  stints: def<NoParams, StintRecord>('stints', 'append', Infinity),
  pitStops: def<NoParams, PitStopRecord>('pitStops', 'append', Infinity),
  flagPhases: def<NoParams, FlagPhase>('flagPhases', 'append', Infinity),
  events: def<NoParams, RaceEvent>('events', 'append', Infinity),
  insights: def<NoParams, InsightEntry>('insights', 'append', Infinity),
} as const;

export type TopicName = keyof typeof TOPICS;
export type TopicParams<T extends TopicName> = NonNullable<(typeof TOPICS)[T]['params']>;
export type TopicValue<T extends TopicName> = NonNullable<(typeof TOPICS)[T]['value']>;
