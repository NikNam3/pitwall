/**
 * A topic's definition (spec 8.4). `params` and `value` are phantom: they only carry types and are absent at runtime.
 * `state` replaces the previous value, `append` adds entries.
 */
export type TopicDef<P, V> = {
  name: string;
  mode: 'state' | 'append';
  maxHz: number;
  params?: P;
  value?: V;
};

/** What a topic file default-exports; the generated index adds the `name` from the file name. */
export function defineTopic<P, V>(def: { mode: TopicDef<P, V>['mode']; maxHz: number }): Omit<TopicDef<P, V>, 'name'> {
  return { mode: def.mode, maxHz: def.maxHz };
}

/** Params of a topic that takes none. */
export type NoParams = Record<string, never>;
/** Params of a per-car topic. */
export type CarParams = { carId: number };
