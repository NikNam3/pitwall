import { EVENT_CODE_LENGTH, EVENT_DETAILS_LENGTH, EVENT_DETAILS_SCHEMAS, isEventCode, type EventDetails } from '../events.ts';
import type { PacketHeader, PacketId } from '../header.ts';
import { readField, writeField } from '../schema/codec.ts';
import type { StructSpec } from '../schema/dsl.ts';

export type EventPacket = { packetId: typeof PacketId.event; header: PacketHeader; details: EventDetails };

export type EventBodyResult = { ok: true; details: EventDetails } | { ok: false; code: string };

/** Reads the 4-char code at `offset` (one char per byte, no UTF-8) and the variant details after it. */
export function readEventBody(view: DataView, offset: number): EventBodyResult {
  let code = '';
  for (let i = 0; i < EVENT_CODE_LENGTH; i++) code += String.fromCharCode(view.getUint8(offset + i));
  if (!isEventCode(code)) return { ok: false, code };
  const fields = readField(EVENT_DETAILS_SCHEMAS[code] as StructSpec, view, offset + EVENT_CODE_LENGTH);
  return { ok: true, details: { code, ...fields } as EventDetails };
}

/** Writes the code and the variant details at `offset`; unused detail bytes are zero. */
export function writeEventBody(view: DataView, offset: number, details: EventDetails): void {
  for (let i = 0; i < EVENT_CODE_LENGTH; i++) view.setUint8(offset + i, details.code.charCodeAt(i));
  const detailsAt = offset + EVENT_CODE_LENGTH;
  new Uint8Array(view.buffer, view.byteOffset + detailsAt, EVENT_DETAILS_LENGTH).fill(0);
  writeField(EVENT_DETAILS_SCHEMAS[details.code] as StructSpec, view, detailsAt, details);
}
