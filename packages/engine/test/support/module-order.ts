// Runs `step` with a step's module list in another order (C11: no coupling within a step, so any order gives the same
// result). `step` reads `STATE_UPDATE` and `RECORDERS` on every call, so the list is reordered in place and put back.

/** Runs `fn` while `modules` holds `order` (a permutation of it), then restores the list, also when `fn` throws. */
export const inOrder = <T, R>(modules: T[], order: readonly T[], fn: () => R): R => {
  const saved = [...modules];
  modules.splice(0, modules.length, ...order);
  try {
    return fn();
  } finally {
    modules.splice(0, modules.length, ...saved);
  }
};
