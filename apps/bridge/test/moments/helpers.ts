// Shared by the moment tests: the committed segments and their offsets (receive time from the segment's first record).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decode } from '@pitwall/protocol';
import { readPwrec } from '../../src/pwrec/reader.ts';

export const ROOT = join(import.meta.dirname, '../../../..');
export const SEGMENTS = join(ROOT, 'fixtures/segments');
export const segmentPath = (file: string): string => join(SEGMENTS, file);

export type MomentSpec = { segment: string; atMs: number };

export const readMomentsFile = (): Record<string, MomentSpec> =>
  JSON.parse(readFileSync(join(ROOT, 'fixtures/moments.json'), 'utf8')) as Record<string, MomentSpec>;

/** Offset in ms of the first event packet with `code` (and of the last record) from the segment's first record. */
export async function offsets(file: string, code: string): Promise<{ eventMs: number | undefined; endMs: number }> {
  let first: number | undefined;
  let endMs = 0;
  let eventMs: number | undefined;
  for await (const record of readPwrec(segmentPath(file))) {
    first ??= record.t;
    endMs = record.t - first;
    const decoded = decode(record.payload);
    if (eventMs === undefined && decoded.ok && decoded.packet.packetId === 3 && decoded.packet.details.code === code) eventMs = endMs;
  }
  return { eventMs, endMs };
}
