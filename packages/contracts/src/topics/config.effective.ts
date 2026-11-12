// The feed's effective config (C47, C54; SP4.3b Task 2): every unit's thresholds as its run uses them, and the keys
// whose value came from `config.json`. Published by the feed's pipeline once per session start.
import { defineTopic, type NoParams } from '../topic-def.ts';

export type ConfigEffectiveValue = {
  /** Per unit id, every declared key with its effective value. */
  values: Record<string, Record<string, number | string | boolean>>;
  /** Per unit id, the keys whose value came from `config.json`. */
  overridden: Record<string, string[]>;
};

export default defineTopic<NoParams, ConfigEffectiveValue>({ owner: 'core', mode: 'state', maxHz: Infinity });
