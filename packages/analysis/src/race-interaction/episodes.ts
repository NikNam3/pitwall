// The following episodes (SP4.3a spec 5.4, 5.5): a faster car held behind another, zone by zone, as the pass curve's fit
// and the calculator both read them (C43), and the spec 5.5 lap filter they share.
import type { CarId, LapRecord, TrackData } from '@pitwall/domain';
import type { DeepReadonly, MembershipSource, Projection } from '@pitwall/engine/readers';
import type { RaceInteractionConfig } from './config.ts';

/** One braking zone passed while following: its index in the track's braking zones, the pace advantage, and what happened. */
export type EpisodeZone = { zone: number; advantageMs: number; drs: boolean; wet: boolean; passed: boolean };

/** A follower held behind one leader, zone by zone. */
export type FollowingEpisode = { follower: CarId; leader: CarId; zones: EpisodeZone[] };

/** What the lap filter reads besides the lap: the projection with its situation (membership, C26) and the config (C47). */
export type LapFilterCtx = { source: MembershipSource; config: RaceInteractionConfig };

/** Every following episode of `history` on `track`'s braking zones; laps `excludedLap` leaves out give no zone. */
export function followingEpisodes(_history: Projection, _track: DeepReadonly<TrackData>, _config: RaceInteractionConfig): FollowingEpisode[] {
  throw new Error('not implemented');
}

/** The spec 5.5 lap filter: lap 1, in- and out-laps, SC, VSC and formation laps, a car with aero damage of 10 % or more. */
export function excludedLap(_lap: DeepReadonly<LapRecord>, _ctx: LapFilterCtx): boolean {
  throw new Error('not implemented');
}
