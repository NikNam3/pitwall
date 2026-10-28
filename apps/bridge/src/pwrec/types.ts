/** Shared types and layout constants of the `.pwrec` v1 format (see `pitwall-recorder/FORMAT.md`). */

export const PWREC_MAGIC = 'PWREC';
export const PWREC_VERSION = 1;
/** Magic (5) + version (1) + metadata length (4); the metadata JSON follows. */
export const HEADER_FIXED_BYTES = 10;
/** Kind (1) + time (8) + payload length (2); the payload follows. */
export const RECORD_HEADER_BYTES = 11;
export const MAX_PAYLOAD_BYTES = 0xffff;

export const RecordKind = { datagram: 0, end: 255 } as const;

/** Recorder metadata. Unknown fields are kept so a rewritten file loses nothing. */
export interface PwrecMeta {
  readonly recorderVersion: string;
  readonly startedAt: string;
  readonly listenPort: number;
  readonly [field: string]: unknown;
}

/** One UDP datagram exactly as received, `t` ms after the file was started. */
export interface PwrecRecord {
  readonly kind: 0;
  readonly t: number;
  readonly payload: Uint8Array;
}

export type PwrecError =
  | { readonly kind: 'badMagic' }
  | { readonly kind: 'badVersion'; readonly version: number }
  | { readonly kind: 'badMeta' };

/** What `readPwrec` returns once the file is read to its end. */
export interface PwrecSummary {
  readonly meta: PwrecMeta;
  /** False when the file has no end record (the recorder was killed). */
  readonly endedCleanly: boolean;
  /** Set when `endedCleanly`: the `t` of the end record. */
  readonly durationMs?: number;
}
