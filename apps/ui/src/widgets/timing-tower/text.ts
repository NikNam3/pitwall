// Wording specific to the timing tower; text shared with the kit lives in kit/text.ts.
export const lapsDown = (n: number): string => `+${n} ${n === 1 ? 'lap' : 'laps'}`;
export const penaltySeconds = (ms: number): string => `${Math.round(ms / 1000)}s`;
export const warningCount = (n: number): string => `${n}w`;
export const pit = { pit: 'PIT', out: 'OUT' } as const;
/** Marks a retired car in its GAP cell (the lap goes in INT). */
export const dnf = 'DNF';
