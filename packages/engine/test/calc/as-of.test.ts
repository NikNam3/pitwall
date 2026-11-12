// The "as of frame N" forms (SP4.3a spec 6.1, plan Task 3, review P1 and P2; C39): `asOfNow` gives the current view
// without a cut, `runAsOf` runs several units' forms in dependency order with each one's output in the next one's
// `outputs`, and `asOfStored` gives a stored session's whole projection (frame `'now'`), so a profile aggregate can run
// the forms over a stored session (C62c).
import { describe, expect, it } from 'vitest';
import { carId, known, unknown, type FrameNumber, type OpenSpan, type SessionUid, type Span, type TrackData } from '@pitwall/domain';
import { history } from '../../../../test-support/builders/index.ts';
import { asOfNow, asOfStored, runAsOf, type AsOfUnit, type AsOfView, type DeepReadonly, type EngineState, type StoredDriverSession } from '../../src/index.ts';
import type { Projection } from '../../src/log/types.ts';
import { situationOf } from '../../src/situations/run.ts';
import type { Situation } from '../../src/situations/situation.ts';
import { gridStart, run, script } from '../situations/script.ts';
import { viewOf } from '../support/scheduler.ts';

/** An as-of view of an empty race, with `outputs` before the units. */
const viewWith = (outputs: AsOfView['outputs'] = new Map()): AsOfView => ({
  fixed: { totalLaps: unknown('notReceived'), playerCar: unknown('notReceived'), teammateCar: unknown('notReceived'), aiDifficulty: unknown('notReceived'), setsNow: null, weatherNow: null },
  history: history(),
  situation: { weekendPhase: { kind: 'race', format: 'grandPrix' }, byMachine: {} },
  frame: 'now',
  at: 0,
  config: {},
  priors: unknown('notApplicable'),
  drivers: [],
  track: unknown('notApplicable'),
  weekend: undefined,
  outputs,
});

describe('asOfNow', () => {
  it('asOfNow is the current view without a cut: its projection, situation, fixed inputs and outputs, frame now', () => {
    const view = { ...viewOf(run(script(gridStart(10))).results.at(-1)!), outputs: new Map([['a', 1]]) };
    const now = asOfNow(view);
    expect(now.frame).toBe('now');
    expect(now.history).toBe(view.history);
    expect(now.situation).toBe(view.situation);
    expect(now.at).toBe(view.live.sessionTime);
    expect([now.config, now.priors, now.drivers, now.track, now.weekend]).toEqual([view.config, view.priors, view.drivers, view.track, view.weekend]);
    expect(now.outputs.get('a')).toBe(1);
  });
});

describe('runAsOf (P2)', () => {
  it('runAsOf feeds each unit the outputs of the units before it', () => {
    const seen: Record<string, unknown> = {};
    const first: AsOfUnit = { id: 'first', reads: ['laps'], asOf: () => 41 };
    const second: AsOfUnit = {
      id: 'second',
      reads: ['laps', { calculator: 'first' }],
      asOf: (v) => {
        seen['second'] = v.outputs.get('first');
        return (v.outputs.get('first') as number) + 1;
      },
    };
    // given in the wrong order: the order comes from `reads`
    const outputs = runAsOf([second, first], viewWith());
    expect(seen['second']).toBe(41);
    expect(outputs.get('first')).toBe(41);
    expect(outputs.get('second')).toBe(42);
  });

  it('runAsOf: a chain of three in any given order, each sees its upstream; the view\'s own outputs are visible too', () => {
    const units: AsOfUnit[] = [
      { id: 'c', reads: [{ calculator: 'b' }], asOf: (v) => `${v.outputs.get('b') as string}c` },
      { id: 'a', reads: [{ calculator: 'given' }], asOf: (v) => `${v.outputs.get('given') as string}a` },
      { id: 'b', reads: [{ calculator: 'a' }], asOf: (v) => `${v.outputs.get('a') as string}b` },
    ];
    const outputs = runAsOf(units, viewWith(new Map([['given', '>']])));
    expect([outputs.get('a'), outputs.get('b'), outputs.get('c')]).toEqual(['>a', '>ab', '>abc']);
  });

  it('runAsOf hands every unit the same cut: projection, situation and frame', () => {
    const view = { ...viewWith(), frame: 17 };
    const views: AsOfView[] = [];
    runAsOf(
      [
        { id: 'a', reads: [], asOf: (v) => views.push(v) },
        { id: 'b', reads: [{ calculator: 'a' }], asOf: (v) => views.push(v) },
      ],
      view,
    );
    expect(views).toHaveLength(2);
    for (const v of views) expect([v.history, v.situation, v.frame, v.at]).toEqual([view.history, view.situation, 17, view.at]);
  });
});

