// Wording specific to the timing tower; text shared with the kit lives in kit/text.ts.
export const pit = { pit: 'PIT', out: 'OUT' } as const;
/** Marks a retired car in its GAP cell (the lap goes in INT). */
export const dnf = 'DNF';
/** The column headers by column key. */
export const headers = {
  position: 'P', change: '', car: 'DRV', gap: 'GAP', interval: 'INT', toUs: 'TO US', last: 'LAST', s1: 'S1', s2: 'S2', s3: 'S3',
  compound: 'T', age: 'AGE', stops: 'ST', penalty: 'PEN', pit: 'PIT',
} as const;
/**
 * An unserved stop-go or drive-through in the PEN cell: its code (`count` > 1 goes before it: `2DT`), and its name for
 * the hover.
 */
export const unservedPenalty = {
  stopGo: { code: (count: number) => `${count > 1 ? count : ''}SG`, name: (count: number) => (count > 1 ? `${count} stop-gos to serve` : 'stop-go to serve') },
  driveThrough: {
    code: (count: number) => `${count > 1 ? count : ''}DT`,
    name: (count: number) => (count > 1 ? `${count} drive-throughs to serve` : 'drive-through to serve'),
  },
} as const;
/** The hover of a stop-go or drive-through beside a time penalty: `drive-through to serve, 5s time penalty`. */
export const withTimePenalty = (name: string, time: string): string => `${name}, ${time} time penalty`;
