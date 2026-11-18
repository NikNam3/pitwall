// The plan board's presentation table (contract C66): every kind of `session-phase-race` to whether the board offers its
// actions (save to a slot, activate, edit, remove). Once the race is finished a plan changes nothing: the rows stay, the
// actions are hidden. The machine decided the situation (C43); the display only maps it. The planning round's state
// (open, closed) to the variant `source: auto` draws (SP4.3d2 Task 12).
import type { MachineSpans, PlanningRoundState } from '@pitwall/contracts';
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
  // SP4.3d2 Task 12: the planning round's state (`plans.prepared.open`) to the board's variant under `source: auto`.
  round: {
    open: { variant: 'planning' },
    closed: { variant: 'live' },
  },
} as const satisfies PresentationTable & {
  situations: { 'session-phase-race': Readonly<Record<SessionPhaseRaceKind, PhaseRow>> };
  round: Readonly<Record<'open' | 'closed', RoundRow>>;
};

/** Where the board's rows come from: the race's strategy job or the planning round's job. */
export type Variant = 'live' | 'planning';
/** A round state's row: the variant `auto` draws. */
export type RoundRow = { readonly variant: Variant };

/**
 * The variant: `live` and `planning` as chosen; `auto` the round state's row (closed without the topic's value). A
 * source not set (the panel without options) is `auto`, the declaration's default.
 */
export function variantOf(source: 'auto' | Variant | undefined, prepared: PlanningRoundState | undefined): Variant {
  if (source !== undefined && source !== 'auto') return source;
  return presentation.round[prepared?.open === true ? 'open' : 'closed'].variant;
}

/** Whether the board offers its actions: the open span's row; shown without an open span or without the topic. */
export function actionsShown(spans: MachineSpans | undefined): boolean {
  const span = openSpanOf(spans);
  if (span === undefined) return true;
  const rows: Readonly<Record<string, PhaseRow>> = presentation.situations['session-phase-race'];
  return rows[span.kind]?.actions !== 'hidden';
}
