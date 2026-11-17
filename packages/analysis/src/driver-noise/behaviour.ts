// What `driver-noise` does per situation (contract C14, C43, C44): one row per kind of every sub-machine it reads. The
// machine decided the weekend phase, who drives a car and whether it still competes; the as-of form only looks up the
// rows of the spans a lap or the view's frame belongs to.
import type { MachineId, WeekendPhase } from '@pitwall/domain';
import type { AsOfView, DeepReadonly } from '@pitwall/engine/readers';
import { lapPhaseRowOf, RACE_LAP_PHASE_ROWS } from '../lap-classes/index.ts';
import type { BehaviourTable } from '../shared/behaviour.ts';

/** What a span says about a car's noise model. */
export type DriverNoiseEffect = {
  /** The weekend phase is the race (spec 5.2): outside it every value is `notApplicable`. */
  isRace?: boolean;
  /** Which model a lap counts for: the car-driver span it belongs to (C26). */
  model?: 'ai' | 'human';
  /** The car is in the session (car-status not `absent`): it has an entry. */
  inSession?: boolean;
  /** A car-status span that is a retirement (plan review P5: apart from big slow laps). */
  retirement?: boolean;
  /**
   * A session-phase or car-location span during which a mini-sector is no human time loss: a neutralisation, a pit
   * visit, a garage spell. The rule is the shared one (`timeLossExcludedOf`, `shared/neutralised.ts`); these rows say
   * what it gives for each kind the unit reads.
   */
  noTimeLoss?: boolean;
  /**
   * The ended qualifying session's planning view (C62d): the models give values for the race to come, a human's from the
   * session's laps (as non-race laps) towards its prior, an AI car's and the AI field's the config's AI values.
   */
  planning?: boolean;
};

const COUNTS: DriverNoiseEffect = { noTimeLoss: false };
const NO_TIME_LOSS: DriverNoiseEffect = { noTimeLoss: true };

export const DRIVER_NOISE_BEHAVIOUR: BehaviourTable<DriverNoiseEffect> = {
  'weekend-phase': { ...RACE_LAP_PHASE_ROWS, qualifying: { ...RACE_LAP_PHASE_ROWS.qualifying, planning: true } },
  'car-driver': { ai: { model: 'ai' }, human: { model: 'human' } },
  'car-status': {
    competing: { inSession: true, retirement: false },
    retired: { inSession: true, retirement: true },
    disqualified: { inSession: true, retirement: false },
    absent: { inSession: false, retirement: false },
  },
  'car-location': { track: COUNTS, pitLane: NO_TIME_LOSS, garage: NO_TIME_LOSS },
  'session-phase-race': {
    grid: COUNTS,
    formation: COUNTS,
    startLights: COUNTS,
    racing: COUNTS,
    neutralised: NO_TIME_LOSS,
    suspended: NO_TIME_LOSS,
    finished: COUNTS,
    postSession: COUNTS,
  },
};

/** The row of `machine`'s span kind `kind`; a kind without a row is a bug in the table (C3): it throws. */
export function rowOf(machine: MachineId, kind: string): DriverNoiseEffect {
  const byKind = DRIVER_NOISE_BEHAVIOUR[machine];
  if (byKind === undefined || !Object.hasOwn(byKind, kind)) throw new Error(`behaviour table: no row for ${machine} ${kind}`);
  return byKind[kind] as DriverNoiseEffect;
}

/**
 * Whether the view's frame lies in the race: the rows of the open weekend-phase spans; without one (a pending phase, or
 * a stored session, whose spans are all closed) the row of the situation's weekend phase, a pending one the race's (C14).
 */
export function isRaceAt(view: Pick<AsOfView, 'situation'>): boolean {
  return phaseRowsAt(view).every((row) => row.isRace === true);
}

/** Whether the view's frame lies in qualifying, read as the race's planning view (C62d): its weekend-phase rows, as `isRaceAt`. */
export function isPlanningAt(view: Pick<AsOfView, 'situation'>): boolean {
  return phaseRowsAt(view).every((row) => row.planning === true);
}

/** The weekend-phase rows at the view's frame: the open spans', else the situation's weekend phase's (C14). */
function phaseRowsAt(view: Pick<AsOfView, 'situation'>): DriverNoiseEffect[] {
  const open = view.situation.byMachine['weekend-phase'] ?? [];
  if (open.length > 0) return open.map((s) => rowOf('weekend-phase', s.kind));
  const phase: DeepReadonly<WeekendPhase> = view.situation.weekendPhase;
  return [phase.kind === 'pending' ? lapPhaseRowOf(RACE_LAP_PHASE_ROWS, phase.kind) : rowOf('weekend-phase', phase.kind)];
}
