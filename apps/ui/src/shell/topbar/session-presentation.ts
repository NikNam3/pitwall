// The top bar's session presentation table (contract C66): the weekend phase's open span (`situation.weekendPhase`) ->
// the session's name and how its clock reads. Pure; the machine decided the phase, this only maps it. A sprint shootout
// is qualifying with its format; `none` (a time trial or an unknown session type) has no name and no time limit, so its
// clock counts up.
import type { OpenSpan, QualifyingFormat, SessionKind, weekendPhaseSpans } from '@pitwall/domain';

type PhaseKind = (typeof weekendPhaseSpans)['kinds'][number];
/** `name`: the session kind `formatSessionKind` names (`undefined`: none); `clock`: the time left, or the session time counting up. */
type Row = { name: SessionKind | 'byQualifyingFormat' | undefined; clock: 'timeLeft' | 'countsUp' };

const SPRINT_SHOOTOUT: ReadonlySet<QualifyingFormat> = new Set<QualifyingFormat>(['sprintShootout', 'shortSprintShootout', 'oneShotSprintShootout']);

export const sessionPresentation = {
  'weekend-phase': {
    practice: { name: 'practice', clock: 'timeLeft' },
    qualifying: { name: 'byQualifyingFormat', clock: 'timeLeft' },
    race: { name: 'race', clock: 'timeLeft' },
    none: { name: undefined, clock: 'countsUp' },
  },
} as const satisfies { 'weekend-phase': Record<PhaseKind, Row> };

/** The session's name and clock by the weekend phase's open span; `undefined` while the phase is pending (no open span). */
export function sessionOf(span: OpenSpan | undefined): { name: SessionKind | undefined; clock: Row['clock'] } | undefined {
  if (span === undefined) return undefined;
  const row: Row | undefined = (sessionPresentation['weekend-phase'] as Record<string, Row>)[span.kind];
  if (row === undefined) return undefined;
  if (row.name !== 'byQualifyingFormat') return { name: row.name, clock: row.clock };
  const format = (span.detail as { format?: QualifyingFormat } | undefined)?.format;
  return { name: format !== undefined && SPRINT_SHOOTOUT.has(format) ? 'sprintShootout' : 'qualifying', clock: row.clock };
}
