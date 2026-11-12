// Membership once per stretch (C26): a fact's membership comes from the projection module's `membershipOf`, and every
// frame between the same two span boundaries of a source (a span's start or end frame) has the same membership, so a
// reader that asks for many facts asks once per stretch and car. Call-local: the memo lives as long as the returned
// function, which a unit builds per call.
import type { CarId, FrameNumber, MachineId, OpenSpan } from '@pitwall/domain';
import { membershipOf, type DeepReadonly, type MembershipSource } from '@pitwall/engine/readers';

type Membership = Readonly<Record<MachineId, DeepReadonly<OpenSpan>>>;

/** The number of entries of the ascending `xs` at or below `x`. */
function countAtOrBelow(xs: readonly number[], x: number): number {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((xs[mid] as number) <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** `membershipOf(source, fact)`, computed once per stretch between `source`'s span boundaries and per car. */
export function membershipByStretch(source: MembershipSource): (fact: { frame: FrameNumber; carId?: CarId }) => Membership {
  const frames = new Set<number>();
  const lists = [...Object.values(source.history.spans), ...Object.values(source.situation?.byMachine ?? {})];
  for (const spans of lists) {
    for (const span of spans as readonly DeepReadonly<OpenSpan & { endFrame?: FrameNumber }>[]) {
      frames.add(span.startFrame);
      if (span.endFrame !== undefined) frames.add(span.endFrame);
    }
  }
  const boundaries = [...frames].sort((a, b) => a - b);
  const memo = new Map<number, Membership>();
  const stretches = boundaries.length + 1;
  return (fact) => {
    const key = (fact.carId === undefined ? 0 : fact.carId + 1) * stretches + countAtOrBelow(boundaries, fact.frame);
    let member = memo.get(key);
    if (member === undefined) {
      member = membershipOf(source, fact);
      memo.set(key, member);
    }
    return member;
  };
}
