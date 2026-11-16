// The built-once coverage query (SP4.3c Task 25s, ruling R62, contract C26, C28): `coverageOf(source, machine, { carId?,
// keep? })` collects the spans of one sub-machine once, closed of the projection and open of the situation, and answers
// `(fromFrame, toFrame) => boolean`: whether a kept span covers at least one frame of `[fromFrame, toFrame)`. It has
// exactly `spansOverlapping`'s semantics, from frame numbers only: a closed span covers its open frame up to, not
// including, its close frame (a zero-length one covers none); an open span every frame from its first; an empty range
// covers nothing; `toFrame` may be `Infinity`. `carId` keeps that car's spans, `keep` the spans it accepts. It reads
// its source when it is built (or at its first answer), never again: a query reads no span.
import { carId as car, type CarId, type MachineId, type OpenSpan, type Span, type SpanDeclaration } from '@pitwall/domain';
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { coverageOf, spansOverlapping } from '../../src/log/projection.ts';
import type { DeepReadonly } from '../../src/util/deep-readonly.ts';
import { openSpan, span } from '../support/log-facts.ts';

vi.mock('../../../domain/src/situations/index.generated.ts', async (importOriginal) => {
  const { withTestSpans } = await import('../support/test-machines.ts');
  return withTestSpans(await importOriginal<{ SPAN_DECLARATIONS: readonly SpanDeclaration[] }>());
});

type Source = Parameters<typeof spansOverlapping>[0];
type Keep = (s: DeepReadonly<OpenSpan>) => boolean;

const KINDS = ['green', 'neutralised', 'pit', 'track'] as const;
const MACHINES: readonly MachineId[] = ['test-session', 'test-car'];
const CARS = 4;

/** What `coverageOf` must answer: `spansOverlapping` with the same filters, kept by `keep`, not empty. */
const reference = (source: Source, machine: MachineId, from: number, to: number, carId?: CarId, keep?: Keep): boolean =>
  spansOverlapping(source, from, to, machine, carId).filter((s) => keep === undefined || keep(s)).length > 0;

/** A generated span: its machine, kind, first frame, length in frames (0: zero-length), whether open, and its car. */
const spanArb = fc.record({
  machine: fc.constantFrom(...MACHINES),
  kind: fc.constantFrom(...KINDS),
  startFrame: fc.integer({ min: 0, max: 40 }),
  length: fc.integer({ min: 0, max: 8 }),
  open: fc.boolean(),
  car: fc.integer({ min: 0, max: CARS - 1 }),
});

/** The source of generated spans: the closed ones in the projection's `spans`, the open ones in the situation. */
type Generated = { machine: MachineId; kind: string; startFrame: number; length: number; open: boolean; car: number };
const sourceOf = (spans: readonly Generated[]): Source => {
  const closed: Record<MachineId, Span[]> = {};
  const open: Record<MachineId, OpenSpan[]> = {};
  spans.forEach((g, i) => {
    const carId = g.machine === 'test-car' ? car(g.car) : undefined;
    const frames = { startFrame: g.startFrame, ...(carId !== undefined && { carId }) };
    if (g.open) (open[g.machine] ??= []).push({ ...openSpan(g.machine, i, g.kind, g.startFrame * 100, frames) });
    else (closed[g.machine] ??= []).push(span(g.machine, i, g.kind, g.startFrame * 100, (g.startFrame + g.length) * 100, { ...frames, endFrame: g.startFrame + g.length }));
  });
  return { history: { spans: closed }, situation: { byMachine: open } };
};

/** A frame range: a start, and an end before it, on it (empty), shortly after it or `Infinity`. */
const rangeArb = fc.record({
  from: fc.integer({ min: -2, max: 55 }),
  to: fc.oneof(fc.integer({ min: -3, max: 16 }), fc.constant(Number.POSITIVE_INFINITY)),
}).map(({ from, to }) => ({ from, to: to === Number.POSITIVE_INFINITY ? to : from + to }));

/** The filters: a machine, a car or none, and a kind filter or none. */
const filterArb = fc.record({
  machine: fc.constantFrom(...MACHINES, 'undeclared'),
  car: fc.option(fc.integer({ min: 0, max: CARS }), { nil: undefined }),
  kinds: fc.option(fc.subarray([...KINDS]), { nil: undefined }),
});

