// Sub-machines that exist only for the tests of the machine itself (registry, run, generic transition tests), one per
// scope plus one with an upstream; their tables are in `test-machines.transitions.ts`. Each declares its span kinds and
// scope as domain declares a sub-machine's (`spans`, C15); the tests put these declarations into a mocked domain index
// (`withTestSpans`), as they put the machines into a mocked registry. This module imports types only, so a `vi.mock`
// factory of the registry or of the domain index can import it without reaching either itself. Small on purpose: each
// follows one signal. Every sub-machine keeps the count of spans it opened (per car for the car one) in its open state,
// so a span's id is the number of spans opened before it and a rewind restores the count with the state (C26). A span
// opens with the frame number it opened on (`input.frameNumber`); step 2 sets the one it closes on (C9).
import type { CarId, FrameNumber, OpenSpan, Span, SpanDeclaration } from '@pitwall/domain';
import type { MachineInput, SubMachine } from '../../src/situations/machine.ts';
import type { DeepReadonly } from '../../src/util/deep-readonly.ts';

type Input = DeepReadonly<MachineInput>;
/**
 * A span with its detail. `SubMachine` types its spans as `OpenSpan`/`Span` with `detail: undefined` (Task 1), so the
 * machines here keep `Detailed` spans and hand them out as those types (`asOpen`, `asClosed`).
 */
type Detailed = OpenSpan<string, unknown>;
/** One scope's open span and the count of spans opened in it so far. */
type Slot = { span: Detailed | undefined; opened: number };

const NO_SLOT: Slot = { span: undefined, opened: 0 };
/** How long a SCAR deployment waits for the safety car status to confirm it. */
export const PENDING_MS = 3_000;

const asOpen = (spans: Detailed[]): OpenSpan[] => spans as OpenSpan[];
/** A closed span as a sub-machine hands it to step 2: without the frame it closed on (`MachineStep.closed`). */
type Closed = Omit<Span, 'endFrame'>;
const asClosed = (span: Detailed, end: number): Closed => ({ ...span, end }) as Closed;

/**
 * The slot after `kind` holds at `at` on frame `frame`: unchanged while the open span has that kind (with `confirmed`
 * and `detail` updated in place when given), else the open span closes at `at` and a span of `kind` opens with the next
 * id on `frame`. The first span of a slot opens as a join (`joinedAt`): the test machines open their first span on the
 * session's first frame.
 */
const follow = (
  slot: Slot,
  next: { machine: string; kind: string; at: number; frame: FrameNumber; carId?: CarId; zone?: number; confirmed?: boolean; detail?: unknown; renew?: boolean },
): { slot: Slot; closed: Closed[] } => {
  const { span } = slot;
  const confirmed = next.confirmed ?? true;
  if (span && span.kind === next.kind && next.renew !== true) {
    return span.confirmed === confirmed ? { slot, closed: [] } : { slot: { ...slot, span: { ...span, confirmed } }, closed: [] };
  }
  const opened: Detailed = {
    machine: next.machine,
    id: slot.opened,
    ...(next.carId !== undefined && { carId: next.carId }),
    ...(next.zone !== undefined && { zone: next.zone }),
    kind: next.kind,
    start: next.at,
    confirmed,
    ...(span === undefined && { joinedAt: true as const }),
    detail: next.detail,
    startFrame: next.frame,
  };
  return { slot: { span: opened, opened: slot.opened + 1 }, closed: span ? [asClosed(span, next.at)] : [] };
};

/** The span declarations of the test machines, as each would be in `packages/domain/src/situations/<id>.ts` (C15). */
export const sessionSpans: SpanDeclaration = { machine: 'test-session', scope: 'session', kinds: ['green', 'neutralised'] };
export const carSpans: SpanDeclaration = { machine: 'test-car', scope: 'car', kinds: ['track', 'pit'] };
export const zoneSpans: SpanDeclaration = { machine: 'test-zone', scope: 'zone', kinds: ['clear', 'yellow'] };
export const probeSpans: SpanDeclaration = { machine: 'test-probe', scope: 'session', kinds: ['seen'] };
export const raceOnlySpans: SpanDeclaration = { machine: 'test-race-only', scope: 'session', kinds: ['on'] };

