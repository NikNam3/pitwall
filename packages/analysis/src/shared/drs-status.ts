// Race control's DRS status from the history's DRSE and DRSD events, shared by battle and race-moment.
import type { DrsOffReason, DrsStatus, RaceEvent, SessionKind } from '@pitwall/domain';

/** The DRSD reasons the engine maps; any other reason, or none, is `unknown`. */
const DRSD_REASONS: ReadonlySet<unknown> = new Set<DrsOffReason>(['wetTrack', 'safetyCar', 'redFlag', 'minLapNotReached']);

const ENABLED: DrsStatus = { enabled: true };

/**
 * Whether race control allows DRS now: the newest `drsEnabled` or `drsDisabled` in the history wins. Without either a
 * race is off until its first DRSE (`notEnabledYet`); any other session is enabled (practice and qualifying send neither).
 */
export function drsStatus(state: {
  session: { kind: SessionKind };
  history: { events: readonly Pick<RaceEvent, 'kind' | 'params'>[] };
}): DrsStatus {
  const newest = state.history.events.findLast((e) => e.kind === 'drsEnabled' || e.kind === 'drsDisabled');
  if (newest === undefined) return state.session.kind === 'race' ? { enabled: false, reason: 'notEnabledYet' } : ENABLED;
  if (newest.kind === 'drsEnabled') return ENABLED;
  const { reason } = newest.params;
  return { enabled: false, reason: DRSD_REASONS.has(reason) ? (reason as DrsOffReason) : 'unknown' };
}
