// The sc-card's presentation table (contract C66): every kind of `session-phase-race` to whether the span names the
// condition that is out. Only `neutralised` does, through its `detail.car`. The machine decided the situation (C43).
import type { MachineSpans } from '@pitwall/contracts';
import type { NeutralisedDetail, sessionPhaseRaceSpans } from '@pitwall/domain';
import type { PresentationTable } from '../../kit/presentation.ts';
import { openSpanOf } from '../../kit/situation.ts';
import type { Condition } from './rows.ts';

type SessionPhaseRaceKind = (typeof sessionPhaseRaceSpans.kinds)[number];

/** A kind's row: `span` names the condition of the span's `detail.car`; `none` names none. */
export type PhaseRow = { readonly active: 'span' | 'none' };

export const presentation = {
  situations: {
    'session-phase-race': {
      grid: { active: 'none' },
      formation: { active: 'none' },
      startLights: { active: 'none' },
      racing: { active: 'none' },
      neutralised: { active: 'span' },
      suspended: { active: 'none' },
      finished: { active: 'none' },
      postSession: { active: 'none' },
    },
  },
} as const satisfies PresentationTable & { situations: { 'session-phase-race': Readonly<Record<SessionPhaseRaceKind, PhaseRow>> } };

const CONDITION_OF = { SC: 'sc', VSC: 'vsc' } as const satisfies Record<NeutralisedDetail['car'], Condition>;

/** The condition the session's open span names through its row; `undefined` for a `none` row, no span or no topic value. */
export function activeCondition(spans: MachineSpans | undefined): Condition | undefined {
  const span = openSpanOf(spans);
  if (span === undefined) return undefined;
  const rows: Readonly<Record<string, PhaseRow>> = presentation.situations['session-phase-race'];
  if (rows[span.kind]?.active !== 'span') return undefined;
  return CONDITION_OF[(span.detail as NeutralisedDetail).car];
}
