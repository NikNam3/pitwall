// The rows of the tyre-life display: pure, so the component only prints them (displays do no arithmetic).
import { known } from '@pitwall/domain';
import type { Known, TyreWear, UnknownReason } from '@pitwall/domain';
import { barCells } from '../../kit/bar/bar.ts';
import type { BarCells, BarInput } from '../../kit/bar/bar.ts';
import { fixed, formatPercent, formatWholeLaps } from '../../kit/values/format.ts';
import * as text from './text.ts';

/** Cells taken by everything but the bar: label, gaps, NOW, %/LAP and LAPS TO 70% (mockup 1-car-care.html). */
const FIXED_COLUMNS = 27;
const MIN_BAR_COLUMNS = 4;
const ORDER = ['fl', 'fr', 'rl', 'rr'] as const;
type CornerKey = (typeof ORDER)[number];

export type TyreLifeRow = {
  corner: CornerKey;
  label: string;
  bar: BarCells;
  /** The same bar as input of the kit `Bar`. */
  barInput: BarInput;
  wearText: string;
  rateText: string;
  lapsText: string;
  lapsToLimit: Known<number>;
  /** Why a cell is empty, for the hover. */
  reasons: { wear: UnknownReason | undefined; rate: UnknownReason | undefined; laps: UnknownReason | undefined };
};

/** Bar columns from which the header has room for the age in words beside WEAR. */
export const AGE_MIN_BAR_COLUMNS = 16;

/** What is left of the width for the bar. */
export const barColumns = (cols: number): number => Math.max(MIN_BAR_COLUMNS, cols - FIXED_COLUMNS);

/** The header's age of the fitted set. */
export function ageText(age: number): string {
  if (age === 0) return text.age.new;
  return age === 1 ? text.age.one : text.age.many(age);
}

const reasonOf = (k: Known<unknown>): UnknownReason | undefined => (k.known ? undefined : k.reason);

/** The four corners FL, FR, RL, RR. The game's life span is marked at the wear the corner's own rate reaches by then. */
export function tyreLifeRows(wear: TyreWear, cols: number): TyreLifeRow[] {
  return ORDER.map((corner) => {
    const c = wear.corners[corner];
    const life = wear.gameLifeSpanLaps;
    const marker = c.ratePctPerLap.known && life.known ? known(c.ratePctPerLap.value * life.value, c.ratePctPerLap.at) : undefined;
    const barInput: BarInput = { value: c.wearPct, min: 0, max: 100, cols, limit: wear.limitPct, marker };
    const bar = barCells(barInput);
    return {
      corner,
      label: corner.toUpperCase(),
      bar,
      barInput,
      wearText: c.wearPct.known ? formatPercent(c.wearPct.value) : '',
      rateText: c.ratePctPerLap.known ? fixed(c.ratePctPerLap.value, 1) : '',
      lapsText: c.lapsToLimit.known ? formatWholeLaps(c.lapsToLimit.value) : '',
      lapsToLimit: c.lapsToLimit,
      reasons: { wear: reasonOf(c.wearPct), rate: reasonOf(c.ratePctPerLap), laps: reasonOf(c.lapsToLimit) },
    };
  });
}
