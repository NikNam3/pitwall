// Replays a committed segment through a `SessionRunner` (as the tracker assembles its frames) and returns the spans one
// sub-machine produced, closed at the session's end (`finish`), for the segment tests of the sub-machines.
import { expect } from 'vitest';
import { feedId, type CarId, type Span } from '@pitwall/domain';
import { SessionRunner, SessionTracker } from '../../src/index.ts';
import { segmentPackets } from '../../../../test-support/segments.ts';

/** The spans of sub-machine `machine` the segment `file` produces, in the order the projection lists them. */
export async function replaySpans(file: string, machine: string): Promise<readonly Span[]> {
  const tracker = new SessionTracker({ feedId: feedId(file) });
  const events = (await segmentPackets(file)).flatMap(({ packet, receivedAtMs }) => tracker.push(packet, receivedAtMs));
  const frames = [...events, ...tracker.end()].flatMap((e) => (e.type === 'frame' ? [e.frame] : []));
  const first = frames.find((f) => f.session !== undefined)!;
  const runner = new SessionRunner({ feedId: feedId(file), sessionUid: first.sessionUid, session: first.session! });
  for (const f of frames.slice(frames.indexOf(first))) runner.apply(f);
  runner.finish();
  return runner.state.history.spans[machine] ?? [];
}

/** A span's kind, with when it started in seconds of the race clock, rounded to a tenth. */
export type KindAt = readonly [kind: string, startS: number];

/** The spans of one scope (`pick`) in time order, as `[kind, start in seconds]`. */
export const sequenceOf = (spans: readonly Span[], pick: (s: Span) => boolean): KindAt[] =>
  spans
    .filter(pick)
    .sort((a, b) => a.startFrame - b.startFrame)
    .map((s): KindAt => [s.kind, Math.round(s.start / 100) / 10]);

/** The spans of one car. */
export const ofCar = (car: number) => (s: Span): boolean => s.carId === (car as CarId);
/** The spans of one marshal zone. */
export const ofZone = (zone: number) => (s: Span): boolean => s.zone === zone;

/**
 * Expects the sequence to have the kinds of `expected` in order, each span after the first starting within `toleranceS`
 * seconds of the game's session time of the change the recording shows (the first starts on the segment's first frame).
 */
export const expectSequence = (sequence: readonly KindAt[], expected: readonly KindAt[], toleranceS = 0.7): void => {
  expect(sequence.map(([kind]) => kind)).toEqual(expected.map(([kind]) => kind));
  sequence.forEach(([, at], i) => {
    if (i > 0) expect(Math.abs(at - expected[i]![1]), `span ${i} starts at ${at} s, expected ${expected[i]![1]} s`).toBeLessThanOrEqual(toleranceS);
  });
};
