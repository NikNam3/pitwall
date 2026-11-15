import {
  HEADER_FIXED_BYTES,
  PWREC_MAGIC,
  PWREC_VERSION,
  RECORD_HEADER_BYTES,
  RecordKind,
  type PwrecError,
  type PwrecMeta,
  type PwrecRecord,
} from './types.ts';

export type PwrecParseEnd =
  | { readonly endedCleanly: true; readonly durationMs: number; readonly truncatedBytes: 0 }
  | { readonly endedCleanly: false; readonly truncatedBytes: number };

const utf8 = new TextDecoder('utf-8', { fatal: true });
const magicBytes = new TextEncoder().encode(PWREC_MAGIC);
const VERSION_AT = magicBytes.length;
const META_LENGTH_AT = VERSION_AT + 1;

function isPwrecMeta(value: unknown): value is PwrecMeta {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const fields = value as Record<string, unknown>;
  return (
    typeof fields['recorderVersion'] === 'string' &&
    typeof fields['startedAt'] === 'string' &&
    typeof fields['listenPort'] === 'number'
  );
}

function parseMeta(bytes: Uint8Array): PwrecMeta | undefined {
  try {
    const value: unknown = JSON.parse(utf8.decode(bytes));
    return isPwrecMeta(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** One whole record of any kind, as `pushRaw` returns it: `bytes` is the record itself (its header included), copied. */
export interface PwrecRawRecord {
  readonly kind: number;
  readonly t: number;
  readonly bytes: Uint8Array;
}

/** What `pushRaw` read from one chunk: the file header's bytes (once, when it completed) and the whole records. */
export interface PwrecRawChunk {
  readonly header?: Uint8Array;
  readonly records: PwrecRawRecord[];
}

/**
 * Incremental `.pwrec` v1 parser over the decompressed byte stream; any chunking gives the same result.
 * `push` returns only datagram records. Payloads are plain `Uint8Array` copies (a Buffer chunk's own `slice` would
 * be a view), valid for as long as the caller keeps them.
 * An incomplete trailing record is the end of the data, not an error. An end record ends the data unless a resume
 * record follows it (a bridge restart continued the file, C59): the data then goes on after the resume record.
 */
export class PwrecParser {
  #pending: Uint8Array = new Uint8Array(0);
  #meta: PwrecMeta | undefined;
  #error: PwrecError | undefined;
  /** The `t` of the newest end record, while no record followed it. */
  #durationMs: number | undefined;
  /** A record other than a resume record followed an end record: everything after the end record is ignored. */
  #closed = false;

  get meta(): PwrecMeta | undefined {
    return this.#meta;
  }

  /** Set once the header is invalid (or, after `finish()`, incomplete); `push` then returns `[]`. */
  get error(): PwrecError | undefined {
    return this.#error;
  }

  push(chunk: Uint8Array): PwrecRecord[] {
    const records: PwrecRecord[] = [];
    this.#read(chunk, (kind, t, bytes, at, end) => {
      if (kind === RecordKind.datagram) records.push({ kind, t, payload: new Uint8Array(bytes.subarray(at + RECORD_HEADER_BYTES, end)) });
    });
    return records;
  }

  /** Like `push`, but returns every whole record of every kind as its bytes, and the header's bytes once complete. */
  pushRaw(chunk: Uint8Array): PwrecRawChunk {
    const records: PwrecRawRecord[] = [];
    const header = this.#read(chunk, (kind, t, bytes, at, end) => records.push({ kind, t, bytes: new Uint8Array(bytes.subarray(at, end)) }));
    return header === undefined ? { records } : { header, records };
  }

  /** Reads the chunk's whole records into `take`, in order; returns the header's bytes when it completed in this chunk. */
  #read(chunk: Uint8Array, take: (kind: number, t: number, bytes: Uint8Array, at: number, end: number) => void): Uint8Array | undefined {
    if (this.#error !== undefined || this.#closed) return undefined;
    const bytes = this.#pending.length === 0 ? chunk : concat(this.#pending, chunk);
    let at = 0;
    let header: Uint8Array | undefined;
    if (this.#meta === undefined) {
      const headerBytes = this.#readHeader(bytes);
      if (headerBytes === undefined) {
        this.#pending = this.#error === undefined ? bytes : new Uint8Array(0);
        return undefined;
      }
      header = new Uint8Array(bytes.subarray(0, headerBytes));
      at = headerBytes;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    while (bytes.length - at >= RECORD_HEADER_BYTES) {
      const payloadBytes = view.getUint16(at + 9, true);
      const end = at + RECORD_HEADER_BYTES + payloadBytes;
      if (end > bytes.length) break;
      const kind = view.getUint8(at);
      const t = view.getFloat64(at + 1, true);
      if (this.#durationMs !== undefined) {
        if (kind !== RecordKind.resume) {
          this.#closed = true;
          this.#pending = new Uint8Array(0);
          return header;
        }
        this.#durationMs = undefined;
      }
      if (kind === RecordKind.end) this.#durationMs = t;
      take(kind, t, bytes, at, end);
      at = end;
    }
    this.#pending = bytes.subarray(at);
    return header;
  }

  /** Call after the last chunk. An incomplete header sets `error` to `badMeta`. */
  finish(): PwrecParseEnd {
    if (this.#durationMs !== undefined) return { endedCleanly: true, durationMs: this.#durationMs, truncatedBytes: 0 };
    if (this.#meta === undefined && this.#error === undefined) this.#error = { kind: 'badMeta' };
    return { endedCleanly: false, truncatedBytes: this.#pending.length };
  }

  /** Validates as much of the header as `bytes` holds. Returns its length once complete, otherwise `undefined`. */
  #readHeader(bytes: Uint8Array): number | undefined {
    if (bytes.length >= VERSION_AT && magicBytes.some((b, i) => bytes[i] !== b)) {
      this.#error = { kind: 'badMagic' };
      return undefined;
    }
    const version = bytes[VERSION_AT];
    if (version !== undefined && version !== PWREC_VERSION) {
      this.#error = { kind: 'badVersion', version };
      return undefined;
    }
    if (bytes.length < HEADER_FIXED_BYTES) return undefined;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const headerBytes = HEADER_FIXED_BYTES + view.getUint32(META_LENGTH_AT, true);
    if (bytes.length < headerBytes) return undefined;
    this.#meta = parseMeta(bytes.subarray(HEADER_FIXED_BYTES, headerBytes));
    if (this.#meta === undefined) {
      this.#error = { kind: 'badMeta' };
      return undefined;
    }
    return headerBytes;
  }
}
