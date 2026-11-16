// The plan board's presentation table (contract C66): every kind of `session-phase-race` to whether the board offers its
// actions (save to a slot, activate, edit, remove). Once the race is finished a plan changes nothing: the rows stay, the
// actions are hidden. The machine decided the situation (C43); the display only maps it.
import type { MachineSpans } from '@pitwall/contracts';
import type { sessionPhaseRaceSpans } from '@pitwall/domain';
import type { PresentationTable } from '../../kit/presentation.ts';
import { openSpanOf } from '../../kit/situation.ts';

type SessionPhaseRaceKind = (typeof sessionPhaseRaceSpans.kinds)[number];

/** A kind's row: whether the board's buttons are drawn. */
export type PhaseRow = { readonly actions: 'shown' | 'hidden' };

export const presentation = {
  situations: {
    'session-phase-race': {
      grid: { actions: 'shown' },
      formation: { actions: 'shown' },
      startLights: { actions: 'shown' },
      racing: { actions: 'shown' },
      neutralised: { actions: 'shown' },
      suspended: { actions: 'shown' },
      finished: { actions: 'hidden' },
      postSession: { actions: 'hidden' },
    },
  },
} as const satisfies PresentationTable & { situations: { 'session-phase-race': Readonly<Record<SessionPhaseRaceKind, PhaseRow>> } };

/** Whether the board offers its actions: the open span's row; shown without an open span or without the topic. */
export function actionsShown(spans: MachineSpans | undefined): boolean {
  const span = openSpanOf(spans);
  if (span === undefined) return true;
  const rows: Readonly<Record<string, PhaseRow>> = presentation.situations['session-phase-race'];
  return rows[span.kind]?.actions !== 'hidden';
}
