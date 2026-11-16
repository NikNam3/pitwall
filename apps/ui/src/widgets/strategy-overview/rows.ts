// The Field plans rows (SP4.3d spec §6.4, V06; mockup strategy-overview.html, gen.mjs `overviewLines`): every gap,
// window, chance and plan is `strategy-overview`'s; the rows format them in the topic's (race) order and pick the
// likeliest of the topic's odds to show, they compute nothing (C65). Wording in text.ts, numbers through the kit (C68).
import type { CarOverview } from '@pitwall/contracts';
import type { CarId, Known, NoiseCompound, OverviewRow, StrategyOverview } from '@pitwall/domain';
import { carCodeById } from '../../kit/car/car-label.ts';
import { COMPOUND_MARK } from '../../kit/compound/compound-mark.ts';
import { knownPart, unknownPart, type CellPart } from '../../kit/grid/grid.ts';
import { formatLapNumber, formatLapRange, formatPosition, formatShare, formatSignedSeconds, formatWhole } from '../../kit/values/format.ts';
import type { RowKind } from './emphasis.ts';
import * as text from './text.ts';

/** The field's identities (`cars.overview`): codes by car id, never by slot. */
export type Cars = readonly CarOverview[];

export type FieldRow = {
  carId: CarId;
  kind: RowKind;
  code: CellPart;
  pos: string;
  gap: CellPart;
  tyre: CellPart;
  owes: boolean;
  next: CellPart;
  nextHover: string | undefined;
  window: CellPart;
};

const EMPTY: CellPart = { text: '' };

/** A rival's value that may be `notApplicable` (the car has made its stops): empty then, as the mockup draws it. */
const stopsPart = <T>(v: Known<T>, format: (t: T) => string): CellPart =>
  !v.known && v.reason === 'notApplicable' ? EMPTY : knownPart(v, format);

/** The odds, likeliest first. */
const oddsOf = (odds: Partial<Record<NoiseCompound, number>>): [NoiseCompound, number][] =>
  (Object.entries(odds) as [NoiseCompound, number][]).sort((a, b) => b[1] - a[1]);

const letterOf = (c: NoiseCompound): string => COMPOUND_MARK[c].letter;

/** `H80`: the likeliest compound's letter and its chance in whole percent; empty without odds. */
function likeliest(odds: Partial<Record<NoiseCompound, number>>): string {
  const top = oddsOf(odds)[0];
  return top === undefined ? '' : `${letterOf(top[0])}${formatWhole(top[1] * 100)}`;
}

function hoverOf(r: OverviewRow): string | undefined {
  if (!r.window.known || !r.nextCompound.known) return undefined;
  const w = r.window.value;
  const odds = oddsOf(r.nextCompound.value).map(([c, p]) => text.odd(letterOf(c), formatShare(p)));
  return text.nextHover(odds, formatLapNumber(w.lowLap), formatLapNumber(w.highLap), formatLapNumber(w.midLap));
}

/** Our compact WINDOW: plan A's first stop after now, `A L22`; empty without one. */
function planWindow(r: OverviewRow, now: number): CellPart {
  const stop = r.plan?.a?.stops.find((s) => s.lap > now);
  return stop === undefined ? EMPTY : { text: text.planAStop(formatLapNumber(stop.lap, 2)) };
}

/** The lap now: the overview's car's lap in `cars.overview`; undefined while the car is not listed. */
export const lapNow = (cars: Cars, carId: CarId): number | undefined => cars.find((c) => c.id === carId)?.timing.lap;

/** One row per topic row, in topic order. */
export function fieldRows(input: { overview: StrategyOverview; cars: Cars; now: number }): FieldRow[] {
  const { overview, cars, now } = input;
  return overview.rows.map((r): FieldRow => {
    const kind: RowKind = r.carId === overview.carId ? 'own' : r.plan !== null ? 'mate' : 'rival';
    const rival = kind === 'rival';
    const tyre: CellPart = !r.compound.known
      ? unknownPart(r.compound.reason)
      : !r.tyreAge.known
        ? unknownPart(r.tyreAge.reason)
        : { text: `${COMPOUND_MARK[r.compound.value].letter} ${formatWhole(r.tyreAge.value)}` };
    return {
      carId: r.carId,
      kind,
      code: carCodeById(cars, r.carId),
      pos: formatPosition(r.position),
      gap: kind === 'own' ? EMPTY : knownPart(r.gapMs, (g) => formatSignedSeconds(g, 1)),
      tyre,
      owes: r.owesCompound.known && r.owesCompound.value,
      next: rival ? stopsPart(r.nextCompound, likeliest) : EMPTY,
      nextHover: rival ? hoverOf(r) : undefined,
      window: rival ? stopsPart(r.window, (w) => formatLapRange(w.lowLap, w.highLap)) : planWindow(r, now),
    };
  });
}
