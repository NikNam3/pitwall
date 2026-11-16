// The Box call's rows (SP4.3d spec §6.3; mockup docs/design/2026-11-16-sp4.3d/sc-card.html; C65): the topic's values
// formatted, nothing computed. The best row of a block and the compact form's option are selections for emphasis
// (ruling R30): the lowest E[pos] in a block, the box option with the highest ΔPOS in compact.
import type { Known, ScCallAnswer, ScCallBlock, ScCallBlocks, ScCallOption } from '@pitwall/domain';
import { sharedScale } from '../../kit/dist/dist.ts';
import { knownPart, type CellPart } from '../../kit/grid/grid.ts';
import { estimatedPrefix } from '../../kit/text.ts';
import {
  formatExpectedPlace,
  formatExpectedPlaceSe,
  formatPlacesGained,
  formatPosition,
  formatShare,
  formatWhole,
} from '../../kit/values/format.ts';
import type { Role } from '../../theme/roles.ts';
import { deltaRole } from './emphasis.ts';
import * as text from './text.ts';

export type Condition = ScCallBlock['condition'];
/** A condition that can be out. */
export type OutCondition = Exclude<Condition, 'green'>;

/** An option's places strip: its pmf as the topic gives it, or a blank cell part. */
export type StripPart = { pmf: readonly number[] } | CellPart;

export type OptionRow = {
  answer: ScCallAnswer;
  label: string;
  /** The block's option with the lowest known E[pos]. */
  best: boolean;
  /** No set of this compound is left. */
  noSet: boolean;
  ePos: CellPart;
  dPos: CellPart;
  pGain: CellPart;
  rejoin: CellPart;
  dPosRole: Role | undefined;
  strip: StripPart;
};

export type BlockView = {
  condition: Condition;
  /** The block of the condition that is out. */
  out: boolean;
  label: string;
  rows: OptionRow[];
  /** The kit's shared scale over the block's known pmfs. */
  scale: number;
  /** Our place now: stay's rejoin position. */
  ourPlace: number | undefined;
  /** The strip's cells: the length of the block's first known pmf. */
  places: number;
};

export type CompactRow = {
  condition: Condition;
  label: string;
  out: boolean;
  option: string;
  dPos: CellPart;
  rejoin: CellPart;
  /** The option's ΔPOS is above zero. */
  lit: boolean;
};

const EMPTY: CellPart = { text: '' };

/** Whether a strip part carries a pmf to draw. */
export const isDrawn = (s: StripPart): s is { pmf: readonly number[] } => 'pmf' in s;

const isNoSet = (o: ScCallOption): boolean => !o.ePos.known && o.ePos.reason === 'noSet';

/** The block's label: the condition's name, with its laps left while it is out and they are known (`SC ~4`). */
function labelOf(b: ScCallBlock, out: boolean): string {
  const name = text.conditions[b.condition];
  return out && b.lapsLeft.known ? `${name} ${estimatedPrefix}${formatWhole(b.lapsLeft.value)}` : name;
}

/** E[pos] with its SE (`8.03±.07`), E[pos] alone while the SE is unknown. */
function ePosPart(o: ScCallOption): CellPart {
  const se = o.se;
  return knownPart(o.ePos, (x) => (se.known ? formatExpectedPlaceSe(x, se.value) : formatExpectedPlace(x)));
}

const dPosPart = (v: Known<number>): CellPart => knownPart(v, (x) => formatPlacesGained(x, 2));
const rejoinPart = (v: Known<number>): CellPart => knownPart(v, formatPosition);

/** The index of the first option with the lowest known value of `pick` (`lowest`) or the highest; -1 without one. */
function firstExtreme(options: readonly ScCallOption[], pick: (o: ScCallOption) => Known<number>, lowest: boolean): number {
  let at = -1;
  let best = 0;
  options.forEach((o, i) => {
    const v = pick(o);
    if (!v.known) return;
    if (at < 0 || (lowest ? v.value < best : v.value > best)) {
      at = i;
      best = v.value;
    }
  });
  return at;
}

function optionRow(o: ScCallOption, best: boolean): OptionRow {
  const label = text.answers[o.answer];
  if (isNoSet(o)) {
    return {
      answer: o.answer, label, best: false, noSet: true,
      ePos: { text: text.noSet }, dPos: EMPTY, pGain: EMPTY, rejoin: EMPTY, dPosRole: undefined, strip: EMPTY,
    };
  }
  const stay = o.answer === 'stay';
  return {
    answer: o.answer,
    label,
    best,
    noSet: false,
    ePos: ePosPart(o),
    dPos: stay ? EMPTY : dPosPart(o.ePosDelta),
    pGain: stay ? EMPTY : knownPart(o.pGain, formatShare),
    rejoin: rejoinPart(o.rejoinPosition),
    dPosRole: !stay && o.ePosDelta.known ? deltaRole(o.ePosDelta.value) : undefined,
    strip: o.positionPmf.known ? { pmf: o.positionPmf.value } : EMPTY,
  };
}

function blockView(b: ScCallBlock, outCondition: OutCondition | undefined): BlockView {
  const out = b.condition === outCondition;
  const bestAt = firstExtreme(b.options, (o) => o.ePos, true);
  const rows = b.options.map((o, i) => optionRow(o, i === bestAt));
  const pmfs = rows.flatMap((r) => (isDrawn(r.strip) ? [r.strip.pmf] : []));
  const stay = b.options.find((o) => o.answer === 'stay');
  return {
    condition: b.condition,
    out,
    label: labelOf(b, out),
    rows,
    scale: sharedScale(pmfs),
    ourPlace: stay?.rejoinPosition.known ? stay.rejoinPosition.value : undefined,
    places: pmfs[0]?.length ?? 0,
  };
}

/** One block view per topic block, in its order; `out` the condition the presentation table names, if any. */
export function buildBlocks(call: ScCallBlocks, out: OutCondition | undefined): BlockView[] {
  return call.blocks.map((b) => blockView(b, out));
}

function compactRow(b: ScCallBlock, outCondition: OutCondition | undefined): CompactRow {
  const out = b.condition === outCondition;
  const boxes = b.options.filter((o) => o.answer !== 'stay');
  const at = firstExtreme(boxes, (o) => o.ePosDelta, false);
  const shown = boxes[at];
  const head = { condition: b.condition, label: labelOf(b, out), out };
  if (shown === undefined || !shown.ePosDelta.known) {
    const first = boxes[0];
    return {
      ...head,
      option: '',
      dPos: first === undefined ? EMPTY : dPosPart(first.ePosDelta),
      rejoin: first === undefined ? EMPTY : rejoinPart(first.rejoinPosition),
      lit: false,
    };
  }
  return {
    ...head,
    option: text.answers[shown.answer],
    dPos: dPosPart(shown.ePosDelta),
    rejoin: rejoinPart(shown.rejoinPosition),
    lit: shown.ePosDelta.value > 0,
  };
}

/** One compact row per topic block: the box option with the highest known ΔPOS, never stay. */
export function buildCompact(call: ScCallBlocks, out: OutCondition | undefined): CompactRow[] {
  return call.blocks.map((b) => compactRow(b, out));
}
