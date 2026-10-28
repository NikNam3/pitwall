// The raw storage layer (spec 9.1): one `.pwrec.gz` file per session, written as the datagrams arrive.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PwrecWriter } from '../pwrec/writer.ts';
import type { PwrecMeta } from '../pwrec/types.ts';

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** `YYYY-MM-DD_HH-MM-SS_<uid as 16 hex digits>.pwrec.gz` in local time, as the recorder names its files. */
export function sessionRecordingName(startedAtMs: number, sessionUid: bigint): string {
  const d = new Date(startedAtMs);
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const time = `${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`;
  return `${date}_${time}_${sessionUid.toString(16).padStart(16, '0')}.pwrec.gz`;
}

/** Where a session file stands: its path and the time of the last datagram written to it. */
export type SessionFilePosition = { path: string; t: number };

export type SessionFileOptions = {
  dir: string;
  name: string;
  meta: PwrecMeta;
  /** `receivedAtMs` of the session's first datagram: record times count from here. */
  originMs: number;
  /** Called once with the first file error; the file is then abandoned and later writes are dropped. */
  onError: (error: unknown) => void;
};

/** One session's datagrams, byte for byte. Never throws: every file error goes to `onError`. */
export class SessionFile {
  readonly path: string;
  readonly #writer: PwrecWriter | undefined;
  readonly #originMs: number;
  #lastT = 0;

  constructor(opts: SessionFileOptions) {
    this.path = join(opts.dir, opts.name);
    this.#originMs = opts.originMs;
    this.#writer = openWriter(this.path, opts);
  }

  get position(): SessionFilePosition {
    return { path: this.path, t: this.#lastT };
  }

  write(receivedAtMs: number, bytes: Uint8Array): void {
    this.#lastT = receivedAtMs - this.#originMs;
    this.#writer?.write(this.#lastT, bytes);
  }

  /** Writes the end record at `receivedAtMs` and resolves once the file is closed, also when it failed. */
  async close(receivedAtMs: number): Promise<void> {
    // A failure was already reported through `onError`; `close` rejects with that same error.
    await this.#writer?.close(receivedAtMs - this.#originMs).catch(() => {});
  }
}

function openWriter(path: string, opts: SessionFileOptions): PwrecWriter | undefined {
  try {
    mkdirSync(opts.dir, { recursive: true });
    return PwrecWriter.create(path, opts.meta, { onError: opts.onError });
  } catch (error) {
    opts.onError(error);
    return undefined;
  }
}
