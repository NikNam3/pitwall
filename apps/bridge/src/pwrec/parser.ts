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

/**
 * Incremental `.pwrec` v1 parser over the decompressed byte stream; any chunking gives the same result.
 * Only datagram records are returned. Payloads are plain `Uint8Array` copies (a Buffer chunk's own `slice` would
 * be a view), valid for as long as the caller keeps them.
 * An incomplete trailing record is the end of the data, not an error.
 */
export class PwrecParser {
  #pending: Uint8Array = new Uint8Array(0);
  #meta: PwrecMeta | undefined;
  #error: PwrecError | undefined;
  #durationMs: number | undefined;

  get meta(): PwrecMeta | undefined {
    return this.#meta;
  }

  /** Set once the header is invalid (or, after `finish()`, incomplete); `push` then returns `[]`. */
  get error(): PwrecError | undefined {
    return this.#error;
  }

  push(chunk: Uint8Array): PwrecRecord[] {
    if (this.#error !== undefined || this.#durationMs !== undefined) return [];
    const bytes = this.#pending.length === 0 ? chunk : concat(this.#pending, chunk);
    let at = 0;
    if (this.#meta === undefined) {
      const headerBytes = this.#readHeader(bytes);
      if (headerBytes === undefined) {
        this.#pending = this.#error === undefined ? bytes : new Uint8Array(0);
        return [];
      }
      at = headerBytes;
    }
    const records: PwrecRecord[] = [];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    while (bytes.length - at >= RECORD_HEADER_BYTES) {
      const payloadBytes = view.getUint16(at + 9, true);
      const end = at + RECORD_HEADER_BYTES + payloadBytes;
      if (end > bytes.length) break;
      const kind = view.getUint8(at);
      const t = view.getFloat64(at + 1, true);
      if (kind === RecordKind.datagram) {
        records.push({ kind, t, payload: new Uint8Array(bytes.subarray(at + RECORD_HEADER_BYTES, end)) });
      } else if (kind === RecordKind.end) {
        this.#durationMs = t;
        this.#pending = new Uint8Array(0);
        return records;
      }
      at = end;
    }
    this.#pending = bytes.subarray(at);
    return records;
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
