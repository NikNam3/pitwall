import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream';
import { constants, createGunzip } from 'node:zlib';
import { PwrecParser } from './parser.ts';
import type { PwrecError, PwrecRecord, PwrecSummary } from './types.ts';

/** The file is not a valid `.pwrec` v1 recording. */
export class PwrecFormatError extends Error {
  readonly error: PwrecError;

  constructor(error: PwrecError) {
    super(`Invalid .pwrec file: ${error.kind}`);
    this.name = 'PwrecFormatError';
    this.error = error;
  }
}

/**
 * Streams the datagram records of a `.pwrec.gz` file. A file cut off by a crash reads up to its last flush
 * and reports `endedCleanly: false`. Throws `PwrecFormatError` for an invalid header.
 */
export async function* readPwrec(path: string): AsyncGenerator<PwrecRecord, PwrecSummary> {
  const parser = new PwrecParser();
  const gunzip = createGunzip({ finishFlush: constants.Z_SYNC_FLUSH });
  pipeline(createReadStream(path), gunzip, () => {});
  for await (const chunk of gunzip as AsyncIterable<Uint8Array>) {
    const records = parser.push(chunk);
    if (parser.error !== undefined) throw new PwrecFormatError(parser.error);
    yield* records;
  }
  const end = parser.finish();
  const { meta, error } = parser;
  if (error !== undefined || meta === undefined) throw new PwrecFormatError(error ?? { kind: 'badMeta' });
  return end.endedCleanly ? { meta, endedCleanly: true, durationMs: end.durationMs } : { meta, endedCleanly: false };
}
