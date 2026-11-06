// Wording of the forecast-strip display; text shared with the kit lives in kit/text.ts.
import type { Trend, Weather } from '@pitwall/domain';

/** The weather word of a sample, short enough for a column. */
export const weather = {
  clear: 'clear',
  lightCloud: 'cloud',
  overcast: 'overc.',
  lightRain: 'l.rain',
  heavyRain: 'h.rain',
  storm: 'storm',
} as const satisfies Record<Weather, string>;

/** The game's temperature trend as a mark; flat has none. */
export const trend = { up: '▲', down: '▼', flat: '' } as const satisfies Record<Trend, string>;

/** The offset of the first sample. */
export const now = 'now';

/** The full strip's row labels. */
export const rowLabels = { offset: 'MIN', sky: 'SKY', rain: 'RAIN %', track: 'TRACK', air: 'AIR' } as const;

/** The compact lines' labels. */
export const compactLabels = { now: 'now', track: 'track', air: 'air', rain: 'rain' } as const;

/** The first rain at a later sample: `45% at +30 min`. */
export const rainAtOffset = (pct: string, offset: string): string => `${pct} at ${offset} min`;

/** The first rain at the first sample: `55% now`. */
export const rainNow = (pct: string): string => `${pct} ${now}`;

/** The note on the game's accuracy flag, per mode; a perfect forecast has none. */
export const accuracyNote = {
  full: { approximate: 'approximate', perfect: '' },
  compact: { approximate: 'approx.', perfect: '' },
} as const;
