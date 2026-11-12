// The shrinkage of `driver-noise` (SP4.3a spec 5.2): each value moves from its prior towards the session's own as laps
// come in, `value = (n · session + k · prior) / (n + k)`, as `pit-loss` blends its stops; the source follows the half
// rule (spec 4.4): the session's share above half is `session`, else the prior's kind.
import type { EstimateSource } from '@pitwall/domain';

/** A prior: its value and where it comes from (a profile entry, the config's default, the AI field). */
export type Prior = { value: number; source: EstimateSource };

/** The session's own estimate of one value, resting on `n` samples (laps, pairs, mistakes); none below its minimum. */
export type SessionEstimate = { value: number; n: number } | undefined;

/** The blended value and its source. */
export type Shrunk = { value: number; source: EstimateSource };

/** `n laps`, `1 lap`. */
const lapsWord = (n: number): string => (n === 1 ? '1 lap' : `${n} laps`);

/** The session's estimate shrunk towards `prior` with strength `k` (laps); without one, the prior as it is. */
export function shrink(session: SessionEstimate, prior: Prior, k: number): Shrunk {
  if (session === undefined || session.n <= 0) return { value: prior.value, source: prior.source };
  const sessionShare = session.n / (session.n + k);
  const value = sessionShare * session.value + (1 - sessionShare) * prior.value;
  const parts = sessionShare === 1 ? lapsWord(session.n) : `${lapsWord(session.n)} + ${prior.source.parts}`;
  const source: EstimateSource = sessionShare > 0.5 ? { kind: 'session', sessionShare, parts } : { ...prior.source, sessionShare, parts };
  return { value, source };
}
