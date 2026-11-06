import type { TopicName } from '@pitwall/contracts';

/**
 * Topics whose contract is committed before the feature that binds them (C81, ADR 0014). Each binding task's test phase
 * removes its topic here, which makes the registry and moment-capture tests demand the binding. Empty at the end of a
 * run.
 */
export const NOT_YET_BOUND: ReadonlySet<TopicName> = new Set<TopicName>([
  'trackPositions.geometry', // SP4.0 Task 7
  'trackPositions.cars', // SP4.0 Task 7
  'incidents.markers', // SP4.0 Task 8
]);
