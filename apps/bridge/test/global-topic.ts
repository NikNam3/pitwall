// Test-only: registers a global state topic in the generated TOPICS table (hub and ws read the same object), so the
// global paths can be tested before any real `ui.*` topic exists. The mutation lives in the test process only.
import { TOPICS } from '@pitwall/contracts';
import type { TopicName } from '@pitwall/contracts';

export const GLOBAL_TOPIC = 'test.global' as TopicName;

(TOPICS as Record<string, unknown>)[GLOBAL_TOPIC] = {
  name: GLOBAL_TOPIC,
  owner: 'test',
  mode: 'state',
  maxHz: 1000,
  scope: 'global',
};
