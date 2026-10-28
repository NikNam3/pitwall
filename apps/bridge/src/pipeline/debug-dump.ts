// A debug dump (spec 10.1): the frame an exception hit, with where it sits in the session's `.pwrec` file.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FeedId } from '@pitwall/domain';
import type { Frame } from '@pitwall/engine';

/** A failing session writes no more dumps than this; the log still gets every error. */
export const MAX_DUMPS_PER_SESSION = 20;

export type DebugDump = {
  feedId: FeedId;
  sessionUid: bigint;
  frame: Frame;
  /** The session file and the record time inside it; without a file, `t` is the last `receivedAtMs`. */
  pwrec: { path?: string; t: number };
  error: unknown;
};

const bigintsAsStrings = (_key: string, value: unknown): unknown => (typeof value === 'bigint' ? value.toString() : value);

const describeError = (error: unknown): object =>
  error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { message: String(error) };

/** Writes `<feedId>-<sessionUid>-<frameId>.json` into `dir` (created if missing) and returns its path. */
export function writeDebugDump(dir: string, d: DebugDump): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${d.feedId}-${d.sessionUid}-${d.frame.frameId}.json`);
  writeFileSync(path, JSON.stringify({ ...d, error: describeError(d.error) }, bigintsAsStrings, 2));
  return path;
}
