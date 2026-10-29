// Wording specific to this display; text shared with the kit and shell lives in kit/text.ts.
export const labels = {
  margin: 'MARGIN',
  lasts: 'LASTS',
  toGo: 'TO GO',
  burn: 'BURN',
  save: 'SAVE',
  game: 'GAME',
} as const;

/** Suffix of the game's figure: it is the game's own margin, not ours. */
export const gameSuffix = 'margin';

/** What the fuel lasts: the laps with the kg behind them, `3.4 laps (12.3 kg)`. */
export const lasts = (laps: string, kg: string): string => `${laps} (${kg})`;

/** Width of the label column in cells: the longest label and one gap. */
export const labelWidth = Math.max(...Object.values(labels).map((l) => l.length)) + 1;
