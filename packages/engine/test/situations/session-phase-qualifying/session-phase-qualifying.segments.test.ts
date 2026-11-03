// The qualifying session-phase sub-machine on the committed segment qualifying-singapore-end (contract C14, C26, C36,
// C84; facts in fixtures/index.json): time over, SEND with every car finished (inventory §1.6, Review Focus 3). Every
// expected frame is read from the segment's own frames by the machine's rule, never a fact of the recording. The
// segment also carries the session's FinalClassification after SEND: the end comes from SEND, not from it.
import { beforeAll, describe, expect, it } from 'vitest';
import { feedId, type OpenSpan } from '@pitwall/domain';
import { SessionRunner, SessionTracker, type DeepReadonly, type Frame, type StepResult } from '../../../src/index.ts';
import { situationOf } from '../../../src/situations/run.ts';
import { segmentPackets } from '../../../../../test-support/segments.ts';

const MACHINE = 'session-phase-qualifying';
type Step = { frameNumber: number; codes: string[]; rewound: boolean };

let runner: SessionRunner;
const steps: Step[] = [];
beforeAll(async () => {
  const file = 'qualifying-singapore-end.pwrec.gz';
  const tracker = new SessionTracker({ feedId: feedId(file) });
  const events = (await segmentPackets(file)).flatMap(({ packet, receivedAtMs }) => tracker.push(packet, receivedAtMs));
  const frames = [...events, ...tracker.end()].flatMap((e) => (e.type === 'frame' ? [e.frame] : []));
  const first = frames.find((f) => f.session !== undefined)!;
  runner = new SessionRunner({ feedId: feedId(file), sessionUid: first.sessionUid, session: first.session! });
  const onResult = (r: StepResult, f: Frame) => steps.push({ frameNumber: r.state.frameNumber, codes: f.events.map((e) => e.details.code), rewound: r.delta.rewound !== undefined });
  for (const f of frames.slice(frames.indexOf(first))) runner.apply(f, onResult);
  runner.end(onResult);
});

describe('qualifying-singapore-end: time over', () => {
  it('running (joined on the first frame the weekend phase is decided), then finished and the post-session, both from the SEND frame', () => {
    const weekendFrame = situationOf(runner.state).byMachine['weekend-phase']?.[0]?.startFrame;
    const send = steps.find((s) => s.codes.includes('SEND'))!.frameNumber;
    const spans = [...(runner.state.history.spans[MACHINE] ?? []), ...(situationOf(runner.state).byMachine[MACHINE] ?? [])];
    expect(spans.map((s: DeepReadonly<OpenSpan>) => [s.kind, s.startFrame, s.joinedAt === true])).toEqual([
      ['running', weekendFrame, true],
      ['finished', send, false],
      ['postSession', send, false],
    ]);
    expect(steps.filter((s) => s.rewound)).toEqual([]);
  });
});
