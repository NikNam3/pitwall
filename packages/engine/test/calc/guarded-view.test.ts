// The guarded view (C41): in tests each unit gets a view that throws on any read it does not declare. Membership
// (`situationAt`, `membershipOf`) reads the projection and the situation as a whole; `openSpansOf` reads one
// sub-machine's spans (ruling 4). The situation and the projection are handed out read-only (ruling 6).
import { describe, expect, it } from 'vitest';
import { known, type CarId } from '@pitwall/domain';
import {
  ALL_CHANGE_TAGS,
  membershipOf,
  openSpansOf,
  SessionRunner,
  situationAt,
  type ChangeTag,
  type Dependency,
  type EngineView,
  type StepResult,
} from '../../src/index.ts';
import { gridStart, run, script } from '../situations/script.ts';
import { UndeclaredReadError } from '../support/guarded-input.ts';
import { initFor } from '../support/run.ts';
import { guardedView, input, inputOf, quick, sched, viewOf } from '../support/scheduler.ts';

/** A race 60 frames after lights out, viewed after its last frame, with an output of unit `a` before the reader. */
const raceView = (): EngineView => {
  const { results } = run(script(gridStart(60)));
  return { ...viewOf(results.at(-1)!), outputs: new Map([['a', 1], ['b', 2]]) };
};

/** The path an undeclared read names, or `undefined` when `read` passes. */
const undeclared = (read: () => unknown): string | undefined => {
  try {
    read();
    return undefined;
  } catch (error) {
    if (error instanceof UndeclaredReadError) return error.path;
    throw error;
  }
};

const guardedBy = (reads: Dependency[], view = raceView()) => guardedView(view, reads, { unit: 'probe' });

