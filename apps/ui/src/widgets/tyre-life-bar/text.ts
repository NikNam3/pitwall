// Wording specific to this display; text shared with the kit and shell lives in kit/text.ts.
export const headers = { wear: 'WEAR', now: 'NOW', rate: '%/LAP' } as const;
/** Header of the laps column, named after the wear limit the laps count to (`LAPS TO 70%`). */
export const lapsHeader = (limit: string): string => `LAPS TO ${limit}`;
export const age = { new: 'new', one: '1 lap old', many: (n: number): string => `${n} laps old` } as const;
