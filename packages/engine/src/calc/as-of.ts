// The "as of frame N" form of a unit (SP4.3a spec 6.1, plan review P1, P2): what it reads is the projection cut at N
// and the situation at N, with the run's fixed inputs; its scheduled run calls it at the current frame (`asOfNow`).
// `runAsOf` runs several such units in dependency order, so a profile aggregate or the scoreboard can rebuild a past
// frame's outputs.
import type { FrameNumber, SessionTime } from '@pitwall/domain';
import type { Projection } from '../log/types.ts';
import type { Situation } from '../situations/situation.ts';
import type { ProfileCtx, StoredDriverSession } from './profiles.ts';
import type { CalculatorId, Dependency, EngineView } from './types.ts';

/** What an "as of frame N" form reads (C39 minus live, delta, changed, feed): the projection cut at N and the situation at N. */
export type AsOfView = Pick<EngineView, 'config' | 'priors' | 'drivers' | 'track' | 'weekend'> & {
  history: Projection;
  situation: Situation;
  frame: FrameNumber | 'now';
  at: SessionTime;
  outputs: ReadonlyMap<CalculatorId, unknown>;
};

/** A unit's "as of" form, as `runAsOf` runs it: its id, its reads (the order), and the form. */
export type AsOfUnit = { id: CalculatorId; reads: readonly Dependency[]; asOf(view: AsOfView): unknown };

/** The current view as an `AsOfView` (no cut). */
export function asOfNow(_view: EngineView): AsOfView {
  throw new Error('not implemented');
}

/** Runs `units` on `view` in dependency order, each unit's output in the next one's `outputs`; returns every output. */
export function runAsOf(_units: readonly AsOfUnit[], _view: AsOfView): ReadonlyMap<CalculatorId, unknown> {
  throw new Error('not implemented');
}

/** A stored session's whole projection as an `AsOfView` (frame `'now'`). */
export function asOfStored(_session: StoredDriverSession, _ctx: ProfileCtx): AsOfView {
  throw new Error('not implemented');
}
