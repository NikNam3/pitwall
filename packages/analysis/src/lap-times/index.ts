// `lap-times` (spec 6.2): publishes `lapTimes.board` (`{ referenceCarId }`) and `lapTimes.projection` (`CarParams`).
import type { CarId, LapBoard, LapBoardRow, Projection } from '@pitwall/domain';

export type { LapBoard, LapBoardRow, Projection, SectorStatus, SessionBestTime } from '@pitwall/domain';
export * from './config.ts';

/** The calculator id. */
export const LAP_TIMES = 'lap-times';

/**
 * The output. The board binding's `select` adds `referenceCarId` and each row's `deltaToReference` from its params;
 * the projection binding's `select` picks `params.carId`.
 */
export type LapTimesOutput = {
  rows: Omit<LapBoardRow, 'deltaToReference'>[];
  sessionBest: LapBoard['sessionBest'];
  projections: Record<CarId, Projection>;
};
