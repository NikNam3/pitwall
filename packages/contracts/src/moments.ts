import type { TopicName } from './topics.ts';

/**
 * The values of every topic at one named moment of a recording (spec 9.1): state topics carry `value`, append topics
 * `entries`. Per-car topics appear once per active car, with `{ carId }` as `params`.
 */
export type MomentValues = Array<{ topic: TopicName; params: object; value?: unknown; entries?: unknown[] }>;
