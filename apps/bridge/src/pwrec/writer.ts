import { createReadStream, createWriteStream, openSync, renameSync, rmSync } from 'node:fs';
import { pipeline } from 'node:stream';
import { constants, createGunzip, createGzip } from 'node:zlib';
import { PwrecParser } from './parser.ts';
import { PwrecFormatError } from './reader.ts';
import {
  HEADER_FIXED_BYTES,
  MAX_PAYLOAD_BYTES,
  PWREC_MAGIC,
  PWREC_VERSION,
  RECORD_HEADER_BYTES,
  RecordKind,
  type PwrecMeta,
} from './types.ts';

export interface PwrecWriterOptions {
  /** Called once with the first file error, as it happens (the file is then abandoned). */
  readonly onError?: (error: unknown) => void;
}

export interface PwrecResumeOptions extends PwrecWriterOptions {
  /** The restart's wall clock (ms since the epoch): the bridge's I/O shell reads it and passes it in. */
  readonly wallClockMs: number;
}

/** The file opened for writing now, or undefined when that fails: the stream then opens it itself and reports the error. */
function openNow(path: string): number | undefined {
  try {
    return openSync(path, 'w');
  } catch {
    return undefined;
  }
}

function encodeHeader(meta: PwrecMeta): Uint8Array {
  const encoder = new TextEncoder();
  const json = encoder.encode(JSON.stringify(meta));
  const out = new Uint8Array(HEADER_FIXED_BYTES + json.length);
  const view = new DataView(out.buffer);
  out.set(encoder.encode(PWREC_MAGIC), 0);
  view.setUint8(PWREC_MAGIC.length, PWREC_VERSION);
  view.setUint32(PWREC_MAGIC.length + 1, json.length, true);
  out.set(json, HEADER_FIXED_BYTES);
  return out;
}

function encodeRecord(kind: number, t: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(RECORD_HEADER_BYTES + payload.length);
  const view = new DataView(out.buffer);
  view.setUint8(0, kind);
  view.setFloat64(1, t, true);
  view.setUint16(9, payload.length, true);
  out.set(payload, RECORD_HEADER_BYTES);
  return out;
}

/**
 * Writes a `.pwrec.gz` file. The gzip stream is sync-flushed about once per second of recording time, so a
 * crash loses at most the last second. File errors never throw from `write`: they go to `onError` and `close()`.
 * The file exists once `create` returns, so whatever is written next to it (a session's config sidecar) never is
 * on disk without it.
 */
export class PwrecWriter {
  readonly #gzip = createGzip();
  readonly #file;
  readonly #fileClosed: Promise<void>;
  readonly #onError: ((error: unknown) => void) | undefined;
  #lastFlushedSecond = 0;
  #closing = false;
  #failed = false;
  #firstError: unknown;

  private constructor(path: string, header: Uint8Array | undefined, onError: ((error: unknown) => void) | undefined) {
    this.#onError = onError;
    this.#file = createWriteStream(path, { fd: openNow(path) });
    this.#fileClosed = new Promise((resolve) => this.#file.once('close', () => resolve()));
    this.#file.on('error', (error) => this.#fail(error));
    this.#gzip.on('error', (error) => this.#fail(error));
    this.#gzip.pipe(this.#file);
    if (header !== undefined) {
      this.#gzip.write(header);
      this.#gzip.flush(constants.Z_SYNC_FLUSH);
    }
  }

  static create(path: string, meta: PwrecMeta, opts: PwrecWriterOptions = {}): PwrecWriter {
    return new PwrecWriter(path, encodeHeader(meta), opts.onError);
  }

