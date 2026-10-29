// The top bar's gallery cases (spec 10): topic overrides by case name, typed by the contracts. Task 4 draws them as cells.
import type { TopicValue } from '@pitwall/contracts';
import { known, unknown } from '@pitwall/domain';
import type { GalleryOverride } from './gallery-connection.ts';

/** A battle: a car within reach on the next laps (spec 7.2, moment 4); battle has no `since` (ruling R1). */
const battle: TopicValue<'raceMoment.current'> = known(
  { moment: 'battle', since: unknown('notApplicable'), cause: { rule: 'battle', params: { carId: 3, lapsToDrs: 1.5 } }, active: ['battle', 'carCare'] },
  1_200_000,
);

export const TOP_BAR_CASES: Record<string, GalleryOverride[]> = {
  battle: [{ topic: 'raceMoment.current', value: battle }],
};
