// The exact span-range query (SP4.3c Task 4c, contract C20, C26, C28): `spansOverlapping(source, fromFrame, toFrame,
// machine?, carId?)` gives every visible span, closed in the projection or open in the situation, that covers at least
// one frame of the half-open range `[fromFrame, toFrame)`, from frame numbers only. A span covers the frames from the one
// it opened on up to, not including, the one it closed on; an open span every frame from its first. `machine` keeps
// that sub-machine's spans only, `carId` that car's spans only. The result is a flat list; its order is not pinned
// (the tests sort it). It is readers' API (`@pitwall/engine/readers`), next to `situationAt` and `membershipOf`. The
// test machines' declarations come from `test/support/test-machines.ts`, as in `membership.test.ts`.
import { carId as car, type OpenSpan, type SpanDeclaration } from '@pitwall/domain';
import { describe, expect, it, vi } from 'vitest';
import { createLog, logWriter } from '../../src/log/log.ts';
import { ProjectionTracker } from '../../src/log/projection.ts';
import { situationAt, spansOverlapping, type MembershipSource } from '../../src/readers.ts';
import type { DeepReadonly } from '../../src/util/deep-readonly.ts';
import { openSpan, situation, span } from '../support/log-facts.ts';

vi.mock('../../../domain/src/situations/index.generated.ts', async (importOriginal) => {
  const { withTestSpans } = await import('../support/test-machines.ts');
  return withTestSpans(await importOriginal<{ SPAN_DECLARATIONS: readonly SpanDeclaration[] }>());
});

// The session green over frames 5-9 (closed on 10), neutralised from 10 (open). Car 0 on track over frames 1-4 (closed
// on 5), in the pit lane from 5 (open); car 1 on track from 1 (open). Zone 0 yellow over frames 3-7 (closed on 8).
const green = span('test-session', 0, 'green', 400, 900, { startFrame: 5, endFrame: 10 });
const neutralised = openSpan('test-session', 1, 'neutralised', 900, { startFrame: 10 });
const carZeroTrack = span('test-car', 0, 'track', 0, 400, { startFrame: 1, endFrame: 5, carId: car(0) });
const carZeroPit = openSpan('test-car', 1, 'pit', 400, { startFrame: 5, carId: car(0) });
const carOneTrack = openSpan('test-car', 0, 'track', 0, { startFrame: 1, carId: car(1) });
const yellow = { ...span('test-zone', 0, 'yellow', 200, 700, { startFrame: 3, endFrame: 8 }), zone: 0 };

/** The view's two sources of spans: the projection of a log holding the closed spans, and the situation of the open ones. */
const source = (): MembershipSource => {
  const log = createLog();
  const writer = logWriter(log);
  writer.append('spans:test-session', green);
  writer.append('spans:test-car', carZeroTrack);
  writer.append('spans:test-zone', yellow);
  const open = situation(neutralised, carZeroPit, carOneTrack);
  const tracker = new ProjectionTracker(log);
  tracker.update(open);
  return { history: tracker.projection, situation: open };
};

/** The spans in a fixed order (machine, car, first frame), so the query's own order does not matter. */
const sorted = (spans: readonly DeepReadonly<OpenSpan>[]) =>
  [...spans].sort((a, b) => a.machine.localeCompare(b.machine) || (a.carId ?? -1) - (b.carId ?? -1) || a.startFrame - b.startFrame);

/** The session's spans of the query, the only ones a range of `test-session` gives. */
const session = (at: MembershipSource, from: number, to: number) => sorted(spansOverlapping(at, from, to, 'test-session'));

