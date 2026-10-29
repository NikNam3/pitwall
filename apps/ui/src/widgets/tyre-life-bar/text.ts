// Wording specific to this display; text shared with the kit and shell lives in kit/text.ts.
export const headers = { wear: 'WEAR', now: 'NOW', rate: '%/LAP', laps: 'LAPS TO 70%' } as const;
export const age = { new: 'new', one: '1 lap old', many: (n: number): string => `${n} laps old` } as const;
