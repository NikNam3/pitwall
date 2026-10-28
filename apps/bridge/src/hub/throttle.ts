/** Minimum milliseconds between two value messages of a topic that updates at most `maxHz` times a second. */
export const intervalMs = (maxHz: number): number => (Number.isFinite(maxHz) ? 1000 / maxHz : 0);
