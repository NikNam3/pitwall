// The "as of frame N" form of a unit (SP4.3a spec 6.1, plan review P1, P2): what it reads is the projection cut at N
// and the situation at N, with the run's fixed inputs; its scheduled run calls it at the current frame (`asOfNow`).
// `runAsOf` runs several such units in dependency order, so a profile aggregate or the scoreboard can rebuild a past
// frame's outputs.
import { known, unknown, type CarId, type FrameNumber, type Known, type SessionTime } from '@pitwall/domain';
import type { DeepReadonly } from '../util/deep-readonly.ts';
import type { LiveState } from '../state/live-state.ts';
import type { Projection } from '../log/types.ts';
import type { Situation } from '../situations/situation.ts';
import type { ProfileCtx, StoredDriverSession } from './profiles.ts';
import type { CalculatorId, Dependency, EngineView } from './types.ts';

/** A car's tyre sets as the live state holds them. */
export type LiveSets = DeepReadonly<LiveState>['cars'][number]['tyres']['sets'];

/**
 * The session's values an as-of form may read that the projection does not hold (ruling R17): `totalLaps` and our car
 * are fixed for the session; the cars' tyre sets exist only now (the live state), so a cut or stored view has none.
 */
export type AsOfFixed = { totalLaps: Known<number>; playerCar: Known<CarId>; setsNow: readonly LiveSets[] | null };

/** What an "as of frame N" form reads (C39 minus live, delta, changed, feed): the projection cut at N and the situation at N. */
export type AsOfView = Pick<EngineView, 'config' | 'priors' | 'drivers' | 'track' | 'weekend'> & {
  fixed: AsOfFixed;
  history: Projection;
  situation: Situation;
  frame: FrameNumber | 'now';
  at: SessionTime;
  outputs: ReadonlyMap<CalculatorId, unknown>;
};

/** A unit's "as of" form, as `runAsOf` runs it: its id, its reads (the order), and the form. */
export type AsOfUnit = { id: CalculatorId; reads: readonly Dependency[]; asOf(view: AsOfView): unknown };

/**
 * The current view as an `AsOfView` (no cut). Every field is read from `view` only when the form reads it (getters), so
 * a unit's guarded view sees only what the unit declares (C41).
 */
export function asOfNow(view: EngineView): AsOfView {
  return {
    get history() { return view.history; },
    get situation() { return view.situation; },
    frame: 'now',
    get at() { return view.live.sessionTime; },
    get config() { return view.config; },
    get priors() { return view.priors; },
    get drivers() { return view.drivers; },
    get track() { return view.track; },
    get weekend() { return view.weekend; },
    get outputs() { return view.outputs; },
    get fixed() {
      return {
        totalLaps: known(view.live.session.totalLaps, view.live.sessionTime),
        playerCar: known(view.live.playerCar, view.live.sessionTime),
        setsNow: view.live.cars.map((c) => c.tyres.sets),
      };
    },
  };
}

/** The units in an order where each comes after the given units it reads; among the ready ones, the first given goes next. */
const inReadsOrder = (units: readonly AsOfUnit[]): AsOfUnit[] => {
  const given = new Set(units.map((u) => u.id));
  const upstream = (u: AsOfUnit) => u.reads.flatMap((r) => (typeof r === 'object' && given.has(r.calculator) ? [r.calculator] : []));
  const done = new Set<CalculatorId>();
  const order: AsOfUnit[] = [];
  while (order.length < units.length) {
    const next = units.find((u) => !done.has(u.id) && upstream(u).every((id) => done.has(id)));
    if (next === undefined) throw new Error(`runAsOf: the units' reads form a cycle (${units.filter((u) => !done.has(u.id)).map((u) => u.id).join(', ')})`);
    done.add(next.id);
    order.push(next);
  }
  return order;
};

/** Runs `units` on `view` in dependency order, each unit's output in the next one's `outputs`; returns every output. */
export function runAsOf(units: readonly AsOfUnit[], view: AsOfView): ReadonlyMap<CalculatorId, unknown> {
  const outputs = new Map(view.outputs);
  for (const unit of inReadsOrder(units)) outputs.set(unit.id, unit.asOf({ ...view, outputs }));
  return outputs;
}

/** When a stored session ended: the latest end of its spans (every span of a complete log is closed, C18), else 0. */
const endOf = (projection: Projection): SessionTime => {
  let end = 0;
  for (const spans of Object.values(projection.spans)) for (const s of spans) end = Math.max(end, s.end);
  return end;
};

/** A stored session's whole projection as an `AsOfView` (frame `'now'`). */
export function asOfStored(session: StoredDriverSession, ctx: ProfileCtx): AsOfView {
  return {
    history: session.projection,
    situation: { weekendPhase: session.phase, byMachine: {} },
    frame: 'now',
    at: endOf(session.projection),
    config: ctx.config,
    priors: unknown('notApplicable'),
    drivers: [],
    track: session.track,
    weekend: undefined,
    outputs: new Map(),
    fixed: { totalLaps: session.totalLaps, playerCar: known(session.session.feedCar, 0), setsNow: null },
  };
}