/** Every test machine's span declaration, sorted by machine id as the generated domain index sorts them. */
export const TEST_SPAN_DECLARATIONS: readonly SpanDeclaration[] = [carSpans, probeSpans, raceOnlySpans, sessionSpans, zoneSpans];

/**
 * The domain index (`packages/domain/src/situations/index.generated.ts`) with the test machines' declarations added,
 * sorted by machine id: for a `vi.mock` factory of that index, which passes the original module (`importOriginal`).
 */
export const withTestSpans = <T extends { SPAN_DECLARATIONS: readonly SpanDeclaration[] }>(domain: T): T => ({
  ...domain,
  SPAN_DECLARATIONS: [...domain.SPAN_DECLARATIONS, ...TEST_SPAN_DECLARATIONS].sort((a, b) => (a.machine < b.machine ? -1 : a.machine > b.machine ? 1 : 0)),
});

const spansOf = (slots: readonly Slot[]): OpenSpan[] => asOpen(slots.flatMap((s) => (s.span ? [s.span] : [])));

/**
 * Session scope: `green`, or `neutralised` while the safety car status is SC or VSC. A SCAR deployment under green
 * opens a pending `neutralised` (`confirmed: false`, C18) that the status confirms; unconfirmed after `PENDING_MS` it
 * closes as it is and `green` opens. A confirmed neutralisation ends when the status is green again.
 */
export const sessionMachine: SubMachine<Slot> = {
  id: 'test-session',
  appliesTo: 'all',
  spans: sessionSpans,
  inputs: { signals: ['safetyCarStatus', 'events'], values: [], upstream: [] },
  transitions: [
    ['none', 'green'],
    ['none', 'neutralised'],
    ['green', 'neutralised'],
    ['neutralised', 'green'],
  ],
  init: () => NO_SLOT,
  openSpans: (slot) => spansOf([slot]),
  step(slot, input) {
    const status = input.signals.session.safetyCarStatus;
    const neutral = status === 'sc' || status === 'vsc';
    const deployed = input.signals.events.some((e) => e.code === 'SCAR' && e.stage === 'deployed');
    const at = input.at;
    const machine = 'test-session';
    const span = slot.span;
    let next: { kind: string; confirmed: boolean };
    if (span === undefined || span.kind === 'green') {
      next = neutral ? { kind: 'neutralised', confirmed: true } : deployed && span ? { kind: 'neutralised', confirmed: false } : { kind: 'green', confirmed: true };
    } else if (span.confirmed) {
      next = neutral ? { kind: 'neutralised', confirmed: true } : { kind: 'green', confirmed: true };
    } else {
      next = neutral ? { kind: 'neutralised', confirmed: true } : at - span.start > PENDING_MS ? { kind: 'green', confirmed: true } : { kind: 'neutralised', confirmed: false };
    }
    const r = follow(slot, { machine, at, frame: input.frameNumber, ...next });
    return { open: r.slot, closed: r.closed };
  },
};

/** Car scope: per car `track`, or `pit` while its pit status is not `none`. Span ids count per car. */
export const carMachine: SubMachine<{ cars: Slot[] }> = {
  id: 'test-car',
  appliesTo: 'all',
  spans: carSpans,
  inputs: { signals: ['pitStatus'], values: [], upstream: [] },
  transitions: [
    ['none', 'track'],
    ['none', 'pit'],
    ['track', 'pit'],
    ['pit', 'track'],
  ],
  init: () => ({ cars: [] }),
  openSpans: (open) => spansOf(open.cars),
  step(open, input) {
    const results = input.signals.cars.map((car, i) =>
      follow(open.cars[i] ?? NO_SLOT, { machine: 'test-car', kind: car.pitStatus === 'none' ? 'track' : 'pit', at: input.at, frame: input.frameNumber, carId: i as CarId }),
    );
    return { open: { cars: results.map((r) => r.slot) }, closed: results.flatMap((r) => r.closed) };
  },
};

