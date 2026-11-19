// The planning round's replay (C62d, C61; SP4.3e spec §4.3 "PlanningRunner", SP4.3f spec §4.1–4.3): it runs in the rebuild
// service's worker thread (`cli/rebuild-worker.ts`), never on the thread that applies frames. It replays a qualifying's
// recording in its own engine instance to its end, as `pitwall reprocess` runs it (C38: its sidecars), with the practice
// basis given in place of the recording's basis and its `basisChosen` decisions and the round's profile snapshot in place
// of the recording's profiles sidecar (C62c), stores nothing, and builds the planning job's input on the run as of its
// end (`asOfEnded`, `planningInputFrom`) for the race assumptions, their conditions in place of the qualifying's race
// samples (`effectiveForecast`); the round's slots are the main thread's (`runner.ts`), so the input carries none. It
// hands back the race samples the qualifying held at its end (`imported`) and its own temperatures then (`atEnd`), from
// which the main thread shows the round's forecast rows. The basis's sessions are read from the bridge's database, read only.
import { planningInputFrom, type StrategyInput } from '@pitwall/analysis';
import type { CarKey, ForecastSample, RaceAssumptions } from '@pitwall/domain';
import { asOfEnded, type BasisContext } from '@pitwall/engine/readers';
import type { FeatureConfig } from '../feature-config.ts';
import { FEATURES } from '../features/index.generated.ts';
import { PwrecSource } from '../input/pwrec-source.ts';
import type { Logger } from '../log.ts';
import { recordingDecisions } from '../pipeline/decision-sidecars.ts';
import { FeedPipeline } from '../pipeline/feed-pipeline.ts';
import { openDatabase, type Db, type SessionKey } from '../storage/db.ts';
import type { ReplayJob } from '../storage/rebuild-service-types.ts';
import { WeekendRepository } from '../storage/weekend-repository.ts';
import { recordingTrack, TRACKS_DIR } from '../track-files/load.ts';
import { RECORDING_FEED, recordingHub, runToEnd } from '../cli/process-recording.ts';
import { effectiveForecast, type TempsAtEnd } from './round.ts';

/**
 * What the planning replay hands back: the planning job's input for the race assumptions, without the round's slots;
 * the qualifying's race samples at its end (`[]` without any) and its own temperatures then. `input` is `undefined`
 * while the race laps are not known (C3): such a replay reads the forecast only.
 */
export type PlanningReplay = { input: StrategyInput | undefined; imported: ForecastSample[]; atEnd: TempsAtEnd };

/** An ISO time past every stored session's start: `weekendContext` then gives every session of a weekend. */
const AFTER_ALL = '￿';

const sameKey = (a: SessionKey, b: SessionKey): boolean => a.sessionUid === b.sessionUid && a.weekendId === b.weekendId && a.playerCar === b.playerCar;

/**
 * The practice basis `keys` as the run's `view.basis` (C62): their stored projections, read from `repo`, each loaded by
 * its own row's player seat (a practice of the team may be stored by the teammate's feed); a key not stored (or stale)
 * is missing from it. `player`: the replayed session's player seat.
 */
function basisOf(repo: WeekendRepository, keys: readonly SessionKey[], player: CarKey): BasisContext {
  const sessions = keys.flatMap((key) => {
    const own = repo.sessionOf(key);
    const seat = own?.cars.find((c) => c.carId === own.playerCar)?.carKey;
    if (seat === undefined) return [];
    return repo.weekendContext(key.weekendId, seat, key, { startedAt: AFTER_ALL }).context.sessions.filter((s) => sameKey(key, s));
  });
  return {
    basis: { practice: keys.map(({ sessionUid, weekendId }) => ({ sessionUid, weekendId })), qualifying: null },
    player: { teamId: player.teamId, raceNumber: player.raceNumber },
    sessions,
  };
}

/**
 * Replays `job.pwrecPath` to its end (see the header) and builds the planning job's input on its last session as of its
 * end; `null` when the recording holds no session. `dbPath`: the bridge's database, where the basis is read.
 */
export async function replayForPlanning(job: ReplayJob, o: { dbPath: string | undefined; config: FeatureConfig; rulesVersion: string; log: Logger }): Promise<PlanningReplay | null> {
  const path = job.pwrecPath;
  const { laps } = job;
  const race: RaceAssumptions | undefined = laps === null ? undefined : { laps, sets: job.sets, conditions: job.conditions };
  const stored: Db | undefined = o.dbPath === undefined || job.basisOverride.length === 0 ? undefined : openDatabase(o.dbPath);
  // The run's own storage, in memory: the engine stores nothing of a planning replay.
  const scratch = openDatabase(':memory:');
  try {
    const repo = stored && new WeekendRepository(stored, { rulesVersion: o.rulesVersion, log: o.log });
    const recorded = recordingDecisions(path, o.log);
    let result: PlanningReplay | null = null;
    let pipeline: FeedPipeline | undefined = undefined;
    const hub = recordingHub(() => pipeline);
    pipeline = new FeedPipeline({
      feedId: RECORDING_FEED,
      source: new PwrecSource({ feedId: RECORDING_FEED, path, mode: 'asFastAsPossible' }),
      hub,
      features: FEATURES,
      config: o.config,
      log: o.log,
      tracks: (trackId) => recordingTrack(path, trackId, TRACKS_DIR, o.log),
      // The recording's priors and decisions (C38, C76), but none of its basis choices: the basis is the round's; and the
      // round's profile snapshot, not the recording's sidecar (C62c, C62d).
      recorded: { ...recorded, decisions: recorded.decisions.filter((d) => d.decision.kind !== 'basisChosen') },
      recordedProfiles: job.profiles,
      storage: { db: scratch, rulesVersion: o.rulesVersion, mode: 'replace', sourcePath: path },
      basisOverride: (player) => (repo === undefined
        ? { basis: { practice: [], qualifying: null }, player: { teamId: player.teamId, raceNumber: player.raceNumber }, sessions: [] }
        : basisOf(repo, job.basisOverride, player)),
      onEnded: ({ view }) => {
        const { session } = view.live;
        const imported = session.nextForecast.map((s) => ({ ...s }));
        const atEnd: TempsAtEnd = { at: view.live.sessionTime, trackTempC: session.trackTempC, airTempC: session.airTempC };
        if (race === undefined) {
          result = { input: undefined, imported, atEnd };
          return;
        }
        const nextForecast = effectiveForecast(job.conditions, imported, atEnd);
        const input = planningInputFrom(asOfEnded(view, { laps: race.laps, nextForecast }), { laps: race.laps, race, prepared: {} });
        result = { input, imported, atEnd };
      },
    });
    await runToEnd(pipeline, path, new AbortController().signal);
    return result;
  } finally {
    scratch.close();
    stored?.close();
  }
}