describe('coverageOf (Task 25s, C26): spansOverlapping built once', () => {
  it('equals spansOverlapping(...).length > 0 with the same filters, for every span set and frame range (property)', () => {
    fc.assert(
      fc.property(fc.array(spanArb, { maxLength: 30 }), filterArb, fc.array(rangeArb, { minLength: 1, maxLength: 25 }), fc.boolean(), (spans, f, ranges, withSituation) => {
        const full = sourceOf(spans);
        const source: Source = withSituation ? full : { history: full.history };
        const carId = f.car === undefined ? undefined : car(f.car);
        const keep: Keep | undefined = f.kinds === undefined ? undefined : (s) => (f.kinds as readonly string[]).includes(s.kind);
        const covered = coverageOf(source, f.machine, { ...(carId !== undefined && { carId }), ...(keep !== undefined && { keep }) });
        for (const { from, to } of ranges) {
          expect(covered(from, to), `[${from}, ${to})`).toBe(reference(source, f.machine, from, to, carId, keep));
        }
      }),
      { numRuns: 500 },
    );
  });

  it('adjacent spans: one closing on frame n and the next opening on n leave no frame uncovered, and the edges hold', () => {
    const at = sourceOf([
      { machine: 'test-session', kind: 'green', startFrame: 5, length: 5, open: false, car: 0 },
      { machine: 'test-session', kind: 'neutralised', startFrame: 10, length: 4, open: false, car: 0 },
    ]);
    const covered = coverageOf(at, 'test-session');
    expect(covered(4, 5)).toBe(false);
    expect(covered(5, 6)).toBe(true);
    expect(covered(9, 11)).toBe(true);
    expect(covered(13, 14)).toBe(true);
    expect(covered(14, 20)).toBe(false);
    expect(covered(0, Infinity)).toBe(true);
    expect(covered(7, 7)).toBe(false);
    const neutralisedOnly = coverageOf(at, 'test-session', { keep: (s) => s.kind === 'neutralised' });
    expect(neutralisedOnly(9, 10)).toBe(false);
    expect(neutralisedOnly(9, 11)).toBe(true);
  });

  it('a zero-length closed span covers no frame; an open span covers every frame from its first', () => {
    const at = sourceOf([
      { machine: 'test-session', kind: 'green', startFrame: 5, length: 0, open: false, car: 0 },
      { machine: 'test-session', kind: 'neutralised', startFrame: 20, length: 0, open: true, car: 0 },
    ]);
    const covered = coverageOf(at, 'test-session');
    expect(covered(0, 19)).toBe(false);
    expect(covered(0, 21)).toBe(true);
    expect(covered(1_000, 1_001)).toBe(true);
    expect(covered(1_000, Infinity)).toBe(true);
  });

  it('per car: only that car’s spans of a car machine; without a car, every car’s', () => {
    const at = sourceOf([
      { machine: 'test-car', kind: 'pit', startFrame: 5, length: 3, open: false, car: 0 },
      { machine: 'test-car', kind: 'pit', startFrame: 20, length: 0, open: true, car: 1 },
    ]);
    expect(coverageOf(at, 'test-car', { carId: car(0) })(5, 6)).toBe(true);
    expect(coverageOf(at, 'test-car', { carId: car(0) })(20, 30)).toBe(false);
    expect(coverageOf(at, 'test-car', { carId: car(1) })(5, 8)).toBe(false);
    expect(coverageOf(at, 'test-car', { carId: car(1) })(25, 26)).toBe(true);
    expect(coverageOf(at, 'test-car', { carId: car(2) })(0, Infinity)).toBe(false);
    expect(coverageOf(at, 'test-car')(6, 7)).toBe(true);
    expect(coverageOf(at, 'test-car')(25, 26)).toBe(true);
  });

  it('is built once: after its first answer, no query reads the source’s spans again', () => {
    let reads = 0;
    const counted = <T extends object>(o: T): T =>
      new Proxy(o, {
        get(target, key, receiver) {
          reads++;
          const value = Reflect.get(target, key, receiver) as unknown;
          return Array.isArray(value) ? counted(value) : value;
        },
      });
    const plain = sourceOf(
      Array.from({ length: 40 }, (_, i) => ({ machine: 'test-car' as MachineId, kind: i % 2 === 0 ? 'pit' : 'track', startFrame: i * 3, length: 3, open: i === 39, car: i % CARS })),
    );
    const source: Source = { history: { spans: counted(plain.history.spans) }, situation: { byMachine: counted(plain.situation?.byMachine ?? {}) } };
    const covered = coverageOf(source, 'test-car', { carId: car(1), keep: (s) => s.kind === 'pit' });
    covered(0, 1);
    const afterFirst = reads;
    for (let f = 0; f < 1_000; f++) covered(f % 130, (f % 130) + 2);
    expect(reads).toBe(afterFirst);
  });
});
