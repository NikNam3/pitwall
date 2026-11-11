// A per-car sub-machine's open state that did not change on a frame (contract C9, C40): when every car's entry is the
// one of the frame before (by identity), the step keeps the open state itself, so its open spans are built once
// (`run.ts`, `spansOf`) and the `spans:<id>` tag compares one identity. An open state is never changed in place, so
// keeping it is keeping its value.

/** `after` holds the same entries as `before`, by identity. */
export const sameEntries = <T>(before: readonly T[], after: readonly T[]): boolean => {
  if (before.length !== after.length) return false;
  for (let i = 0; i < after.length; i++) if (after[i] !== before[i]) return false;
  return true;
};
