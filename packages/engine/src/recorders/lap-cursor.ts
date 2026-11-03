import type { ActualCompound, Kg, Known, LapRecord, Ms, SessionTime, VisualCompound } from '@pitwall/domain';
import type { LapMark } from './lap-boundary.ts';

/** The lap a car is on, collected until the lap completes and becomes a `LapRecord`. */
export type LapCursor = LapMark & {
  startedAt: SessionTime;
  fuelAtStartKg: Known<Kg>;
  tyreAgeAtStart: number;
  scMs: Ms;
  vscMs: Ms;
  sector1Ms: Ms;
  sector2Ms: Ms;
  invalid: boolean;
  lastSeenAt: SessionTime;
  trackedMs: Ms;
  actualCompound: ActualCompound;
  visualCompound: VisualCompound;
  /** The engine saw the lap from its start; false when it joined the car mid-lap, so ranges and fuel at start would cover part of it only. */
  fromStart: boolean;
  /** Wear and ERS store from the frame that starts the lap; `unknown('notReceived')` when the engine joined the lap after its start. */
  wearAtStartPct: LapRecord['wearAtStartPct'];
  ersStoreAtStartJ: LapRecord['ersStoreAtStartJ'];
  /** Per band channel (the order of `CHANNELS` in `lap-samples.ts`): lowest and highest value of the lap's frames; min above max = none seen. */
  channelMin: number[];
  channelMax: number[];
  /** The last in-lap ERS totals (the game resets them at the line); `undefined` = none seen. */
  ersDeployedJ: number | undefined;
  ersHarvestedJ: number | undefined;
};
