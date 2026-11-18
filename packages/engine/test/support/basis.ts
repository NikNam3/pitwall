// Shared by the basis tests (C39, C62, C76; SP4.3e Task 0b): two bases A and B with their loaded contexts, a runner whose
// session starts on A and whose bridge registered A and B, the `basisChosen` decision, and a run that notes the view's
// basis after each frame.
import { basisKey, carId, type GivenDecision, type SessionBasis, type SessionUid } from '@pitwall/domain';
import { SessionRunner, type BasisContext, type Frame } from '../../src/index.ts';
import { applyWith } from './decisions.ts';
import { initFor } from './run.ts';

export const player = { teamId: 0, raceNumber: 1 };
const EMPTY = { laps: [], stints: [], pitStops: [], crossings: [], events: [], penalties: [], decisions: [], clock: [], spans: {}, appendedAt: {} };
const ref = (sessionUid: string) => ({ sessionUid, weekendId: 'w' });
export const BASIS_A: SessionBasis = { practice: [ref('1')], qualifying: null };
export const BASIS_B: SessionBasis = { practice: [ref('2')], qualifying: ref('3') };
const contextOf = (basis: SessionBasis): BasisContext => ({
  basis,
  player,
  sessions: basis.practice.map((r) => ({ sessionUid: r.sessionUid as SessionUid, weekendId: r.weekendId, playerCar: carId(0), cars: [{ carId: carId(0), carKey: player }], projection: EMPTY })),
});
export const A = contextOf(BASIS_A);
export const B = contextOf(BASIS_B);
export const choose = (basis: SessionBasis): GivenDecision => ({ kind: 'basisChosen', basis });

/** The bridge's registered contexts: A and B, by basis. */
export const registeredAB = (basis: SessionBasis): BasisContext | undefined =>
  basisKey(basis) === basisKey(BASIS_A) ? A : basisKey(basis) === basisKey(BASIS_B) ? B : undefined;

/** A runner whose session starts on A. */
export const basisRunner = (frames: Frame[], registered: (b: SessionBasis) => BasisContext | undefined = registeredAB) =>
  new SessionRunner(initFor(frames), { basis: { start: () => A, registered } });

/** Applies `frames` with the decisions `at` gives each frame index; per frame id the view's basis right after it. */
export const runNoting = (runner: SessionRunner, frames: Frame[], at: (i: number) => GivenDecision[] | undefined = () => undefined) => {
  const seen = new Map<number, unknown>();
  for (const [i, f] of frames.entries()) applyWith(runner, f, at(i), (r, applied) => seen.set(applied.frameId, r.state.basis));
  return seen;
};
