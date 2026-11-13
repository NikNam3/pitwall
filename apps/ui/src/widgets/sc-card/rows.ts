// The sc-card's rows (SP4.3b spec §10, V18; mockup docs/design/2026-11-12-sp4.3b/sc-card.html; C65): the topic's values
// formatted, nothing computed. The loss's source is the `pit-loss` calculator's (C43); only LOSS takes its badge.
import type { EstimateSource, Ms, ScCall, ScCallRow } from '@pitwall/domain';
import { sharedScale } from '../../kit/dist/dist.ts';
import { knownPart, unknownPart, type CellPart } from '../../kit/grid/grid.ts';
import {
  formatLapRange,
  formatPlacesGained,
  formatPosition,
  formatSeconds,
  formatShare,
} from '../../kit/values/format.ts';

export type Condition = ScCallRow['condition'];

/** The places-gained strip: the topic's bins as they are, or a cell part (a notApplicable mark, else blank). */
export type StripPart = { bins: readonly number[] } | CellPart;

export type ScRow = {
  condition: Condition;
  /** The row of the condition that is out. */
  active: boolean;
  dPos: CellPart;
  pGain: CellPart;
  strip: StripPart;
  rejoin: CellPart;
  loss: CellPart;
  range: CellPart;
  source: EstimateSource;
};

/** A row's strip: its bins; a notApplicable row the kit's mark; any other unknown row blank (the mockup's unknown state). */
function stripOf(bins: ScCallRow['gainBins']): StripPart {
  if (bins.known) return { bins: bins.value };
  return bins.reason === 'notApplicable' ? unknownPart(bins.reason) : { text: '' };
}

/** Whether a strip part carries bins to draw. */
export const isDrawn = (s: StripPart): s is { bins: readonly number[] } => 'bins' in s;

/** The rows' shared strip scale (the kit's `sharedScale` over the drawn strips), so the strips compare. */
export function scaleOf(rows: readonly ScRow[]): number {
  return sharedScale(rows.flatMap((r) => (isDrawn(r.strip) ? [r.strip.bins] : [])));
}

/** One row per topic row, in its order (SC, VSC); `active` the condition that is out, if any. */
export function buildRows(call: ScCall, active: Condition | undefined): ScRow[] {
  return call.rows.map((r) => ({
    condition: r.condition,
    active: r.condition === active,
    dPos: knownPart(r.ePosDelta, formatPlacesGained),
    pGain: knownPart(r.pGain, formatShare),
    strip: stripOf(r.gainBins),
    rejoin: knownPart(r.rejoinPosition, formatPosition),
    loss: knownPart(r.lossMs, (ms: Ms) => formatSeconds(ms, 1)),
    range: knownPart(r.range, (x) => formatLapRange(x.fromLap, x.toLap)),
    source: r.lossSource,
  }));
}
