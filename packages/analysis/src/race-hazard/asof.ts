// `race-hazard` as of a frame (SP4.3b spec §5.2): a pure function of the `AsOfView`, for `forecast-score` and the jobs.
// Per remaining lap the chance an SC and a VSC starts on it: lap 1 from the track's `lapOne`, lap n ≥ 2 from the first
// `byFraction` bin whose `upTo` is at or above (n − 0.5) / totalLaps (ruling R22), times the lobby factor. No start while
// a neutralisation is out and on the lap after it ends: under an open one the current lap and the next are 0 and a later
// lap's chance is the table's times the chance it has ended at least one lap before (its laps-left pmf).
import { known, unknown, type FrameNumber, type MachineId, type OpenSpan, type RaceHazard, type Span, type TrackHazard } from '@pitwall/domain';
import type { AsOfView, DeepReadonly } from '@pitwall/engine/readers';
import { GAPS, leaderLapAt, type GapsOutput } from '../gaps/index.ts';
import { isEnding, lastNeutralisation, openNeutralisation } from '../shared/neutralised.ts';
import { rowOf, type RaceHazardEffect } from './behaviour.ts';
import { RACE_HAZARD_CONFIG } from './config.ts';

const PHASES: MachineId = 'session-phase-race';

type Value = Extract<RaceHazard, { known: true }>['value'];

/** The table's start chances of lap `lap` of a `total`-lap race (ruling R22); the last bin past a malformed table. */
function chancesOn(hazard: DeepReadonly<TrackHazard>, lap: number, total: number): { sc: number; vsc: number } {
  if (lap === 1) return hazard.lapOne;
  const fraction = (lap - 0.5) / total;
  return hazard.byFraction.find((b) => b.upTo >= fraction) ?? hazard.byFraction.at(-1) ?? { sc: 0, vsc: 0 };
}

/** The pmf of the laps left (index 0 = it ends this lap) of a neutralisation with duration pmf `pmf` that has run `run` laps. */
function lapsLeft(pmf: readonly number[], run: number, returning: boolean): number[] {
  if (returning) return [1];
  const rest = pmf.slice(run);
  const total = rest.reduce((s, p) => s + p, 0);
  // past its longest duration: it ends this lap
  return total > 0 ? rest.map((p) => p / total) : [1];
}

/**
 * The leader's completed laps (`gaps`' judgement, SP4.3c Task 6, C43): `done` now (`leaderProgress`), `doneAtStart` at
 * the open neutralisation's start, `doneBeforeEnd` before the last closed one's end (its phase on `gaps`' x, the
 * leader's progress there: the laps completed by the start, before the end). All three from one source, so a race the
 * engine joined (no lap record before the join) counts them alike. A view without `gaps`' output (an as-of build), or
 * a value `gaps` has not (before the leader's first crossing; a phase it does not list), takes the as-of form of the
 * same judgement, `leaderLapAt` over the projection's laps.
 */
function leaderLaps(
  view: AsOfView,
  open: DeepReadonly<OpenSpan> | undefined,
  last: DeepReadonly<Span> | null,
): { done: number; doneAtStart: number; doneBeforeEnd: number } {
  const gaps = view.outputs.get(GAPS) as DeepReadonly<GapsOutput> | undefined;
  const laps = view.history.laps;
  const progress = gaps?.leaderProgress;
  const done = progress?.known === true ? progress.value.lap - 1 : leaderLapAt(laps, Infinity as FrameNumber) - 1;
  const phases = gaps?.phases ?? [];
  const openPhase = gaps === undefined ? undefined : phases.find((p) => p.kind !== 'red' && !p.toLap.known);
  const lastPhase = gaps === undefined || last === null ? undefined : phases.find((p) => p.kind !== 'red' && p.toLap.known && p.toLap.at === last.end);
  const doneAtStart =
    open === undefined ? 0
    : openPhase !== undefined ? Math.floor(openPhase.fromLap)
    : leaderLapAt(laps, open.startFrame) - 1;
  const doneBeforeEnd =
    last === null ? 0
    : lastPhase?.toLap.known === true ? Math.ceil(lastPhase.toLap.value) - 1
    : leaderLapAt(laps, (last.endFrame - 1) as FrameNumber) - 1;
  return { done, doneAtStart, doneBeforeEnd };
}

