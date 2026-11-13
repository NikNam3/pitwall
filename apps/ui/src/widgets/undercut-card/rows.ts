// The undercut card's lines (SP4.3b spec §9.1, §10; mockup undercut-card.html, gen.mjs `undercutLines`). Every gain,
// chance and place is `undercut`'s (Task 7); the lines format them, order them as the topic does and place the strip's
// marks in bins, they compute nothing (C65).
import type { CarOverview } from '@pitwall/contracts';
import { UNDERCUT_GAIN_BINS, type CarId, type Undercut, type UndercutCase, type UndercutRival } from '@pitwall/domain';
import { carCodeById } from '../../kit/car/car-label.ts';
import { sharedScale, type GainZero } from '../../kit/dist/dist.ts';
import { knownPart, unknownPart, type CellPart } from '../../kit/grid/grid.ts';
import { formatPosition, formatSeconds, formatShare, formatSignedSeconds } from '../../kit/values/format.ts';

/** The field's identities (`cars.overview`): codes by car id, never by slot. */
export type Cars = readonly CarOverview[];

/** The gain strip of a case: its bins and the bin the rival's gap falls at, or the unknown's part. */
export type Strip = { known: true; bins: readonly number[]; markAtBin: number } | { known: false; part: CellPart };

/** One full-size row of a rival: one per case; car, place and gap only on its N = 1 row. */
export type CaseRow = {
  carId: CarId;
  n: UndercutCase['n'];
  car: CellPart;
  pos: string;
  gap: string;
  dGap: CellPart;
  pAhead: CellPart;
  strip: Strip;
  rej: CellPart;
};
/** Our own line: code and place; when no rival is in range, the range on hover. */
export type OwnLine = { carId: CarId; car: CellPart; pos: string; noneInRange: boolean };
/** A full-size line: a rival's case or our line. */
export type FullLine = ({ own: false } & CaseRow) | ({ own: true } & OwnLine);
/** A compact line: a car's code and place and, for a rival, ΔGAP per N (`null` for an absent case). */
export type CompactLine = { carId: CarId; own: boolean; car: CellPart; pos: string; dGap: Record<UndercutCase['n'], CellPart | null> };

/** Zero lies between the bins below and above 0 ms. */
export const GAIN_ZERO = { between: -UNDERCUT_GAIN_BINS.fromMs / UNDERCUT_GAIN_BINS.stepMs } satisfies GainZero;
const AXIS_TO = formatSignedSeconds(UNDERCUT_GAIN_BINS.fromMs + UNDERCUT_GAIN_BINS.count * UNDERCUT_GAIN_BINS.stepMs, 0);
/**
 * The strip's axis header, one text per part with its cells: its first bin's lower edge up to the zero line, zero, its
 * last bin's upper edge at the strip's end (`−4      0     +4`, gen.mjs `gainHeader`).
 */
export const gainAxis: readonly { text: string; width: number }[] = [
  { text: formatSignedSeconds(UNDERCUT_GAIN_BINS.fromMs, 0), width: GAIN_ZERO.between },
  { text: formatSeconds(0, 0), width: UNDERCUT_GAIN_BINS.count - GAIN_ZERO.between - AXIS_TO.length },
  { text: AXIS_TO, width: AXIS_TO.length },
];

/** The cases' N, in order. */
export const NS = [1, 2, 3] as const;
const ahead = (u: Undercut): UndercutRival[] => u.rivals.filter((r) => r.side === 'ahead');
const behind = (u: Undercut): UndercutRival[] => u.rivals.filter((r) => r.side === 'behind');
const dGapPart = (k: UndercutCase): CellPart => knownPart(k.gainMs, (g) => formatSignedSeconds(g, 1));

/** The bin a gain falls at, in the strip's units. */
const binOf = (gainMs: number): number => (gainMs - UNDERCUT_GAIN_BINS.fromMs) / UNDERCUT_GAIN_BINS.stepMs;

/** One scale over every known gain strip of the card, so rows compare (Q2 A). */
export const stripScale = (u: Undercut): number =>
  sharedScale(u.rivals.flatMap((r) => r.cases.flatMap((k) => (k.gainBins.known ? [k.gainBins.value] : []))));

function ownLine(u: Undercut, cars: Cars): OwnLine {
  return { carId: u.carId, car: carCodeById(cars, u.carId), pos: formatPosition(u.position), noneInRange: u.rivals.length === 0 };
}

function caseRows(r: UndercutRival, cars: Cars): CaseRow[] {
  return r.cases.map((k) => {
    const first = k.n === 1;
    return {
      carId: r.carId,
      n: k.n,
      car: first ? carCodeById(cars, r.carId) : { text: '' },
      pos: first ? formatPosition(r.position) : '',
      gap: first ? formatSeconds(r.gapMs, 1) : '',
      dGap: dGapPart(k),
      pAhead: knownPart(k.pAhead, formatShare),
      strip: k.gainBins.known ? { known: true, bins: k.gainBins.value, markAtBin: binOf(r.aheadFromGainMs) } : { known: false, part: unknownPart(k.gainBins.reason) },
      rej: knownPart(k.rejoinPosition, formatPosition),
    };
  });
}

/** The full card: the rivals ahead in topic order, our line, the rivals behind in topic order; one row per case. */
export function fullLines(u: Undercut, cars: Cars): FullLine[] {
  const rows = (rs: UndercutRival[]): FullLine[] => rs.flatMap((r) => caseRows(r, cars).map((c): FullLine => ({ own: false, ...c })));
  return [...rows(ahead(u)), { own: true, ...ownLine(u, cars) }, ...rows(behind(u))];
}

/** The compact card: one line per car in the same order, ΔGAP per N. */
export function compactLines(u: Undercut, cars: Cars): CompactLine[] {
  const rival = (r: UndercutRival): CompactLine => {
    const of = (n: UndercutCase['n']): CellPart | null => {
      const k = r.cases.find((c) => c.n === n);
      return k === undefined ? null : dGapPart(k);
    };
    return { carId: r.carId, own: false, car: carCodeById(cars, r.carId), pos: formatPosition(r.position), dGap: { 1: of(1), 2: of(2), 3: of(3) } };
  };
  const own = ownLine(u, cars);
  return [...ahead(u).map(rival), { carId: own.carId, own: true, car: own.car, pos: own.pos, dGap: { 1: null, 2: null, 3: null } }, ...behind(u).map(rival)];
}
