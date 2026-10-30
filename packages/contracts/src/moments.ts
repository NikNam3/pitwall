import type { TopicName } from './topics.ts';

/**
 * The values of every topic at one named moment of a recording (spec 9.1): state topics carry `value`, append topics
 * `entries`. A topic with params appears once per params its `momentParams` gives for the active cars.
 */
export type MomentValues = Array<{ topic: TopicName; params: object; value?: unknown; entries?: unknown[] }>;
