type Primitive = string | number | boolean | bigint | symbol | null | undefined;

/**
 * Read-only at every depth: the outside view of the engine's mutable state (spec 6.4).
 * Primitives come first so branded ids (`number & { __brand }`) stay unchanged; functions stay callable; `unknown` (what
 * only its owner reads, such as a recorder's own state) stays `unknown`.
 */
export type DeepReadonly<T> = unknown extends T
  ? T
  : T extends Primitive
    ? T
    : T extends (...args: never[]) => unknown
      ? T
      : T extends ReadonlyMap<infer K, infer V>
        ? ReadonlyMap<K, DeepReadonly<V>>
        : T extends ReadonlySet<infer V>
          ? ReadonlySet<DeepReadonly<V>>
          : { readonly [K in keyof T]: DeepReadonly<T[K]> };
