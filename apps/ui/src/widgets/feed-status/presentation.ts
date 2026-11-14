// Feed status's presentation table (contract C66): the weekend phase's kind (`situation.weekendPhase`) to whether its
// session line names the session beside the track; the name is the kit's `formatWeekendPhase` of the phase and its
// detail's format (a sprint shootout, its short and one-shot variants included, reads "sprint shootout", the race with
// format `sprint` "sprint"). `none` (a time trial or an unknown session type) shows no name.
import type { OpenSpan, WeekendPhase, weekendPhaseSpans } from '@pitwall/domain';
import type { PresentationTable } from '../../kit/presentation.ts';
import { formatWeekendPhase } from '../../kit/values/format.ts';

type PhaseKind = (typeof weekendPhaseSpans)['kinds'][number];

/** A weekend phase's row: whether the session line names the session. */
export type PhaseRow = { readonly named: boolean };

type FeedTable = PresentationTable & { situations: { 'weekend-phase': Readonly<Record<PhaseKind, PhaseRow>> } };

export const presentation: FeedTable = {
  situations: {
    'weekend-phase': {
      practice: { named: true },
      qualifying: { named: true },
      race: { named: true },
      none: { named: false },
    },
  },
};

/** The session's name from the weekend phase's open span; none while the phase is pending (no open span) or the topic has no value. */
export function phaseLabel(span: OpenSpan | undefined): string | undefined {
  if (span === undefined) return undefined;
  const row: PhaseRow | undefined = presentation.situations['weekend-phase'][span.kind as PhaseKind];
  const detail = span.detail as { format?: string } | undefined;
  if (row?.named !== true || detail?.format === undefined) return undefined;
  // The session line names the phase, not its segment.
  return formatWeekendPhase({ kind: span.kind, ...detail, segment: undefined } as WeekendPhase);
}
