import type { Corners, DamageJump, DamageParts, DamageState, Known, UnknownReason } from '@pitwall/domain';
import { formatCount, formatDeltaPct, formatLapNumber, formatPct, formatSecondsPerLap } from '../../kit/values/format.ts';
import { insightText } from '../../kit/text.ts';
import type { Role } from '../../theme/roles.ts';
import { jumpRole } from './emphasis.ts';
import * as text from './text.ts';

/** One shown value: its text, or an empty text with the reason it is hidden. */
export type Cell = { text: string; reason?: UnknownReason };

/** One listed damage jump. */
export type JumpRow = { text: string; loss: string; role?: Role; reason?: UnknownReason };

/** What the damage card shows. */
export type DamageRows = {
  parts: Record<'wingL' | 'wingR' | 'wingRear' | 'floor' | 'diffuser' | 'sidepod' | 'gearbox' | 'engine', Cell>;
  corners: Corners<{ tyre: Cell; brake: Cell }>;
  faults: string[];
  jumps: JumpRow[];
  compact: { parts: string; jump?: JumpRow };
};

const cell = (k: Known<number>): Cell => (k.known ? { text: formatPct(k.value) } : { text: '', reason: k.reason });

function jumpRow(jump: DamageJump, newest: boolean): JumpRow {
  const parts = jump.parts.map((p) => insightText.part[p] ?? p).join(text.partSeparator);
  const row: JumpRow = { text: `${formatLapNumber(jump.lap, 2)} ${parts} ${formatDeltaPct(jump.deltaPct)}`, loss: '' };
  const loss = jump.lossMsPerLap;
  if (loss.known) row.loss = text.lossMeasured(formatSecondsPerLap(loss.value));
  else if (loss.reason === 'insufficientData') row.loss = text.lossMeasuring;
  else row.reason = loss.reason;
  const role = jumpRole(jump, newest);
  if (role !== undefined) row.role = role;
  return row;
}

/** Joins the damage state into the card's texts: parts, corners, faults, jumps (newest first) and the compact view. */
export function damageRows(state: DamageState): DamageRows {
  const p = state.parts;
  const part = (key: keyof DamageParts): Cell => (p.known ? cell({ ...p, value: p.value[key] }) : { text: '', reason: p.reason });
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
