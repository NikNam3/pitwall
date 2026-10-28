import { createWriteStream } from 'node:fs';
import { constants, createGzip } from 'node:zlib';
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

  private constructor(path: string, meta: PwrecMeta, onError: ((error: unknown) => void) | undefined) {
    this.#onError = onError;
    this.#file = createWriteStream(path);
    this.#fileClosed = new Promise((resolve) => this.#file.once('close', () => resolve()));
    this.#file.on('error', (error) => this.#fail(error));
    this.#gzip.on('error', (error) => this.#fail(error));
    this.#gzip.pipe(this.#file);
    this.#gzip.write(encodeHeader(meta));
    this.#gzip.flush(constants.Z_SYNC_FLUSH);
  }

  static create(path: string, meta: PwrecMeta, opts: PwrecWriterOptions = {}): PwrecWriter {
    return new PwrecWriter(path, meta, opts.onError);
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

  #fail(error: unknown): void {
    if (this.#failed) return;
    this.#failed = true;
    this.#firstError = error;
    this.#gzip.destroy();
    this.#file.destroy();
    this.#onError?.(error);
  }
}
