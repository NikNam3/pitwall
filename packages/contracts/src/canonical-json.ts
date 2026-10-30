// Canonical JSON text for equality and map keys (subscription ids, the topic store, gallery moments, window sync).
// Not the wire format: that lives in `wire.ts`.

/** JSON with object keys sorted by code unit at every depth (arrays keep their order), so equal values give equal text. */
export const canonicalJson = (value: unknown): string =>
  JSON.stringify(value, (_k, v: unknown) =>
    typeof v === 'object' && v !== null && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
