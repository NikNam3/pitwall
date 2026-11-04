// The invariants every sub-machine keeps (contract C15, C18, C26, C85), as problem lists: empty when they hold. A frame
// gives no undeclared transition (a scope left without its open span is the transition `kind -> none`, undeclared like
// any other) and at most one open span per scope; a span changes neither kind nor start (nor the frame it opened on)
// while open. A complete span list (after `closeSession`) is contiguous per scope, for every sub-machine without
// exception (user ruling 2026-11-03: a sub-machine with a rest state has a resting kind), in time and in frames (a
// span's successor opens where and on the frame its predecessor closed, C26). A span may open and close on the same
// frame (FM-1); only one that closes before it opens is a problem. Span ids count the spans opened before them (per car
// for a car sub-machine).
import type { OpenSpan, Span } from '@pitwall/domain';
import { samePlain } from '../../src/situations/run.ts';
import type { DeepReadonly } from '../../src/util/deep-readonly.ts';
import { scopeKey, transitionsOf, type ClosedSpan, type Steppable } from './transition-table.ts';

type Open = DeepReadonly<OpenSpan>;

/** What is wrong with a machine's open spans going from `before` to `after` in one frame that closed `closed`. */
export const frameProblems = (machine: Steppable, before: readonly Open[], after: readonly Open[], closed: readonly DeepReadonly<ClosedSpan>[] = []): string[] => {
  const { id, spans: { scope } } = machine;
  const problems: string[] = [];
  const keys = after.map((s) => scopeKey(scope, s));
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) problems.push(`${id}: two open spans in ${key}`);
    seen.add(key);
  }
  // Nothing opened, closed or changed (the common frame): no transition and no change to check.
  const same = (a: Open, b: Open) => a.id === b.id && a.kind === b.kind && a.start === b.start && a.startFrame === b.startFrame && a.carId === b.carId && a.zone === b.zone;
  if (closed.length === 0 && before.length === after.length && before.every((b, i) => same(b, after[i]!))) return problems;
  for (const t of transitionsOf(scope, before as OpenSpan[], after as OpenSpan[], closed as ClosedSpan[])) {
    if (!machine.transitions.some(([f, to]) => f === t.from && to === t.to)) problems.push(`${id}: undeclared ${t.from} -> ${t.to} in ${t.scope}`);
  }
  const nowByKey = new Map<string, Open>();
  after.forEach((s, i) => !nowByKey.has(keys[i]!) && nowByKey.set(keys[i]!, s));
  for (const was of before) {
    const now = nowByKey.get(scopeKey(scope, was));
    if (now?.id === was.id && (now.kind !== was.kind || now.start !== was.start || now.startFrame !== was.startFrame)) {
      problems.push(`${id}: open span #${was.id} changed kind or start`);
    }
  }
  return problems;
};

/**
 * What is wrong with a machine's open spans going from `before` to `after` in one frame by identity (Task PERF, C40): a
 * span that did not change (in its scope, `samePlain`-equal to the previous frame's, step 2's tag rule) is the same
 * object as on the previous frame, so step 2 decides its `spans:<id>` tag without walking it.
 */
export const identityProblems = (machine: Steppable, before: readonly Open[], after: readonly Open[]): string[] => {
  const { id, spans: { scope } } = machine;
  const was = new Map(before.map((s) => [scopeKey(scope, s), s]));
  return after.flatMap((now) => {
    const key = scopeKey(scope, now);
    const prev = was.get(key);
    return prev !== undefined && prev !== now && samePlain(prev, now) ? [`${id}: unchanged open span #${now.id} in ${key} is a new object`] : [];
  });
};

/** What is wrong with a machine's complete span list (log order): gaps or overlaps, reversed spans, ids that do not count. */
export const spanListProblems = (machine: Steppable, spans: readonly DeepReadonly<Span>[]): string[] => {
  const { id, spans: { scope } } = machine;
  const problems: string[] = [];
  const byScope = new Map<string, DeepReadonly<Span>[]>();
  const idsByCounter = new Map<string, number[]>();
  for (const span of spans) {
    if (span.machine !== id) problems.push(`${id}: span #${span.id} names machine ${span.machine}`);
    if (span.end < span.start) problems.push(`${id}: span #${span.id} ends before it starts`);
    if (span.endFrame < span.startFrame) problems.push(`${id}: span #${span.id} ends before it starts (frames ${span.startFrame} to ${span.endFrame})`);
    const key = scopeKey(scope, span);
    byScope.set(key, [...(byScope.get(key) ?? []), span]);
    const counter = scope === 'car' ? key : 'machine';
    idsByCounter.set(counter, [...(idsByCounter.get(counter) ?? []), span.id]);
  }
  for (const [key, list] of byScope) {
    list.slice(1).forEach((span, i) => {
      const prev = list[i]!;
      if (span.start !== prev.end) problems.push(`${id}: gap in ${key} between #${prev.id} (end ${prev.end}) and #${span.id} (start ${span.start})`);
      if (span.startFrame !== prev.endFrame) {
        problems.push(`${id}: frame gap in ${key} between #${prev.id} (end frame ${prev.endFrame}) and #${span.id} (start frame ${span.startFrame})`);
      }
      if (span.id <= prev.id) problems.push(`${id}: ids fall in ${key}: #${prev.id} then #${span.id}`);
    });
  }
  for (const [counter, ids] of idsByCounter) {
    const sorted = [...ids].sort((a, b) => a - b);
    if (sorted.some((spanId, i) => spanId !== i)) problems.push(`${id}: span ids of ${counter} are ${sorted.join(',')}, not 0..${ids.length - 1}`);
  }
  return problems;
};
