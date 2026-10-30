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
  /**
   * The params a named moment (spec 9.1) captures the topic with, given every car id it may hold; the capture keeps
   * those of the cars that are active at the moment. Absent for a topic without params: it is captured with `{}`.
   */
  momentParams?: (carIds: readonly CarId[]) => P[];
};

/** `momentParams` is required exactly for a topic with params, so no such topic is left out of the moments. */
type MomentParamsOption<P> = [P] extends [NoParams] ? { momentParams?: never } : { momentParams: (carIds: readonly CarId[]) => P[] };

/** What a topic file default-exports; the generated index adds the `name` from the file name. */
export function defineTopic<P, V>(
  def: {
    owner: TopicOwner;
    mode: TopicDef<P, V>['mode'];
    maxHz: number;
    scope?: TopicDef<P, V>['scope'];
  } & MomentParamsOption<P>,
): Omit<TopicDef<P, V>, 'name'> {
  const base = { owner: def.owner, mode: def.mode, maxHz: def.maxHz, scope: def.scope ?? 'feed' } as const;
  return def.momentParams === undefined ? base : { ...base, momentParams: def.momentParams };
}

/** `momentParams` of a per-car topic: one `{ carId }` per car. */
export const eachCar = (carIds: readonly CarId[]): CarParams[] => carIds.map((carId) => ({ carId }));

/** Params of a topic that takes none. */
export type NoParams = Record<string, never>;
/** Params of a per-car topic. */
export type CarParams = { carId: CarId };
