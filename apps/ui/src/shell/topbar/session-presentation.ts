// The top bar's session presentation table (contract C66): the weekend phase's open span (`situation.weekendPhase`) ->
// whether the session shows a name and how its clock reads. Pure; the machine decided the phase, this only maps it; the
// name is the kit's `formatWeekendPhase` of the phase and its format (a sprint shootout is qualifying with its format,
// a sprint the race with format `sprint`). `none` (a time trial or an unknown session type) has no name and no time
// limit, so its clock counts up.
import type { OpenSpan, WeekendPhase, weekendPhaseSpans } from '@pitwall/domain';
import { formatWeekendPhase } from '../../kit/values/format.ts';

type PhaseKind = (typeof weekendPhaseSpans)['kinds'][number];
/** `named`: the session shows its phase's name; `clock`: the time left, or the session time counting up. */
type Row = { named: boolean; clock: 'timeLeft' | 'countsUp' };

export const sessionPresentation = {
  'weekend-phase': {
    practice: { named: true, clock: 'timeLeft' },
    qualifying: { named: true, clock: 'timeLeft' },
    race: { named: true, clock: 'timeLeft' },
    none: { named: false, clock: 'countsUp' },
  },
} as const satisfies { 'weekend-phase': Record<PhaseKind, Row> };

/** The session's name and clock by the weekend phase's open span; `undefined` while the phase is pending (no open span). */
export function sessionOf(span: OpenSpan | undefined): { name: string | undefined; clock: Row['clock'] } | undefined {
  if (span === undefined) return undefined;
  const row: Row | undefined = (sessionPresentation['weekend-phase'] as Record<string, Row>)[span.kind];
  if (row === undefined) return undefined;
  if (!row.named) return { name: undefined, clock: row.clock };
  // The top bar names the phase, not its segment.
  const phase = { kind: span.kind, ...(span.detail as object | undefined), segment: undefined } as WeekendPhase;
  return { name: formatWeekendPhase(phase), clock: row.clock };
}
