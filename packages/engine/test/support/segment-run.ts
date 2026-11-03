// A committed segment replayed through a `SessionRunner` for sub-machine segment tests (contract C84, C85): what each
// applied frame showed (`observe` reads the engine state after the step) and the spans the machine closed, as the
// projection holds them once the session is finished. Starts from the first frame that carries a Session packet.
import { feedId, type Span } from '@pitwall/domain';
import { SessionRunner, SessionTracker, type StepResult } from '../../src/index.ts';
import { segmentPackets } from '../../../../test-support/segments.ts';

/** One applied frame: its frame number and what `observe` read. */
export type Observed<T> = { frameNumber: number; value: T };

/** The replay of one segment. */
export type SegmentRun<T> = {
  /** One entry per applied frame, in order. */
  frames: Observed<T>[];
  /** The closed spans of sub-machine `id`, in log order (the session's end has closed the open ones). */
  spans(id: string): readonly Span[];
};

/** Replays `file` of `fixtures/segments/`. */
export async function replaySegment<T>(file: string, observe: (state: StepResult['state']) => T): Promise<SegmentRun<T>> {
  const tracker = new SessionTracker({ feedId: feedId(file) });
  const events = (await segmentPackets(file)).flatMap(({ packet, receivedAtMs }) => tracker.push(packet, receivedAtMs));
  const all = [...events, ...tracker.end()].flatMap((e) => (e.type === 'frame' ? [e.frame] : []));
  const first = all.find((f) => f.session !== undefined)!;
  const runner = new SessionRunner({ feedId: feedId(file), sessionUid: first.sessionUid, session: first.session! });
  const frames: Observed<T>[] = [];
  const onResult = (r: StepResult) => {
    frames.push({ frameNumber: r.state.frameNumber, value: observe(r.state) });
  };
  for (const f of all.slice(all.indexOf(first))) runner.apply(f, onResult);
  runner.finish();
  return { frames, spans: (id) => runner.state.history.spans[id] ?? [] };
}
