// Generator races (`test-support/race-generator/`, SP4.3a spec 6.4) as `race-interaction` reads them: with a track file
// built from the race's truth, and with the append frames `projectionAsOf` cuts by (plan review P1).
import { known, type FrameNumber, type TrackData } from '@pitwall/domain';
import type { EngineView, Projection } from '@pitwall/engine/readers';
import type { GeneratorParams } from '../../../../test-support/race-generator/index.ts';
import { zandvoortTrack } from '../../../../test-support/track.ts';

/** The generated race's track: a braking zone 2 % of a lap long from each of the truth's braking points, its DRS zones. */
export const trackOf = (truth: GeneratorParams): TrackData => ({
  ...zandvoortTrack(),
  brakingZones: known(truth.brakingZones.map((start) => ({ start, end: start + 0.02 })), 0),
  drsZones: known(truth.drsZones, 0),
});

/** `view` with `track` as its track file (C62b). */
export const withTrack = (view: EngineView, track: TrackData): EngineView => ({ ...view, track: known(track, 0) });

/**
 * `history` with the frame each entry was appended on, as the generator appends them (`record.ts`): a confirmed lap on
 * the frame after its provisional's crossing, every other fact on the frame it describes, a closed span on the frame
 * it closed on.
 */
export function withAppendFrames(history: Projection): Projection {
  const appendedAt: Record<string, FrameNumber[]> = {
    laps: history.laps.map((l) => (l.status === 'confirmed' ? l.frame + 1 : l.frame)),
    crossings: history.crossings.map((c) => c.frame),
    stints: history.stints.map((s) => s.frame),
    pitStops: history.pitStops.map((p) => p.frame),
    events: history.events.map((e) => e.frame),
  };
  for (const [machine, spans] of Object.entries(history.spans)) appendedAt[`spans:${machine}`] = spans.map((s) => s.endFrame);
  return { ...history, appendedAt };
}