describe('guardedView throws on an undeclared read and passes a declared one (C41)', () => {
  it('live: a car area by the fields its step-1 module writes; the cars only with a car area', () => {
    const view = raceView();
    const g = guardedBy(['timing'], view);
    expect(g.live.cars[1]!.timing).toEqual(view.live.cars[1]!.timing);
    expect(undeclared(() => g.live.cars[1]!.tyres)).toBe('live.cars[1].tyres');
    expect(undeclared(() => g.live.session)).toBe('live.session');
    expect(undeclared(() => g.live.playerCar)).toBe('live.playerCar');
    expect(guardedBy(['session'], view).live.session).toEqual(view.live.session);
    expect(guardedBy(['identity'], view).live.playerCar).toBe(view.live.playerCar);
    expect(guardedBy(['dynamics'], view).live.cars[0]!.motion).toEqual(view.live.cars[0]!.motion);
    expect(undeclared(() => guardedBy(['session'], view).live.cars)).toBe('live.cars');
  });

  // Task 24: `car.active` left the live state (car-status decides which cars are in the session, C43)
  it('live: a car\'s slot and freshness with any car area; the feed, session uid, race clock, last frame id and realism always', () => {
    const view = raceView();
    const car = guardedBy(['tyres'], view).live.cars[0]!;
    expect([car.id, car.updatedAt]).toEqual([view.live.cars[0]!.id, view.live.cars[0]!.updatedAt]);
    const g = guardedBy([], view);
    expect([g.live.feedId, g.live.sessionUid, g.live.sessionTime, g.live.lastFrameId, g.live.realism]).toEqual([
      view.live.feedId, view.live.sessionUid, view.live.sessionTime, view.live.lastFrameId, view.live.realism,
    ]);
  });

  it('live: nothing else the engine state holds is readable, whatever is declared (C13, C28)', () => {
    const g = guardedBy([...ALL_CHANGE_TAGS, 'feed']) as unknown as { live: Record<string, unknown> };
    for (const field of ['open', 'log', 'signals', 'history', 'weekend', 'frameNumber', 'masking', 'frameEvents']) {
      expect(undeclared(() => g.live[field]), field).toBe(`live.${field}`);
    }
  });

  it('history: a list only with its change tag (crossings with miniSectors)', () => {
    const view = raceView();
    expect(guardedBy(['laps'], view).history.laps).toEqual(view.history.laps);
    expect(guardedBy(['miniSectors'], view).history.crossings).toEqual(view.history.crossings);
    expect(guardedBy(['clock'], view).history.clock).toEqual(view.history.clock);
    expect(guardedBy(['decisions'], view).history.decisions).toEqual(view.history.decisions);
    const g = guardedBy(['timing'], view);
    expect(undeclared(() => g.history.decisions)).toBe('history.decisions');
    expect(undeclared(() => g.history.laps)).toBe('history.laps');
    expect(undeclared(() => g.history.crossings)).toBe('history.crossings');
    expect(undeclared(() => g.history.events)).toBe('history.events');
  });

  it('history.spans and situation.byMachine: a sub-machine\'s closed or open spans only with its spans:<id>; the weekend phase always', () => {
    const view = raceView();
    const tag = 'spans:session-phase-race' as ChangeTag;
    const g = guardedBy([tag], view);
    expect(view.history.spans['session-phase-race']?.length).toBeGreaterThan(0);
    expect(g.history.spans['session-phase-race']).toEqual(view.history.spans['session-phase-race']);
    expect(g.situation.byMachine['session-phase-race']).toEqual(view.situation.byMachine['session-phase-race']);
    expect(g.situation.weekendPhase).toEqual(view.situation.weekendPhase);
    expect(undeclared(() => g.history.spans['clock'])).toBe('history.spans.clock');
    expect(undeclared(() => g.situation.byMachine['car-location'])).toBe('situation.byMachine.car-location');
  });

  it('openSpansOf is a read of that sub-machine (its spans:<id>), for every car or one', () => {
    const view = raceView();
    const g = guardedBy(['spans:car-location' as ChangeTag], view);
    expect(openSpansOf(g, 'car-location')).toEqual(openSpansOf(view, 'car-location'));
    expect(openSpansOf(g, 'car-location', 1 as CarId)).toEqual(openSpansOf(view, 'car-location', 1 as CarId));
    expect(undeclared(() => openSpansOf(g, 'car-status', 1 as CarId))).toBe('situation.byMachine.car-status');
    expect(undeclared(() => openSpansOf(guardedBy([], view), 'car-location'))).toBe('situation.byMachine.car-location');
  });

  it('outputs: a declared unit\'s output only, never the whole map', () => {
    const g = guardedBy([{ calculator: 'a' }]);
    expect(g.outputs.get('a')).toBe(1);
    expect(g.outputs.has('a')).toBe(true);
    expect(undeclared(() => g.outputs.get('b'))).toBe('outputs.b');
    expect(undeclared(() => g.outputs.has('b'))).toBe('outputs.b');
    expect(undeclared(() => [...g.outputs])).toBe('outputs');
    expect(undeclared(() => g.outputs.size)).toBe('outputs');
  });

  it('feed only with `feed`', () => {
    const view = raceView();
    expect(guardedBy(['feed'], view).feed.connected).toBe(view.feed.connected);
    expect(undeclared(() => guardedBy(['timing'], view).feed.connected)).toBe('feed.connected');
  });

  it('delta, changed, weekend, config and track are every unit\'s', () => {
    const view = { ...raceView(), config: { k: { a: 1 } } };
    const g = guardedBy([], view);
    expect([g.delta, [...g.changed], g.weekend, g.config, g.track]).toEqual([view.delta, [...view.changed], view.weekend, view.config, view.track]);
  });

  // Generic: every unit the harness, the analysis and the bridge completeness tests run gets this guard (C87), so a
  // registered unit that reads the priors without declaring `decisions` fails there.
  it('the guarded view throws on view.priors without decisions in reads (C41, C62a)', () => {
    const view = { ...raceView(), priors: known({ fingerprint: 'f', setId: 's', setName: 'S', sources: 1, entries: {} }, 0) };
    expect(guardedBy(['decisions'], view).priors).toEqual(view.priors);
    expect(undeclared(() => guardedBy([], view).priors)).toBe('priors');
    expect(undeclared(() => guardedBy([...ALL_CHANGE_TAGS.filter((t) => t !== 'decisions'), 'feed'], view).priors)).toBe('priors');
    const s = sched([
      quick('with', { reads: ['decisions'], compute: (v) => v.priors.known }),
      quick('without', { reads: ['timing'], compute: (v) => v.priors.known }),
    ]);
    const result = s.run(input(0, ['timing', 'decisions']));
    expect(result.ran).toEqual(['with']);
    expect(result.outputs.get('with')).toBe(false);
    expect(result.errors.map((e) => [e.id, e.error instanceof UndeclaredReadError && e.error.path])).toEqual([['without', 'priors']]);
  });

  it('the error names the unit, the path and C41', () => {
    expect(() => guardedView(raceView(), ['timing'], { unit: 'gaps' }).history.laps).toThrow(/gaps reads history\.laps, which it does not declare \(C41\)/);
  });
});

