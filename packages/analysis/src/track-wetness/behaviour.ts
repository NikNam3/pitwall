// What `track-wetness` does per situation (contract C14, C43, C44): one row per kind of every sub-machine it reads. The
// machine decided the weekend phase and the session phase; the as-of form only looks up the rows of the spans open at
// its frame. Neutralised laps are no pace laps already (`degradation`'s lap use), so no row needs to drop them.
import type { MachineId } from '@pitwall/domain';
import type { AsOfView } from '@pitwall/engine/readers';
import { lapPhaseRowOf, RACE_LAP_PHASE_ROWS } from '../lap-classes/index.ts';
import type { BehaviourTable } from '../shared/behaviour.ts';

/** What the session's open spans say about the wetness. */
export type TrackWetnessEffect = {
  /** The weekend phase is the race (spec 5.1): outside it the output is `notApplicable`. */
  isRace?: boolean;
  /** The race has started (lights out): before it no lap is a racing lap, so there is nothing to measure. */
  started?: boolean;
  /**
   * The ended qualifying session's planning view (C62d): the race's wetness at its start from the race's forecast, the
   * per-lap data over the session's own laps.
   */
  planning?: boolean;
};

const BEFORE_START: TrackWetnessEffect = { started: false };
const STARTED: TrackWetnessEffect = { started: true };

export const TRACK_WETNESS_BEHAVIOUR: BehaviourTable<TrackWetnessEffect> = {
  'weekend-phase': { ...RACE_LAP_PHASE_ROWS, qualifying: { isRace: false, planning: true } },
  'session-phase-race': {
    grid: BEFORE_START,
    formation: BEFORE_START,
    startLights: BEFORE_START,
    racing: STARTED,
    neutralised: STARTED,
    suspended: STARTED,
    finished: STARTED,
    postSession: STARTED,
  },
};

/** Before any span: a pending weekend phase reads as the race's grid (C14, `lapPhaseRowOf`). */
const PENDING: TrackWetnessEffect = { ...lapPhaseRowOf(RACE_LAP_PHASE_ROWS, 'pending'), ...BEFORE_START };

/**
 * The session's effect at `view`'s frame: the rows of the open spans of the table's machines (C20), over the grid's.
 * A span whose kind has no row is a bug in the table (C3): it throws.
 */
export function sessionEffect(view: Pick<AsOfView, 'situation'>): TrackWetnessEffect {
  const effect: TrackWetnessEffect = { ...PENDING };
  for (const [machine, byKind] of Object.entries(TRACK_WETNESS_BEHAVIOUR)) {
    for (const span of view.situation.byMachine[machine as MachineId] ?? []) {
      if (!Object.hasOwn(byKind, span.kind)) throw new Error(`behaviour table: no row for ${machine} ${span.kind}`);
      Object.assign(effect, byKind[span.kind]);
    }
  }
  return effect;
}
