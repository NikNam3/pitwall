// Wording specific to this display; text shared with the kit and shell lives in kit/text.ts.
export const labels = { store: 'STORE', deploy: 'DEPLOY', harvest: 'HARVEST', trend: 'TREND', thisLap: 'this lap', limit: 'limit' } as const;
export const deploying = '▼ deploying';
export const harvesting = '▲ harvesting';
export const perLap = 'MJ/lap';
export const attackReady = 'attack ready';
export const attackIn = (laps: number): string => `attack in ${laps} ${laps === 1 ? 'lap' : 'laps'}`;
/** Hover text of the bar: the attack level. */
export const attackLevel = (level: string): string => `attack level ${level}`;
