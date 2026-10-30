// Every car's last and best times as deltas to the reference car, and the session bests (spec 6.2).
import type { CarId, LapBoard } from '@pitwall/domain';
import { defineTopic } from '../topic-def.ts';

/** The lap board's params: the car every delta is measured to. */
export type LapBoardParams = { referenceCarId: CarId };

export default defineTopic<LapBoardParams, LapBoard>({
  owner: 'lap-times',
  mode: 'state',
  maxHz: 4,
  momentParams: (carIds) => carIds.map((referenceCarId) => ({ referenceCarId })),
});
