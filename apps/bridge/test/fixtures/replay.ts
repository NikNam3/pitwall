// Recordings and committed segments through the session tracker. Frames are folded, never collected.
import { basename, join } from 'node:path';
import type { FeedId } from '@pitwall/domain';
import { decode, type Packet } from '@pitwall/protocol';
import { SessionTracker, type Frame, type FrameMetrics, type TrackerEvent } from '@pitwall/engine';
import { fixturePath, type FixtureName } from '../../../../test-support/fixtures.ts';
import { readPwrec } from '../../src/pwrec/reader.ts';

/** The committed segment `file` of `fixtures/segments/`. */
export const segmentPath = (file: string): string => join(import.meta.dirname, '../../../../fixtures/segments', file);

/** Every committed segment (all of normal sessions). */
export const SEGMENT_FILES = [
  'race-singapore-start.pwrec.gz',
  'race-singapore-end.pwrec.gz',
  'race-singapore-wet-flashback.pwrec.gz',
  'qualifying-singapore-end.pwrec.gz',
  'race-zandvoort-lap10.pwrec.gz',
  'race-zandvoort-pit-stop.pwrec.gz',
  'race-zandvoort-pit-exit.pwrec.gz',
  'race-zandvoort-vsc.pwrec.gz',
  'race-zandvoort-retire.pwrec.gz',
] as const;

export async function* filePackets(path: string): AsyncGenerator<{ packet: Packet; receivedAtMs: number }> {
  for await (const r of readPwrec(path)) {
    const d = decode(r.payload);
    if (d.ok) yield { packet: d.packet, receivedAtMs: r.t };
  }
}

export type TrackedFixture = {
  lifecycle: Array<Exclude<TrackerEvent, { type: 'frame' }>>;
  frames: number;
  lastFrame: Frame | undefined;
  metrics: FrameMetrics;
};

/** Runs the recording at `path` through a `SessionTracker`; `onFrame` sees every frame. */
export async function trackFile(path: string, onFrame: (f: Frame) => void = () => {}): Promise<TrackedFixture> {
  const tracker = new SessionTracker({ feedId: basename(path) as FeedId });
  const out: TrackedFixture = { lifecycle: [], frames: 0, lastFrame: undefined, metrics: tracker.metrics };
  const take = (es: TrackerEvent[]) => {
    for (const e of es) {
      if (e.type === 'frame') {
        out.frames++;
        out.lastFrame = e.frame;
        onFrame(e.frame);
      } else out.lifecycle.push(e);
    }
  };
  for await (const { packet, receivedAtMs } of filePackets(path)) take(tracker.push(packet, receivedAtMs));
  take(tracker.end());
  return { ...out, metrics: tracker.metrics };
}

/** `trackFile` on a full recording; only the tiny ones (`menuOnly`, `lobbyOnly`) belong in the unit suite. */
export async function trackFixture(name: FixtureName, onFrame: (f: Frame) => void = () => {}): Promise<TrackedFixture> {
  return trackFile(fixturePath(name)!, onFrame);
}
