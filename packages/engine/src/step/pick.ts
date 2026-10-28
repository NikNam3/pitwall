/**
 * Reads a game code from its lookup table: `table[code]`, or `fallback` for a code the spec does not list.
 * The fallback is the first entry unless given.
 */
export const pick = <T>(table: readonly [T, ...T[]], code: number, fallback: T = table[0]): T => table[code] ?? fallback;