  /**
   * Continues the recording at `path` after a bridge restart (C59): the file is recompressed, as one gzip stream, up to
   * its last whole record (a crash or kill cuts it mid-record; an end record of a clean stop stays), then a resume
   * record follows at `resumeT`: the last record's `t` or the wall-time gap since the file's `startedAt`, whichever is
   * later, so record times stay non-decreasing; its payload is `wallClockMs` as an ISO 8601 time. The new file replaces
   * the old one only once it holds all of that, flushed. `records`: the datagrams kept. Rejects with
   * `PwrecFormatError` for a file whose header cannot be read, leaving the file as it was.
   */
  static async resume(path: string, opts: PwrecResumeOptions): Promise<{ writer: PwrecWriter; records: number; resumeT: number }> {
    const parser = new PwrecParser();
    const gunzip = createGunzip({ finishFlush: constants.Z_SYNC_FLUSH });
    pipeline(createReadStream(path), gunzip, () => {});
    const temporary = `${path}.resuming`;
    let writer: PwrecWriter | undefined;
    let records = 0;
    let lastT = 0;
    try {
      for await (const chunk of gunzip as AsyncIterable<Uint8Array>) {
        const read = parser.pushRaw(chunk);
        if (parser.error !== undefined) throw new PwrecFormatError(parser.error);
        if (read.header !== undefined) writer = new PwrecWriter(temporary, read.header, opts.onError);
        for (const record of read.records) {
          if (record.kind === RecordKind.datagram) records++;
          lastT = record.t;
          if (writer !== undefined) await writer.#copy(record.bytes);
        }
      }
      parser.finish();
      if (parser.error !== undefined || parser.meta === undefined || writer === undefined) throw new PwrecFormatError(parser.error ?? { kind: 'badMeta' });
      const sinceStart = opts.wallClockMs - Date.parse(parser.meta.startedAt);
      const resumeT = Number.isFinite(sinceStart) ? Math.max(lastT, sinceStart) : lastT;
      await writer.#copy(encodeRecord(RecordKind.resume, resumeT, new TextEncoder().encode(new Date(opts.wallClockMs).toISOString())));
      await writer.#flushed();
      if (writer.#failed) throw writer.#firstError;
      renameSync(temporary, path);
      writer.#lastFlushedSecond = Math.floor(resumeT / 1000);
      return { writer, records, resumeT };
    } catch (error) {
      gunzip.destroy();
      if (writer !== undefined) {
        writer.#fail(error, { report: false });
        await writer.#fileClosed;
      }
      rmSync(temporary, { force: true });
      throw error;
    }
  }

  /** Writes `bytes` as they are, waiting while the gzip stream's buffer is full. */
  async #copy(bytes: Uint8Array): Promise<void> {
    if (this.#failed) return;
    if (!this.#gzip.write(bytes)) await new Promise<void>((resolve) => { this.#gzip.once('drain', resolve); this.#gzip.once('error', () => resolve()); });
  }

  /** Sync-flushes the gzip stream and resolves once everything written so far is on disk (or the file failed). */
  async #flushed(): Promise<void> {
    if (this.#failed) return;
    await new Promise<void>((resolve) => this.#gzip.flush(constants.Z_SYNC_FLUSH, () => resolve()));
    if (this.#failed) return;
    await new Promise<void>((resolve) => this.#file.write(new Uint8Array(0), () => resolve()));
  }

  /** Appends one datagram received `t` ms after the file was started. Dropped silently once the file has failed. */
  write(t: number, payload: Uint8Array): void {
    if (this.#closing) throw new Error('PwrecWriter: write after close');
    if (payload.length > MAX_PAYLOAD_BYTES) {
      throw new RangeError(`PwrecWriter: payload of ${payload.length} bytes exceeds ${MAX_PAYLOAD_BYTES}`);
    }
    if (this.#failed) return;
    this.#gzip.write(encodeRecord(RecordKind.datagram, t, payload));
    const second = Math.floor(t / 1000);
    if (second > this.#lastFlushedSecond) {
      this.#lastFlushedSecond = second;
      this.#gzip.flush(constants.Z_SYNC_FLUSH);
    }
  }

  /** Appends the end record, finishes the file and resolves once it is closed. Rejects with the first file error. */
  async close(durationMs: number): Promise<void> {
    if (this.#closing) throw new Error('PwrecWriter: already closed');
    this.#closing = true;
    if (!this.#failed) {
      this.#gzip.write(encodeRecord(RecordKind.end, durationMs, new Uint8Array(0)));
      this.#gzip.end();
    }
    await this.#fileClosed;
    if (this.#failed) throw this.#firstError;
  }

  /** The file is abandoned; `report: false` (a resume that failed, and so rejects) does not call `onError`. */
  #fail(error: unknown, opts: { report: boolean } = { report: true }): void {
    if (this.#failed) return;
    this.#failed = true;
    this.#firstError = error;
    this.#gzip.destroy();
    this.#file.destroy();
    if (opts.report) this.#onError?.(error);
  }
}
