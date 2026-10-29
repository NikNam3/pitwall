// Wording specific to the timing tower; text shared with the kit lives in kit/text.ts.
export const pit = { pit: 'PIT', out: 'OUT' } as const;
/** Marks a retired car in its GAP cell (the lap goes in INT). */
export const dnf = 'DNF';
/** The column headers by column key. */
export const headers = {
  position: 'P', change: '', car: 'DRV', gap: 'GAP', interval: 'INT', toUs: 'TO US', last: 'LAST', s1: 'S1', s2: 'S2', s3: 'S3',
  compound: 'T', age: 'AGE', stops: 'ST', penalty: 'PEN', pit: 'PIT',
} as const;
