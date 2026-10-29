// Value types of the `lap-times` analysis (spec 6.2, A.3).
import type { CarId } from '../ids.ts';
import type { Known } from '../known.ts';
import type { Ms } from '../units.ts';

/** How a sector or lap time ranks; the display only maps it to a colour. */
export type SectorStatus = 'sessionBest' | 'personalBest' | 'none';

/**
 * Whether a car's best time is the session's best. A best lap or sector is always the car's personal best, so the
 * board's bests know no `personalBest`.
 */
export type BestStatus = Extract<SectorStatus, 'sessionBest' | 'none'>;

/** One car on the lap board. */
export type LapBoardRow = {
  carId: CarId;
  lastLapMs: Known<Ms>;
  lastSectorsMs: [Known<Ms>, Known<Ms>, Known<Ms>];
  lastSectorStatus: [SectorStatus, SectorStatus, SectorStatus];
  lastLapStatus: SectorStatus;
  bestLapMs: Known<Ms>;
  bestSectorsMs: [Known<Ms>, Known<Ms>, Known<Ms>];
  /** `sessionBest` when this car's best lap is the session's best lap; `none` otherwise and without a best. */
  bestLapStatus: BestStatus;
  /** Per sector, `sessionBest` when this car's best sector is the session's best sector. */
  bestSectorStatus: [BestStatus, BestStatus, BestStatus];
  /** Sum of the best sectors. */
  theoreticalBestMs: Known<Ms>;
  /** Signed: positive = slower than the reference car. */
  deltaToReference: { bestLapMs: Known<Ms>; bestSectorsMs: [Known<Ms>, Known<Ms>, Known<Ms>]; theoreticalBestMs: Known<Ms> };
};

/** A session-best time and who holds it. */
export type SessionBestTime = { ms: Ms; carId: CarId };

/** `lapTimes.board`: every car's last and best times, as deltas to the reference car, and the session bests. */
export type LapBoard = {
  referenceCarId: CarId;
  rows: LapBoardRow[];
  sessionBest: { lap: Known<SessionBestTime>; sectors: [Known<SessionBestTime>, Known<SessionBestTime>, Known<SessionBestTime>] };
};

/** `lapTimes.projection`: the car's projected lap, and in qualifying the cut-off, in timed sessions the finish margin. */
export type Projection = {
  carId: CarId;
  /** False on in and out laps: everything below is then `notApplicable`. */
  onLap: boolean;
  /** Elapsed time at the latest crossing k + (best lap − the best lap's time at crossing k). */
  projectedLapMs: Known<Ms>;
  deltaToBestMs: Known<Ms>;
  projectedPosition: Known<number>;
  /** Qualifying only; positive margin = inside the cut-off. */
  cutOff: Known<{ position: number; timeMs: Ms; marginMs: Ms }>;
  /** Timed sessions only: the time left when the car crosses the line; positive = another lap can start. */
  finishMarginMs: Known<Ms>;
};
