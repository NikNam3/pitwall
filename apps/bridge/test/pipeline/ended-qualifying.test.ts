// SP4.3d2 Task 5 fix round, F1 (C13, C43; ruling R21): the startup probe (`isEndedQualifying`) reads no signal. Whether a
// stored qualifying holds its end is the engine's answer (the session tracker's `sessionEnded` reason `'SEND'`, or the
// session-phase sub-machine through `situationOf`), never a decode of the recording's Event packets by the bridge.
//
// The recordings here are written by the test into a temporary directory from a committed segment (C84): Texas's one-shot
// qualifying (type 9, it ends qualifying) as it is, and the same session cut before its SEND with a SEND of another
// session appended (a raw Event scan sees a SEND; the engine sees no end of this session).
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { feedId } from '@pitwall/domain';
import { SessionTracker, type TrackerEvent } from '@pitwall/engine';
import { decode, PacketId, peekHeader } from '@pitwall/protocol';
import { createLogger } from '../../src/log.ts';
import { isEndedQualifying } from '../../src/pipeline/ended-qualifying.ts';
import { readPwrec } from '../../src/pwrec/reader.ts';
import { segmentPath } from '../fixtures/replay.ts';
import type { PreparedPacket } from '../helpers/array-source.ts';
import { concat, META, pwrecHeader, pwrecRecord } from '../pwrec/helpers.ts';

const PROBE_SOURCE = fileURLToPath(new URL('../../src/pipeline/ended-qualifying.ts', import.meta.url));
const silent = createLogger({ level: 'silent' });
/** The header's `sessionUid` (u64, little-endian) follows format, year, versions and packet id. */
const SESSION_UID_OFFSET = 7;
const tmp = () => mkdtempSync(join(tmpdir(), 'ended-qualifying-'));

const isSend = (p: PreparedPacket): boolean => {
  const decoded = decode(p.bytes);
  return decoded.ok && decoded.packet.packetId === PacketId.event && decoded.packet.details.code === 'SEND';
};
const uidOf = (packets: readonly PreparedPacket[]): bigint =>
  peekHeader(packets.find((p) => peekHeader(p.bytes)?.packetId === PacketId.session && peekHeader(p.bytes)?.sessionUid !== 0n)!.bytes)!.sessionUid;

/** `packet` with its header's session uid set to `uid`. */
function withSessionUid(packet: PreparedPacket, uid: bigint): PreparedPacket {
  const bytes = Uint8Array.from(packet.bytes);
  new DataView(bytes.buffer).setBigUint64(SESSION_UID_OFFSET, uid, true);
  return { ...packet, bytes };
}

/** A `.pwrec.gz` of `packets` (record times from the first), in a directory of its own. */
function recordingOf(packets: readonly PreparedPacket[]): string {
  const t0 = packets[0]!.receivedAtMs;
  const path = join(tmp(), 'session.pwrec.gz');
  writeFileSync(path, gzipSync(concat(pwrecHeader(META), ...packets.map((p) => pwrecRecord(0, p.receivedAtMs - t0, Uint8Array.from(p.bytes))))));
  return path;
}

/** The engine's answer: the session tracker ends the recording's session (its first Session packet's uid) with reason SEND. */
function engineEndsBySend(packets: readonly PreparedPacket[]): boolean {
  const uid = uidOf(packets);
  const tracker = new SessionTracker({ feedId: feedId('reference') });
  const events: TrackerEvent[] = [];
  for (const p of packets) {
    const decoded = decode(p.bytes);
    if (decoded.ok) events.push(...tracker.push(decoded.packet, p.receivedAtMs));
  }
  events.push(...tracker.end());
  return events.some((e) => e.type === 'sessionEnded' && e.sessionUid === uid && e.reason === 'SEND');
}

let texas: PreparedPacket[];
beforeAll(async () => {
  texas = [];
  for await (const r of readPwrec(segmentPath('qualifying-texas-send.pwrec.gz'))) texas.push({ bytes: r.payload, receivedAtMs: r.t });
  expect(texas.some(isSend)).toBe(true);
});

describe('the startup probe takes the session end from the engine, never from a signal (C13, C43)', { timeout: 120_000 }, () => {
  it('ended-qualifying.ts imports nothing of the protocol package: it decodes no packet', () => {
    const source = readFileSync(PROBE_SOURCE, 'utf8');
    expect(source).not.toMatch(/from\s+['"]@pitwall\/protocol['"]/);
    expect(source).not.toMatch(/import\(\s*['"]@pitwall\/protocol['"]\s*\)/);
  });

  it('a qualifying recording with its SEND: the probe\'s answer equals the engine\'s session end (ended)', async () => {
    const path = recordingOf(texas);
    expect(engineEndsBySend(texas)).toBe(true);
    expect(await isEndedQualifying(path, silent)).toBe(engineEndsBySend(texas));
  });

  it('a qualifying cut before its SEND, a SEND of another session appended: the probe\'s answer equals the engine\'s (not ended)', async () => {
    const sendAt = texas.findIndex(isSend);
    const uid = uidOf(texas);
    const foreignSend = withSessionUid(texas[sendAt]!, uid + 1n);
    const packets = [...texas.slice(0, sendAt), { ...foreignSend, receivedAtMs: texas[sendAt - 1]!.receivedAtMs + 1 }];
    // a raw scan of the Event packets finds a SEND ...
    expect(packets.some(isSend)).toBe(true);
    // ... the engine ends no session of this recording by it
    expect(engineEndsBySend(packets)).toBe(false);
    expect(await isEndedQualifying(recordingOf(packets), silent)).toBe(engineEndsBySend(packets));
  });
});