/** What membership matches of a span (C26): its machine, id, car, zone and frames; nothing else is read. */
const identity = (s: { machine: string; id: number; carId?: number; zone?: number; startFrame: number; endFrame?: number }) =>
  [s.machine, s.id, s.carId, s.zone, s.startFrame, s.endFrame];
const identities = (byMachine: Readonly<Record<string, readonly unknown[]>>) =>
  Object.fromEntries(Object.entries(byMachine).map(([m, spans]) => [m, (spans as Parameters<typeof identity>[0][]).map(identity)]));

describe('membership on a guarded view needs no declaration in what it matches (ruling 4, F1)', () => {
  it('situationAt and membershipOf pass whatever the unit declares, match what they match on the view, and count as reads of history and situation', () => {
    const view = raceView();
    const noted: string[] = [];
    const g = guardedView(view, ['timing'], { unit: 'probe', onRead: (path) => noted.push(path) });
    for (const frame of [1, 30, 61, 100]) {
      expect(identities(situationAt(g, frame)), `frame ${frame}`).toEqual(identities(situationAt(view, frame)));
      const member = membershipOf(g, { frame, carId: 1 as CarId });
      expect(Object.keys(member), `frame ${frame}`).toEqual(Object.keys(membershipOf(view, { frame, carId: 1 as CarId })));
    }
    expect(noted).toContain('history');
    expect(noted).toContain('situation');
  });

  it('(a) a unit that reads the kind of an undeclared sub-machine\'s span from membershipOf throws', () => {
    const g = guardedBy(['timing']);
    const member = membershipOf(g, { frame: 100, carId: 1 as CarId });
    expect(member['session-phase-race']).toBeDefined();
    expect(undeclared(() => member['session-phase-race']!.kind)).toMatch(/^(history\.spans|situation\.byMachine)\.session-phase-race\[\d+\]\.kind$/);
    expect(undeclared(() => member['session-phase-race']!.detail)).toMatch(/\.detail$/);
    expect(undeclared(() => member['session-phase-race']!.start)).toMatch(/\.start$/);
    expect(undeclared(() => member['car-location']!.confirmed)).toMatch(/\.confirmed$/);
  });

  it('(b) the same unit with that sub-machine declared reads its kind', () => {
    const view = raceView();
    const g = guardedBy(['timing', 'spans:session-phase-race' as ChangeTag], view);
    const member = membershipOf(g, { frame: 100, carId: 1 as CarId });
    expect(member['session-phase-race']!.kind).toBe(membershipOf(view, { frame: 100, carId: 1 as CarId })['session-phase-race']!.kind);
    expect(undeclared(() => member['car-location']!.kind)).toMatch(/car-location\[\d+\]\.kind$/);
  });

  it('(c) listing the keys of situation.byMachine or history.spans frees no undeclared sub-machine', () => {
    const g = guardedBy(['timing']);
    expect(Object.keys(g.situation.byMachine)).toContain('clock');
    expect(undeclared(() => g.situation.byMachine['clock']![0]!.kind)).toBe('situation.byMachine.clock[0].kind');
    expect(undeclared(() => g.situation.byMachine['clock'])).toBe('situation.byMachine.clock');
    expect(Object.keys(g.history.spans)).toContain('session-phase-race');
    expect(undeclared(() => g.history.spans['session-phase-race']![0]!.kind)).toBe('history.spans.session-phase-race[0].kind');
    expect(undeclared(() => Object.values(g.situation.byMachine).flat().map((s) => s.kind))).toMatch(/\.kind$/);
  });

  it('a membership read lets no later direct read of an undeclared sub-machine through', () => {
    const g = guardedBy(['timing']);
    situationAt(g, 30);
    expect(undeclared(() => g.history.spans['session-phase-race'])).toBe('history.spans.session-phase-race');
    expect(undeclared(() => g.situation.byMachine['clock'])).toBe('situation.byMachine.clock');
  });
});

