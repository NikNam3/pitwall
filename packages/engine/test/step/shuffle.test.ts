// C11: no coupling within a step. A module of step 1 (`STATE_UPDATE`) or of step 3 (`RECORDERS`) reads only its
// step's inputs and its own open state, so the modules of each step run in any order with the same result. Step 2's
// sub-machine order is the declared exception (C15) and is not shuffled. Real data: three committed segments.
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { feedId, type FeedId } from '@pitwall/domain';
import type { Packet } from '@pitwall/protocol';
import { initialState, SessionTracker, step, type EngineState, type Frame, type StepOutput } from '../../src/index.ts';
import { RECORDERS, STATE_UPDATE } from '../../src/step/step.ts';
import { segmentPackets } from '../../../../test-support/segments.ts';
import { inOrder } from '../support/module-order.ts';

const SEGMENTS = ['race-zandvoort-pit-stop', 'race-singapore-start', 'practice-wing-change'] as const;
type Segment = (typeof SEGMENTS)[number];

type Received = Array<{ packet: Packet; receivedAtMs: number }>;
const packets = new Map<Segment, Received>();

beforeAll(async () => {
  for (const segment of SEGMENTS) packets.set(segment, await segmentPackets(`${segment}.pwrec.gz`));
});

/** The segment's frames, assembled afresh for every run so no run sees what an earlier one did to its frames. */
const framesOf = (segment: Segment): Frame[] => {
  const tracker = new SessionTracker({ feedId: feedId(segment) });
  const events = packets.get(segment)!.flatMap(({ packet, receivedAtMs }) => tracker.push(packet, receivedAtMs));
  return [...events, ...tracker.end()].flatMap((e) => (e.type === 'frame' ? [e.frame] : []));
};

/** A step's output with its tag set as a sorted list: the set's insertion order is the order the modules ran in. */
const outputOf = ({ changed, ...rest }: StepOutput) => ({ ...rest, changed: [...changed].sort() });

type Run = { state: EngineState; outputs: Array<ReturnType<typeof outputOf>> };

/** Steps the segment's session from its first frame that carries a Session packet: the whole state and every output. */
const run = (segment: Segment, realism: boolean): Run => {
  const frames = framesOf(segment);
  const first = frames.findIndex((f) => f.session !== undefined);
  const { sessionUid, session } = frames[first]!;
  const state = initialState({ feedId: segment as FeedId, sessionUid, session: session!, realism });
  const outputs = frames.slice(first).filter((f) => f.sessionUid === sessionUid).map((f) => outputOf(step(state, f)));
  return { state, outputs };
};

describe('the step modules', () => {
  it('each step-1 and step-3 module has an id of its own', () => {
    const ids = [...STATE_UPDATE, ...RECORDERS].map((m) => m.id);
    expect(STATE_UPDATE.length).toBeGreaterThan(0);
    expect(RECORDERS.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe.each(SEGMENTS)('%s', (segment) => {
  it('the modules of step 1 and of step 3 in shuffled order give identical state, log and step output', () => {
    const canonical = new Map<boolean, Run>();
    const straight = (realism: boolean): Run => {
      if (!canonical.has(realism)) canonical.set(realism, run(segment, realism));
      return canonical.get(realism)!;
    };
    const permutation = <T,>(modules: readonly T[]) => fc.shuffledSubarray([...modules], { minLength: modules.length, maxLength: modules.length });
    fc.assert(
      fc.property(permutation(STATE_UPDATE), permutation(RECORDERS), fc.boolean(), (updates, recorders, realism) => {
        const expected = straight(realism);
        const shuffled = inOrder(STATE_UPDATE, updates, () => inOrder(RECORDERS, recorders, () => run(segment, realism)));
        expect(shuffled.state).toEqual(expected.state);
        expect(shuffled.outputs).toEqual(expected.outputs);
      }),
      { numRuns: 20 },
    );
  });
});
