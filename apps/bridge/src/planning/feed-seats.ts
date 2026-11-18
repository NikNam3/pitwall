// The feed's remembered seat (C62d, C70, C3; SP4.3e Task 7bfix R19): bridge state, one file per feed,
// `PITWALL_DATA_DIR/feeds/<feedId>.json`, `{ team, raceNumber, trackId, at }`: the feed's last seat (its player car's team
// and race number) and the track of the session it was known in, written atomically when a feed's team becomes known.
// Between sessions the planning module takes the feed's seat and closed-state track from it. A missing file reads
// `undefined`; a corrupt one `undefined` with a warning (C3).
import { join } from 'node:path';
import type { CarKey, FeedId, TrackId } from '@pitwall/domain';
import type { Logger } from '../log.ts';
import { ensureDir, parseJson, readText, writeAtomic } from '../ui-state/ui-files.ts';

/** A feed's remembered seat and the track it was known on; `at`: when (ISO). */
export type RememberedSeat = { seat: CarKey; trackId: TrackId; at: string };

export type FeedSeatStore = {
  read(feedId: FeedId): RememberedSeat | undefined;
  write(feedId: FeedId, seat: CarKey, trackId: TrackId): void;
};

const isObject = (raw: unknown): raw is Record<string, unknown> => typeof raw === 'object' && raw !== null && !Array.isArray(raw);

function rememberedOf(raw: unknown): RememberedSeat | undefined {
  if (!isObject(raw)) return undefined;
  const { team, raceNumber, trackId, at } = raw;
  if (!Number.isInteger(team) || !Number.isInteger(raceNumber) || !Number.isInteger(trackId) || typeof at !== 'string') return undefined;
  return { seat: { teamId: team as number, raceNumber: raceNumber as number }, trackId: trackId as TrackId, at };
}

export function createFeedSeatStore(dataDir: string, log: Pick<Logger, 'warn'>, now: () => string = () => new Date().toISOString()): FeedSeatStore {
  const dir = join(dataDir, 'feeds');
  const pathOf = (feedId: FeedId): string => join(dir, `${feedId}.json`);
  return {
    read(feedId) {
      const path = pathOf(feedId);
      const text = readText(path);
      if (text === undefined) return undefined;
      const parsed = parseJson(text);
      const remembered = parsed.ok ? rememberedOf(parsed.value) : undefined;
      if (remembered === undefined) log.warn({ path, reason: parsed.ok ? 'not a remembered seat' : parsed.message }, 'feed seat file is corrupt; ignored');
      return remembered;
    },
    write(feedId, seat, trackId) {
      ensureDir(dir);
      const file = { team: seat.teamId, raceNumber: seat.raceNumber, trackId, at: now() };
      writeAtomic(pathOf(feedId), `${JSON.stringify(file, null, 2)}\n`);
    },
  };
}