describe('a guarded view is read-only (ruling 6)', () => {
  it('a unit that changes the situation or the projection throws', () => {
    const g = guardedBy([...ALL_CHANGE_TAGS]);
    const open = g.situation.byMachine['clock'] as unknown as Array<Record<string, unknown>>;
    expect(() => open.push({})).toThrow(TypeError);
    expect(() => (open[0]!['kind'] = 'paused')).toThrow(TypeError);
    expect(() => (g.history.laps as unknown as unknown[]).push({})).toThrow(TypeError);
    const closed = g.history.spans['session-phase-race'] as unknown as Array<Record<string, unknown>>;
    expect(() => closed.pop()).toThrow(TypeError);
    expect(() => (closed[0]!['kind'] = 'racing')).toThrow(TypeError);
    expect(() => ((g.history as unknown as Record<string, unknown>)['laps'] = [])).toThrow(TypeError);
  });

  it('guarding leaves the view and the run as they are: a run whose every view is guarded and read gives an unguarded run\'s log and projection', () => {
    const frames = script(gridStart(60));
    const plain = run(frames).runner;
    const runner = new SessionRunner(initFor(frames));
    const read = (r: StepResult) => {
      const g = guardedView(viewOf(r), [...ALL_CHANGE_TAGS, 'feed']);
      for (const frame of [1, r.state.frameNumber]) situationAt(g, frame);
      void [g.history.laps.length, g.live.cars.length, openSpansOf(g, 'clock')];
    };
    for (const frame of frames) runner.apply(frame, read);
    runner.end(read);
    expect(runner.state.log).toEqual(plain.state.log);
    expect(runner.state.history).toEqual(plain.state.history);
  });
});

describe('the harness runs every unit through its guarded view', () => {
  it('a unit that reads what it does not declare fails like a throwing unit (C48); one that declares it runs', () => {
    const s = sched([
      quick('declared', { reads: ['laps'], compute: (v) => v.history.laps.length }),
      quick('undeclared', { reads: ['timing'], compute: (v) => v.history.laps.length }),
    ]);
    const result = s.run(input(1000, ['laps', 'timing'], undefined, 3));
    expect(result.ran).toEqual(['declared']);
    expect(result.outputs.get('declared')).toBe(3);
    expect(result.errors.map((e) => [e.id, e.error instanceof UndeclaredReadError && e.error.path])).toEqual([['undeclared', 'history.laps']]);
  });

  it('a unit reading the old `view.state` gets nothing: the view has no such part', () => {
    const s = sched([quick('old', { compute: (v) => (v as unknown as { state?: unknown }).state === undefined })]);
    expect(s.run(input(0)).outputs.get('old')).toBe(true);
  });

  it('the input of a step result is what a unit sees through the guard', () => {
    const { results } = run(script(gridStart(60)));
    const seen: number[] = [];
    const s = sched([quick('probe', { reads: ['spans:clock' as ChangeTag], compute: (v) => (seen.push(openSpansOf(v, 'clock').length), 0) })]);
    s.run(inputOf(results.at(-1)!));
    expect(seen).toEqual([1]);
  });
});
