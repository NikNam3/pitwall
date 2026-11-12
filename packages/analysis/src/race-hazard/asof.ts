// `race-hazard` as of a frame (SP4.3b spec §5.2): a pure function of the `AsOfView`, for `forecast-score` and the jobs.
// Per remaining lap the chance an SC and a VSC starts on it: lap 1 from the track's `lapOne`, lap n ≥ 2 from the first
// `byFraction` bin whose `upTo` is at or above (n − 0.5) / totalLaps (ruling R22), times the lobby factor. No start while
// a neutralisation is out and on the lap after it ends: under an open one the current lap and the next are 0 and a later
// lap's chance is the table's times the chance it has ended at least one lap before (its laps-left pmf).
import { known, unknown, type MachineId, type NeutralisedDetail, type RaceHazard, type TrackHazard } from '@pitwall/domain';
import type { AsOfView, DeepReadonly } from '@pitwall/engine/readers';
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
 * The leader's completed laps (the most of a lap record with `positionAtEnd` 1): `done` now, `doneAtStart` at frame
 * `startFrame` (its records on or before it), `doneBeforeEnd` before frame `endFrame`. Only the newest laps matter: a
 * start more than `maxRun` laps back has run past every duration, an end before the leader's previous lap blocks no
 * lap left. So the list is read from its end, back to one lap past those (the margin for a confirmed lap appended after
 * the next lap's record); a value further back is `-Infinity` (0 when the whole list was read). Reading the whole
 * projection's laps per run would grow with the race.
 */
function leaderLaps(
  laps: AsOfView['history']['laps'],
  startFrame: number | undefined,
  endFrame: number | undefined,
  maxRun: number,
): { done: number; doneAtStart: number; doneBeforeEnd: number } {
  let done = 0;
  let doneAtStart = -Infinity;
  let doneBeforeEnd = -Infinity;
  let i = laps.length - 1;
  for (; i >= 0; i--) {
    const lap = laps[i];
    if (lap === undefined || lap.positionAtEnd !== 1) continue;
    if (lap.lapNumber < done - Math.max(1, maxRun) - 1) break;
    if (lap.lapNumber > done) done = lap.lapNumber;
    if (startFrame !== undefined && lap.frame <= startFrame && lap.lapNumber > doneAtStart) doneAtStart = lap.lapNumber;
    if (endFrame !== undefined && lap.frame < endFrame && lap.lapNumber > doneBeforeEnd) doneBeforeEnd = lap.lapNumber;
  }
  if (i < 0) {
    doneAtStart = Math.max(doneAtStart, 0);
    doneBeforeEnd = Math.max(doneBeforeEnd, 0);
  }
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

  // the last closed neutralisation (C20: closed spans in the projection)
  const closed = view.history.spans[PHASES] ?? [];
  const lastNeutralised = closed.findLast((s) => s.kind === 'neutralised');

  const activeSpan = effect === 'active' ? open : undefined;
  const activeDetail = activeSpan?.detail as DeepReadonly<NeutralisedDetail> | undefined;
  const activeCondition = activeDetail === undefined ? undefined : activeDetail.car === 'SC' ? 'sc' : 'vsc';
  const { done, doneAtStart, doneBeforeEnd } = leaderLaps(
    view.history.laps,
    activeSpan?.startFrame,
    lastNeutralised?.endFrame,
    activeCondition === undefined ? 0 : hazard.durationLaps[activeCondition].length,
  );
  const current = effect === 'fromLapOne' ? 1 : done + 1;
  // the last closed one ended in lap `doneBeforeEnd + 1`: no start then or on the lap after
  const blockedThrough = lastNeutralised === undefined ? 0 : doneBeforeEnd + 2;

  let active: Value['active'] = null;
  if (activeDetail !== undefined && activeCondition !== undefined) {
    const returning = activeDetail.stages.some((s) => s.stage !== 'deployed');
    active = { condition: activeCondition, remainingLaps: lapsLeft(hazard.durationLaps[activeCondition], done - doneAtStart, returning) };
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
