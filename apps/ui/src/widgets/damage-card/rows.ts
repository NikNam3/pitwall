import type { Corners, DamageJump, DamageParts, DamageState, Known, SessionTime } from '@pitwall/domain';
import { formatCount, formatDeltaPct, formatLapNumber, formatPct, formatSecondsPerLap } from '../../kit/values/format.ts';
import { knownPart, type CellPart } from '../../kit/grid/grid.ts';
import { insightText } from '../../kit/text.ts';
import type { Role } from '../../theme/roles.ts';
import { jumpRole } from './emphasis.ts';
import * as text from './text.ts';

/**
 * One listed damage jump; `at` is when it happened, the row's identity; `loss` is its lap-time cost as a cell part;
 * `title` explains a loss that can never be measured.
 */
export type JumpRow = { at: SessionTime; text: string; loss: CellPart; title?: string; role?: Role };

/** The full card's widths in character cells (mockup 1-car-care.html): every fixed field of its lines. */
export const FULL_WIDTHS = {
  /** The row label (`WING`, `FLOOR`, `GBX`). */
  label: 7,
  /** The left and right wing columns. */
  wing: 4,
  /** The rear wing column. */
  wingRear: 5,
  /** A part value (`12%`). */
  value: 3,
  /** The second label of a line (`DIFF`, `ENG`). */
  shortLabel: 5,
  /** The sidepod label. */
  sidepodLabel: 8,
  /** A jump's text before its loss. */
  jump: 20,
} as const;

/** What the damage card shows. */
export type DamageRows = {
  parts: Record<'wingL' | 'wingR' | 'wingRear' | 'floor' | 'diffuser' | 'sidepod' | 'gearbox' | 'engine', CellPart>;
  corners: Corners<{ tyre: CellPart; brake: CellPart }>;
  faults: string[];
  jumps: JumpRow[];
  compact: { parts: string; jump?: JumpRow };
};

const cell = (k: Known<number>): CellPart => knownPart(k, formatPct);

/** A jump's loss: measured, still measuring, never measurable (with why as `title`), or hidden (its reason's mark). */
function jumpLoss(loss: Known<number>): Pick<JumpRow, 'loss' | 'title'> {
  if (!loss.known && loss.reason === 'insufficientData') return { loss: { text: text.lossMeasuring } };
  if (!loss.known && loss.reason === 'notApplicable') return { loss: { text: text.lossNotMeasurable }, title: text.lossNotMeasurableTitle };
  return { loss: knownPart(loss, (ms) => text.lossMeasured(formatSecondsPerLap(ms))) };
}

function jumpRow(jump: DamageJump, newest: boolean): JumpRow {
  const parts = jump.parts.map((p) => insightText.part[p]).join(text.partSeparator);
  const jumpText = `${formatLapNumber(jump.lap, 2)} ${parts} ${formatDeltaPct(jump.deltaPct)}`;
  const row: JumpRow = { at: jump.at, text: jumpText, ...jumpLoss(jump.lossMsPerLap) };
  const role = jumpRole(jump, newest);
  if (role !== undefined) row.role = role;
  return row;
}

/** Joins the damage state into the card's texts: parts, corners, faults, jumps (newest first) and the compact view. */
export function damageRows(state: DamageState): DamageRows {
  const p = state.parts;
  const part = (key: keyof DamageParts): CellPart => knownPart(p, (parts) => formatPct(parts[key]));
  const corner = (c: DamageState['corners']['fl']) => ({ tyre: cell(c.tyrePct), brake: cell(c.brakePct) });
  const faults = [
    ...(state.drsFault.known && state.drsFault.value ? [text.faults.drs] : []),
    ...(state.ersFault ? [text.faults.ers] : []),
  ];
  const jumps = [...state.jumps].sort((a, b) => b.at - a.at).map((j, i) => jumpRow(j, i === 0));
  const n = (key: keyof DamageParts): string => (p.known ? formatCount(p.value[key]) : '');
  const line = p.known
    ? text.compactParts({
        wings: [n('frontLeftWingPct'), n('frontRightWingPct'), n('rearWingPct')],
        floor: n('floorPct'), diffuser: n('diffuserPct'), sidepod: n('sidepodPct'), gearbox: n('gearboxPct'), engine: n('enginePct'),
      })
    : '';
  return {
    parts: {
      wingL: part('frontLeftWingPct'), wingR: part('frontRightWingPct'), wingRear: part('rearWingPct'), floor: part('floorPct'),
      diffuser: part('diffuserPct'), sidepod: part('sidepodPct'), gearbox: part('gearboxPct'), engine: part('enginePct'),
    },
    corners: { fl: corner(state.corners.fl), fr: corner(state.corners.fr), rl: corner(state.corners.rl), rr: corner(state.corners.rr) },
    faults,
    jumps,
    compact: { parts: line, ...(jumps[0] ? { jump: jumps[0] } : {}) },
  };
}