describe('spansOverlapping (Task 4c, C26): every span covering a frame of [fromFrame, toFrame)', () => {
  it("a closed span: a range ending on its first frame misses it; one touching its first frame finds it", () => {
    const at = source();
    expect(session(at, 1, 5)).toEqual([]);
    expect(session(at, 1, 6)).toEqual([green]);
    expect(session(at, 5, 6)).toEqual([green]);
  });

  it('a range touching its last covered frame finds it; one starting on its closing frame (not covered) misses it', () => {
    const at = source();
    expect(session(at, 9, 10)).toEqual([green]);
    expect(session(at, 9, 12)).toEqual([green, neutralised]);
    // frame 10: green closed on it, so only neutralised (opened on it) covers it
    expect(session(at, 10, 12)).toEqual([neutralised]);
  });

  it('a range lying inside a span finds it; a span lying wholly inside the range is found', () => {
    const at = source();
    expect(session(at, 6, 8)).toEqual([green]);
    expect(session(at, 7, 8)).toEqual([green]);
    expect(sorted(spansOverlapping(at, 2, 9, 'test-zone'))).toEqual([yellow]);
    expect(session(at, 0, 20)).toEqual([green, neutralised]);
  });

  it('an open span covers every frame from its first: a range before it misses it, any range from it on finds it', () => {
    const at = source();
    expect(session(at, 0, 10).filter((s) => s.kind === 'neutralised')).toEqual([]);
    expect(session(at, 12, 15)).toEqual([neutralised]);
    expect(session(at, 1_000, 1_001)).toEqual([neutralised]);
  });

  it('an empty range covers no frame and finds nothing', () => {
    const at = source();
    expect(spansOverlapping(at, 7, 7)).toEqual([]);
    expect(spansOverlapping(at, 12, 12)).toEqual([]);
  });

  it('a range open to the end (toFrame Infinity) finds every span covering a frame from fromFrame on', () => {
    const at = source();
    expect(session(at, 9, Infinity)).toEqual([green, neutralised]);
    expect(session(at, 10, Infinity)).toEqual([neutralised]);
  });

  it('without a machine, every machine’s spans, closed and open, the zone’s and every car’s included', () => {
    const at = source();
    expect(sorted(spansOverlapping(at, 4, 6))).toEqual(sorted([green, carZeroTrack, carZeroPit, carOneTrack, yellow]));
    expect(sorted(spansOverlapping(at, 0, 1))).toEqual([]);
  });

  it('per machine: only that sub-machine’s spans', () => {
    const at = source();
    expect(sorted(spansOverlapping(at, 4, 6, 'test-car'))).toEqual(sorted([carZeroTrack, carZeroPit, carOneTrack]));
    expect(spansOverlapping(at, 4, 6, 'undeclared')).toEqual([]);
  });

  it('per car: only that car’s spans of the machine, closed and open', () => {
    const at = source();
    expect(sorted(spansOverlapping(at, 4, 6, 'test-car', car(0)))).toEqual([carZeroTrack, carZeroPit]);
    expect(sorted(spansOverlapping(at, 1, 5, 'test-car', car(0)))).toEqual([carZeroTrack]);
    expect(sorted(spansOverlapping(at, 5, 9, 'test-car', car(0)))).toEqual([carZeroPit]);
    expect(sorted(spansOverlapping(at, 4, 6, 'test-car', car(1)))).toEqual([carOneTrack]);
    expect(spansOverlapping(at, 4, 6, 'test-car', car(2))).toEqual([]);
  });

  it('a stored projection has closed spans only: the query finds them alone', () => {
    const { history } = source();
    expect(sorted(spansOverlapping({ history }, 4, 6))).toEqual(sorted([green, carZeroTrack, yellow]));
    expect(spansOverlapping({ history }, 10, 20)).toEqual([]);
  });

  it('agrees with situationAt on every one-frame range (the same coverage, C26)', () => {
    const at = source();
    for (let frame = 0; frame <= 12; frame++) {
      const expected = Object.values(situationAt(at, frame)).flat();
      expect(sorted(spansOverlapping(at, frame, frame + 1)), `frame ${frame}`).toEqual(sorted(expected));
    }
  });
});