/** The remaining race's SC and VSC chances per lap, their durations and the one out now, as of `view`'s frame. */
export function raceHazardAsOf(view: AsOfView): RaceHazard {
  const notApplicable = unknown('notApplicable');
  const weekendPhase = view.situation.weekendPhase.kind;
  if (weekendPhase === 'pending' || rowOf('weekend-phase', weekendPhase) === 'notApplicable') return notApplicable;
  const track = view.track;
  if (!track.known || !track.value.defaults.hazard.known) return notApplicable;
  const hazard = track.value.defaults.hazard.value.value;

  // one open span per session-scoped machine (C15); none yet reads as on the grid (C14)
  const open = (view.situation.byMachine[PHASES] ?? [])[0];
  const effect: RaceHazardEffect = open === undefined ? 'fromLapOne' : rowOf(PHASES, open.kind);
  if (effect === 'notApplicable') return notApplicable;

  const totalLaps = view.fixed.totalLaps;
  if (!totalLaps.known || totalLaps.value <= 0) return unknown('insufficientData');
  const total = totalLaps.value;
  const lobby = view.fixed.safetyCar ?? unknown('notReceived');
  if (!lobby.known) return unknown('insufficientData');
  const config = RACE_HAZARD_CONFIG.read(view);
  const lobbyFactor = { off: 0, reduced: config.reducedFactor, standard: 1, increased: config.increasedFactor }[lobby.value];

  // the last closed SC or VSC, confirmed only (C18, C20: closed spans in the projection)
  const lastNeutralised = lastNeutralisation(view.history, view.situation, ['SC', 'VSC']);

  // the SC or VSC out now (a row `active`), from the one owner of the neutralisation kind
  const now = effect === 'active' ? openNeutralisation(view) : null;
  const activeSpan = now !== null && now.kind !== 'red' ? now.span : undefined;
  const activeCondition = now?.kind === 'SC' ? 'sc' : now?.kind === 'VSC' ? 'vsc' : undefined;
  const { done, doneAtStart, doneBeforeEnd } = leaderLaps(view, activeSpan, lastNeutralised);
  const current = effect === 'fromLapOne' ? 1 : done + 1;
  // the last closed one ended in lap `doneBeforeEnd + 1`: no start then or on the lap after
  const blockedThrough = lastNeutralised === null ? 0 : doneBeforeEnd + 2;

  let active: Value['active'] = null;
  if (activeSpan !== undefined && activeCondition !== undefined) {
    active = { condition: activeCondition, remainingLaps: lapsLeft(hazard.durationLaps[activeCondition], done - doneAtStart, isEnding(activeSpan)) };
  }

  const byLap: Value['byLap'] = [];
  // under an open neutralisation: the chance it has ended by lap `current + k`, k = 0, 1, …
  let endedBy = 0;
  for (let lap = current; lap <= total; lap++) {
    let allowed = 1;
    if (lap <= blockedThrough) allowed = 0;
    else if (active !== null) {
      // a start on `lap` needs it ended by `lap − 2`
      const k = lap - 2 - current;
      if (k >= 0) endedBy += active.remainingLaps[k] ?? 0;
      // past its longest duration it has ended for certain (no rounding below 1)
      allowed = k < 0 ? 0 : k >= active.remainingLaps.length - 1 ? 1 : Math.min(1, endedBy);
    }
    const chances = chancesOn(hazard, lap, total);
    byLap.push({ lap, sc: lobbyFactor * chances.sc * allowed, vsc: lobbyFactor * chances.vsc * allowed });
  }

  return known(
    { byLap, durationLaps: { sc: [...hazard.durationLaps.sc], vsc: [...hazard.durationLaps.vsc] }, active, lobbyFactor },
    view.at,
  );
}
