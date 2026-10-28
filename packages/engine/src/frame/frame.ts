import type { FeedId, SessionTime } from '@pitwall/domain';
import type {
  CarDamagePacket,
  CarSetupsPacket,
  CarStatusPacket,
  CarTelemetryPacket,
  EventPacket,
  FinalClassificationPacket,
  LapDataPacket,
  LapPositionsPacket,
  MotionExPacket,
  MotionPacket,
  ParticipantsPacket,
  SessionHistoryPacket,
  SessionPacket,
  TimeTrialPacket,
  TyreSetsPacket,
} from '@pitwall/protocol';

/** The packets the game sends on every frame; a closed frame without one of them lost a packet. */
export const MENU_RATE_SLOTS = ['lapData', 'motion', 'telemetry', 'status', 'motionEx'] as const;

/** All packets of one game frame (spec 5.1), keyed by `overallFrameId`. */
export type Frame = {
  feedId: FeedId;
  sessionUid: bigint;
  /** The game's `frameIdentifier`; it goes back after a flashback. */
  frameId: number;
  /** The game's `overallFrameIdentifier`; it keeps rising across flashbacks. */
  overallFrameId: number;
  /** The latest header session time of the frame's packets. */
  sessionTime: SessionTime;
  playerCarIndex: number;
  motion?: MotionPacket;
  lapData?: LapDataPacket;
  telemetry?: CarTelemetryPacket;
  status?: CarStatusPacket;
  motionEx?: MotionExPacket;
  session?: SessionPacket;
  damage?: CarDamagePacket;
  setups?: CarSetupsPacket;
  participants?: ParticipantsPacket;
  lapPositions?: LapPositionsPacket;
  finalClassification?: FinalClassificationPacket;
  timeTrial?: TimeTrialPacket;
  sessionHistory: SessionHistoryPacket[];
  tyreSets: TyreSetsPacket[];
  events: EventPacket[];
};
