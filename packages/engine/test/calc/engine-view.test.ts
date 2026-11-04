// The view (C39): everything a calculator or analysis may see is the live state, the situation (the open spans, C20),
// the projection with its membership (C26, C28), the delta, the change tags, the weekend's earlier sessions, the config,
// the priors, the feed health and the outputs of the units it reads. Nothing else.
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { CarId } from '@pitwall/domain';
import {
  CalculatorRegistry,
  membershipOf,
  openSpansOf,
  Scheduler,
  situationAt,
  situationOf,
  type DeepReadonly,
  type EngineState,
  type EngineView,
  type MembershipSource,
  type Projection,
  type QuickCalculator,
  type WeekendContext,
} from '../../src/index.ts';
import type { Situation } from '../../src/situations/situation.ts';
import type { LiveState } from '../../src/state/live-state.ts';
import { gridStart, run, script } from '../situations/script.ts';
import { input, inputOf, viewOf } from '../support/scheduler.ts';

/** The parts of the view (C39). */
const PARTS = ['live', 'situation', 'history', 'delta', 'changed', 'weekend', 'config', 'priors', 'feed', 'outputs'] as const;
type Part = (typeof PARTS)[number];

/** A race from the grid to 60 frames after lights out: closed session-phase spans, open ones, every car's spans. */
const race = () => {
  const { runner, results } = run(script(gridStart(60)));
  return { runner, last: results.at(-1)! };
};

describe('EngineView: the C39 parts', () => {
  it('the view has exactly the C39 parts; there is no `state`', () => {
    expectTypeOf<keyof EngineView>().toEqualTypeOf<Part>();
    const calc: QuickCalculator<number> = {
      kind: 'quick', id: 'x', reads: ['timing'], cadence: 'frame',
      compute: (view) => {
        // @ts-expect-error the engine state is no part of the view: units read `live` and `history`
        void view.state;
        return view.live.sessionTime;
      },
    };
    expectTypeOf(calc.compute).parameter(0).toEqualTypeOf<EngineView>();
  });

  it('`live` is the live state, read-only: no open trackers, log, signals, projection, weekend context or frame number (C8, C13, C28)', () => {
    expectTypeOf<EngineView['live']>().toEqualTypeOf<DeepReadonly<LiveState>>();
    expectTypeOf<keyof EngineView['live']>().toEqualTypeOf<Exclude<keyof EngineState, 'open' | 'log' | 'signals' | 'history' | 'weekend' | 'frameNumber'>>();
    expectTypeOf<EngineView['live']['sessionTime']>().toEqualTypeOf<EngineState['sessionTime']>();
  });

  it('`situation` is the machine\'s open spans and the weekend phase (C20); `history` is the projection (C28)', () => {
    expectTypeOf<EngineView['situation']>().toEqualTypeOf<Situation>();
    expectTypeOf<EngineView['history']>().toEqualTypeOf<Projection>();
  });

  it('`weekend` is the weekend\'s earlier sessions, read-only, absent without a weekend context; `priors` are read-only (C62, C62a)', () => {
    expectTypeOf<EngineView['weekend']>().toEqualTypeOf<DeepReadonly<WeekendContext> | undefined>();
    expectTypeOf<EngineView['priors']>().toEqualTypeOf<DeepReadonly<Record<string, unknown>>>();
  });

  it('a unit gets the view with exactly these parts, each the scheduler input\'s, and the outputs of the units before it', () => {
    const seen: EngineView[] = [];
    const s = new Scheduler(CalculatorRegistry.build([{ kind: 'quick', id: 'probe', reads: ['timing'], cadence: 'frame', compute: (v) => (seen.push(v), 0) }]));
    s.setNeeded(['probe']);
    const given = { ...input(1000), priors: { 'pace.model': { k: 1 } }, weekend: { weekendId: 'w', player: { teamId: 0, raceNumber: 1 }, sessions: [] } as never };
    s.run(given);
    const [view] = seen;
    expect(Object.keys(view!).sort()).toEqual([...PARTS].sort());
    for (const part of ['live', 'situation', 'history', 'weekend', 'config', 'priors', 'feed'] as const) expect(view![part], part).toBe(given[part]);
    expect([...view!.changed]).toEqual([...given.changed]);
    expect(view!.delta).toEqual(given.delta);
    expect(view!.outputs).toBeInstanceOf(Map);
  });

  it('a step\'s view holds its live state, its situation (`situationOf`) and its projection; priors are `{}` until the priors store exists', () => {
    const { last } = race();
    const view = viewOf(last);
    expect(view.live).toBe(last.state);
    expect(view.history).toBe(last.state.history);
    expect(view.situation).toEqual(situationOf(last.state));
    expect(view.situation.byMachine['clock']?.map((s) => s.kind)).toEqual(['running']);
    expect(view.priors).toEqual({});
  });
});

describe('EngineView is a MembershipSource (C26)', () => {
  it('the view type satisfies it', () => {
    expectTypeOf<EngineView>().toMatchTypeOf<MembershipSource>();
  });

  it('situationAt and membershipOf on the view equal them on its projection and situation, on every frame of the session', () => {
    const { runner, last } = race();
    const view = viewOf(last);
    const source: MembershipSource = { history: last.state.history, situation: situationOf(last.state) };
    expect(Object.keys(view.history.spans).length).toBeGreaterThan(0);
    for (let frame = 1; frame <= runner.state.frameNumber; frame++) {
      expect(situationAt(view, frame), `frame ${frame}`).toEqual(situationAt(source, frame));
      expect(membershipOf(view, { frame, carId: 0 as CarId }), `frame ${frame}`).toEqual(membershipOf(source, { frame, carId: 0 as CarId }));
    }
    expect(Object.keys(situationAt(view, 1))).toContain('session-phase-race');
  });

  it('a stored session of the weekend is no MembershipSource: no unit asks membership of `view.weekend` (its rows hold no frame until Task 28)', () => {
    expectTypeOf<WeekendContext['sessions'][number]>().not.toMatchTypeOf<MembershipSource>();
    expectTypeOf<WeekendContext>().not.toMatchTypeOf<MembershipSource>();
  });
});

describe('openSpansOf', () => {
  it('gives a sub-machine\'s open spans from the view\'s situation: every car\'s, or one car\'s with `carId`; none for a machine with none', () => {
    const { last } = race();
    const view = viewOf(last);
    const all = view.situation.byMachine['car-location'] ?? [];
    expect(all.length).toBeGreaterThan(1);
    expect(openSpansOf(view, 'car-location')).toEqual(all);
    expect(openSpansOf(view, 'car-location', 1 as CarId)).toEqual(all.filter((s) => s.carId === 1));
    expect(openSpansOf(view, 'car-location', 1 as CarId)).toHaveLength(1);
    expect(openSpansOf(view, 'session-phase-race')).toEqual(view.situation.byMachine['session-phase-race']);
    expect(openSpansOf(view, 'no-such-machine')).toEqual([]);
  });

  it('reads only the situation: a view whose situation has the spans gives them, whatever its projection holds', () => {
    const span = { machine: 'car-status', id: 0, carId: 2 as CarId, kind: 'competing', start: 0, confirmed: true, detail: undefined, startFrame: 1 } as const;
    const situation: Situation = { weekendPhase: { kind: 'race', format: 'grandPrix' }, byMachine: { 'car-status': [span] } };
    const view: EngineView = { ...inputOf(race().last), situation, outputs: new Map() };
    expect(openSpansOf(view, 'car-status', 2 as CarId)).toEqual([span]);
    expect(openSpansOf(view, 'car-status', 3 as CarId)).toEqual([]);
  });
});