/** Zone scope: per marshal zone `clear`, or `yellow` while its flag is yellow (`zone` names the zone). Span ids count per machine. */
export const zoneMachine: SubMachine<{ zones: Array<Detailed | undefined>; opened: number }> = {
  id: 'test-zone',
  appliesTo: 'all',
  spans: zoneSpans,
  inputs: { signals: ['marshalZones'], values: [], upstream: [] },
  transitions: [
    ['none', 'clear'],
    ['none', 'yellow'],
    ['clear', 'yellow'],
    ['yellow', 'clear'],
  ],
  init: () => ({ zones: [], opened: 0 }),
  openSpans: (open) => asOpen(open.zones.flatMap((s) => (s ? [s] : []))),
  step(open, input) {
    const zones = [...open.zones];
    const closedSpans: Closed[] = [];
    let opened = open.opened;
    input.signals.session.marshalZones.forEach((z, zone) => {
      const r = follow({ span: zones[zone], opened }, { machine: 'test-zone', kind: z.flag === 'yellow' ? 'yellow' : 'clear', at: input.at, frame: input.frameNumber, zone });
      zones[zone] = r.slot.span;
      opened = r.slot.opened;
      closedSpans.push(...r.closed);
    });
    return { open: { zones, opened }, closed: closedSpans };
  },
};

/** What the probe saw of its input on the frame its span opened. */
export type ProbeDetail = { at: number; frameId: number; frameNumber: FrameNumber; clock: MachineInput['clock']; upstream: string[] };

/**
 * Session scope, upstream `test-session`: a new `seen` span every frame, whose detail is what the frame's input held
 * (its time, its id and number, the clock's state and the kinds of the upstream's open spans).
 */
export const probeMachine: SubMachine<Slot> = {
  id: 'test-probe',
  appliesTo: 'all',
  spans: probeSpans,
  inputs: { signals: [], values: [], upstream: ['test-session'] },
  transitions: [
    ['none', 'seen'],
    ['seen', 'seen'],
  ],
  init: () => NO_SLOT,
  openSpans: (slot) => spansOf([slot]),
  step(slot, input: Input) {
    const detail: ProbeDetail = {
      at: input.at,
      frameId: input.frameId,
      frameNumber: input.frameNumber,
      clock: { ...input.clock },
      upstream: (input.upstream['test-session'] ?? []).map((s) => s.kind),
    };
    const r = follow(slot, { machine: 'test-probe', kind: 'seen', at: input.at, frame: input.frameNumber, detail, renew: true });
    return { open: r.slot, closed: r.closed };
  },
};

/** Session scope, race only: `on` from its first frame. It never runs while the weekend phase is pending (C14). */
export const raceOnlyMachine: SubMachine<Slot> = {
  id: 'test-race-only',
  appliesTo: ['race'],
  spans: raceOnlySpans,
  inputs: { signals: [], values: [], upstream: [] },
  transitions: [['none', 'on']],
  init: () => NO_SLOT,
  openSpans: (slot) => spansOf([slot]),
  step(slot, input) {
    const r = follow(slot, { machine: 'test-race-only', kind: 'on', at: input.at, frame: input.frameNumber });
    return { open: r.slot, closed: r.closed };
  },
};

/** The test machines the generic tests run besides the registered ones (`MACHINES`), each with its upstream before it. */
export const TEST_MACHINES: ReadonlyArray<SubMachine<unknown>> = [sessionMachine, carMachine, zoneMachine, probeMachine];
