// The crossing order's presentation table (contract C66; SP4.2 spec §4): every kind of `session-phase-race` to the
// condition that is out. Only `neutralised` names one: its span's `detail.car` (SC or VSC).
import type { sessionPhaseRaceSpans } from '@pitwall/domain';
import type { PresentationTable } from '../../kit/presentation.ts';

type PhaseKind = (typeof sessionPhaseRaceSpans)['kinds'][number];

/** A session phase's row: `span` = the condition that is out is the span's `detail.car`; `none` = none is out. */
export type PhaseRow = { readonly active: 'span' | 'none' };

export const presentation: PresentationTable & { situations: { 'session-phase-race': Readonly<Record<PhaseKind, PhaseRow>> } } = {
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
};
