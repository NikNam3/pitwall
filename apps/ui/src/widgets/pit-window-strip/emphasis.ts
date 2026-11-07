// The pit-window strip's emphasis (C68; SP4.2 spec §4): colour only to highlight. A window open now is white bold (the
// own-car role), a closed one faint, tyres at or past their limit amber. The window state is `pit-window`'s (C43).
import type { PitWindowState } from '@pitwall/domain';
import type { Role } from '../../theme/roles.ts';

export type Emphasis = { role: Role; bold: boolean };

const PLAIN: Emphasis = { role: 'text', bold: false };

/** The laps of a window by `pit-window`'s state: open now white bold, closed faint, else the text colour. */
export function windowEmphasis(state: PitWindowState): Emphasis {
  if (state === 'open') return { role: 'ownCar', bold: true };
  if (state === 'closed') return { role: 'textFaint', bold: false };
  return PLAIN;
}

/** The band of a window: open white, closed faint, else dim. */
export function bandRole(state: PitWindowState): Role {
  if (state === 'open') return 'ownCar';
  if (state === 'closed') return 'textFaint';
  return 'textDim';
}

/** The fitted set's last lap: amber bold once the window is closed with the tyres at or past their limit. */
export function lastLapEmphasis(state: PitWindowState, latest: number, currentLap: number): Emphasis {
  return state === 'closed' && latest <= currentLap ? { role: 'warning', bold: true } : PLAIN;
}
