import type { CarId } from '@pitwall/domain';
import { carColour } from '../../theme/index.ts';

/** A car as the line look sees it. */
export type LineCar = { id: CarId; teamId: number; raceNumber: number };

/**
 * The look of one car's line: the kit's `carColour` over the cars the chart draws, so a rival is dashed only when a drawn
 * car of its team has a lower race number. `ours` is ordered: the player, then the teammate.
 */
export function lineLook(car: LineCar, drawn: readonly LineCar[], ours: ReadonlySet<CarId>): { colour: string; dashed: boolean; ownCar: boolean } {
  return carColour(car, drawn, ours);
}