describe('asOfStored', () => {
  it("asOfStored gives the whole stored projection with frame 'now'", () => {
    const projection = history({ laps: [], spans: { 'car-driver': [] } });
    const track = known({} as TrackData, 0);
    const session: StoredDriverSession = {
      session: { sessionUid: '7' as SessionUid, weekendId: 'w', feedCar: carId(0) },
      carId: carId(3),
      startedAt: '2026-11-05T19:00:00Z',
      phase: { kind: 'race', format: 'grandPrix' },
      aiDifficulty: known(95, 0),
      totalLaps: known(50, 0),
      projection,
      humanSpans: [{ startFrame: 1 }],
      track,
    };
    const config = { 'driver-noise': { shrinkLaps: 8 } };
    const v = asOfStored(session, { config, overrides: {} });
    expect(v.frame).toBe('now');
    expect(v.history).toBe(projection);
    // every span of a stored session is closed (C34): nothing open, the session's weekend phase
    expect(v.situation).toEqual({ weekendPhase: session.phase, byMachine: {} });
    expect(v.config).toBe(config);
    expect(v.track).toBe(track);
    expect(v.weekend).toBeUndefined();
    expect([...v.outputs.keys()]).toEqual([]);
  });
});

// SP4.3a Task 3b (C20, C26, C28, C62c): a stored session's log is complete, every span closed (C18); its as-of view's
// situation is the situation as of the session's last frame: per sub-machine the spans covering it, presented open
// (without `end`/`endFrame`), as `projectionAsOf` presents a span still open at N.
describe('asOfStored: the situation at the session\'s end (Task 3b)', () => {
  const storedOf = (projection: Projection, phase: StoredDriverSession['phase'] = { kind: 'race', format: 'grandPrix' }): StoredDriverSession => ({
    session: { sessionUid: '7' as SessionUid, weekendId: 'w', feedCar: carId(0) },
    carId: carId(0),
    startedAt: '2026-11-05T19:00:00Z',
    phase,
    aiDifficulty: known(95, 0),
    totalLaps: known(50, 0),
    projection,
    humanSpans: [{ startFrame: 1 }],
    track: unknown('notApplicable'),
  });

  /** A closed car-status span. */
  const carStatus = (id: number, car: number, kind: string, startFrame: FrameNumber, endFrame: FrameNumber): Span => ({
    machine: 'car-status',
    id,
    carId: carId(car),
    kind,
    start: startFrame * 16,
    end: endFrame * 16,
    confirmed: true,
    detail: {},
    startFrame,
    endFrame,
  });

  /** A span as it stood open: without the end and the frame it closed on. */
  const opened = (span: DeepReadonly<OpenSpan & { end?: number; endFrame?: FrameNumber }>) => {
    const { end: _end, endFrame: _endFrame, ...rest } = span;
    return rest;
  };

  it('asOfStored opens the spans that cover the session\'s last frame', () => {
    // car 0: competing, then retired until the end; car 1: competing until the end; the session closed on frame 100
    const c0first = carStatus(0, 0, 'competing', 1, 40);
    const c0last = carStatus(1, 0, 'retired', 40, 100);
    const c1only = carStatus(0, 1, 'competing', 1, 100);
    const projection = history({ spans: { 'car-status': [c0first, c1only, c0last] } });
    const session = storedOf(projection);
    const v = asOfStored(session, { config: {}, overrides: {} });

    const open = v.situation.byMachine['car-status'] ?? [];
    expect(open).toHaveLength(2);
    expect(open).toContainEqual(opened(c0last));
    expect(open).toContainEqual(opened(c1only));
    expect(open).not.toContainEqual(opened(c0first));
    // presented open: no end, no end frame
    for (const s of open) expect(Object.keys(s)).not.toEqual(expect.arrayContaining(['end']));
    for (const s of open) expect(Object.keys(s)).not.toEqual(expect.arrayContaining(['endFrame']));
    // history stays the whole projection, frame 'now', the session's weekend phase
    expect(v.history).toBe(projection);
    expect(v.frame).toBe('now');
    expect(v.situation.weekendPhase).toEqual(session.phase);
  });

  it('asOfStored of a projection without spans has an empty situation', () => {
    const session = storedOf(history());
    const v = asOfStored(session, { config: {}, overrides: {} });
    expect(v.situation).toEqual({ weekendPhase: session.phase, byMachine: {} });
    expect(v.frame).toBe('now');
  });

  it('the stored situation equals the live situation at the last frame of a run', () => {
    const { runner } = run(script(gridStart(30)));
    // the live situation after the last applied frame, before the session closes
    const live = structuredClone(situationOf(runner.state as EngineState));
    runner.finish();
    const projection = structuredClone(runner.state.history) as Projection;
    const v = asOfStored(storedOf(projection), { config: {}, overrides: {} });

    // compared as `projection-as-of` compares a cut's situation with the run's: by identity and kind, machines with
    // no open span left out (an empty list and a missing machine say the same)
    const ordered = <S extends { id: number; carId?: number; zone?: number }>(spans: readonly S[]): S[] =>
      [...spans].sort((a, b) => (a.carId ?? -1) - (b.carId ?? -1) || (a.zone ?? -1) - (b.zone ?? -1) || a.id - b.id);
    const identity = (byMachine: Situation['byMachine']) =>
      Object.fromEntries(
        Object.entries(byMachine)
          .filter(([, spans]) => spans.length > 0)
          .map(([m, spans]) => [m, ordered(spans).map((s) => [s.id, s.carId, s.zone, s.kind, s.startFrame])]),
      );
    expect(Object.keys(identity(live.byMachine))).toContain('car-status');
    expect(identity(v.situation.byMachine)).toEqual(identity(live.byMachine));
    // each open span as it stood open
    for (const [machine, spans] of Object.entries(live.byMachine))
      for (const s of spans) expect(v.situation.byMachine[machine], machine).toContainEqual(s);
  });
});
