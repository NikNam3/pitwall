import type { CarId } from '@pitwall/domain';

/** The owner of a topic: `core` or any feature name. */
export type TopicOwner = 'core' | (string & {});

/**
 * A topic's definition (spec 8.4). `params` and `value` are phantom: they only carry types and are absent at runtime.
 * `state` replaces the previous value, `append` adds entries.
 */
export type TopicDef<P, V> = {
  name: string;
  /** Who registers and publishes the topic: `core` or a feature's name. */
  owner: TopicOwner;
  /** `feed` topics belong to one feed and reset with it; `global` topics belong to no feed (spec 7.8). */
  scope: 'feed' | 'global';
  mode: 'state' | 'append';
  maxHz: number;
  params?: P;
  value?: V;
};

/** What a topic file default-exports; the generated index adds the `name` from the file name. */
export function defineTopic<P, V>(def: {
  owner: TopicOwner;
  mode: TopicDef<P, V>['mode'];
  maxHz: number;
  scope?: TopicDef<P, V>['scope'];
}): Omit<TopicDef<P, V>, 'name'> {
  return { owner: def.owner, mode: def.mode, maxHz: def.maxHz, scope: def.scope ?? 'feed' };
}

/** Params of a topic that takes none. */
export type NoParams = Record<string, never>;
/** Params of a per-car topic. */
export type CarParams = { carId: CarId };
