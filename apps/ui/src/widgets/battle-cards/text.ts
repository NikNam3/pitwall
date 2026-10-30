// Wording specific to this display; text shared with the kit and shell lives in kit/text.ts.
import type { DrsOffReason } from '@pitwall/domain';

export const ahead = 'AHEAD' as const;
export const behind = 'BEHIND' as const;
export const inDrs = 'in DRS';
/** TO DRS while race control has DRS off; the title gives its reason. */
export const drsOff = 'DRS off';
export const drsOffTitle = {
  notEnabledYet: 'DRS off: not enabled yet',
  wetTrack: 'DRS off: wet track',
  safetyCar: 'DRS off: safety car',
  redFlag: 'DRS off: red flag',
  minLapNotReached: 'DRS off: minimum laps not reached',
  unknown: 'DRS off: reason unknown',
} as const satisfies Record<DrsOffReason, string>;
/** The column headers. */
export const header = {
  drv: 'DRV',
  gap: 'GAP',
  closing: 'CLOSING',
  toDrs: 'TO DRS',
  paceDelta: 'PACE Δ',
  margin: 'MARGIN',
  tyres: 'TYRES',
  ers: 'ERS',
} as const;
