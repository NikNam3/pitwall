// Suggested sources (spec 3.2): our cars' stints of the stored sessions on a track that no set of the track holds and
// that some unit's declared `candidate` accepts. The unit decides (C43); the store only orders them: the weekend of
// the newest stored session on the track first, then newest session first.
import type { CalibrationSet, CalibrationSource, CarId, SourceFit } from '@pitwall/domain';
import type { TrackSession } from '../storage/weekend-repository.ts';
import { resolveSource, type PriorsRunner } from './compute.ts';
import { sameStint, stintKey } from './sets.ts';

/**
 * The feed's player car and the teammate the engine placed, as stored with the session (spec 3.1): our cars' data only.
 * The engine decides the teammate (C43); the bridge applies no rule of its own over the slots' teams.
 */
export function ourCars(session: Pick<TrackSession, 'playerCar' | 'teammateCar'>): CarId[] {
  return session.teammateCar === null ? [session.playerCar] : [session.playerCar, session.teammateCar];
}

/** Sessions in suggestion order: those of the newest session's weekend first, then the rest; newest first within each. */
function suggestionOrder(sessions: readonly TrackSession[]): TrackSession[] {
  const newestFirst = sessions.toSorted((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
  const weekend = newestFirst[0]?.weekendId;
  return [...newestFirst.filter((s) => s.weekendId === weekend), ...newestFirst.filter((s) => s.weekendId !== weekend)];
}

/** The candidate key of the cache: per track, per stint. */
export const candidateKey = (trackId: number, source: CalibrationSource): string => `${trackId}/candidate/${stintKey(source)}`;

/** The track's suggested sources, each with its own entries and lap counts (a candidate has no residuals: it is in no set). */
export function suggestions(trackId: number, sessions: readonly TrackSession[], sets: readonly CalibrationSet[], runner: PriorsRunner): SourceFit[] {
  const held = sets.flatMap((set) => set.sources);
  const fits: SourceFit[] = [];
  for (const session of suggestionOrder(sessions)) {
    if (session.stale || session.projection === undefined) continue;
    const cars = new Set(ourCars(session));
    for (const stint of session.projection.stints) {
      if (!cars.has(stint.carId)) continue;
      const source: CalibrationSource = {
        sessionUid: session.sessionUid, weekendId: session.weekendId, feedCar: session.playerCar, car: stint.carId, firstLap: stint.firstLap, excludedLaps: [],
      };
      if (held.some((s) => sameStint(s, source))) continue;
      const resolved = resolveSource(source, [session]);
      if (!('stored' in resolved) || !runner.accepts(resolved.stored)) continue;
      fits.push(runner.fit(resolved, candidateKey(trackId, source), {}, undefined));
    }
  }
  return fits;
}
