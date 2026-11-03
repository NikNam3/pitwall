// The invariants every sub-machine keeps (contract C15, C18, C26, C85), as problem lists: empty when they hold. A frame
// gives no undeclared transition (a scope left without its open span is the transition `kind -> none`, undeclared
// unless the machine declares it, as the clock does) and at most one open span per scope; a span changes neither kind
// nor start (nor the frame it opened on) while open. A complete span list (after `closeSession`) is contiguous per scope,
// in time and in frames (a span's successor opens on the frame it closed on, C26); a machine that declares a transition
// to `none` may leave a scope without a span between two, so there a successor opens at or after its predecessor's end,
// never before it. A span may open and close on the same frame (FM-1). Span ids count the spans opened before them (per
// car for a car sub-machine).
import type { OpenSpan, Span } from '@pitwall/domain';
import type { DeepReadonly } from '../../src/util/deep-readonly.ts';
import { scopeKey, transitionsOf, type ClosedSpan, type Steppable } from './transition-table.ts';

type Open = DeepReadonly<OpenSpan>;

/** What is wrong with a machine's open spans going from `before` to `after` in one frame that closed `closed`. */
export const frameProblems = (machine: Steppable, before: readonly Open[], after: readonly Open[], closed: readonly DeepReadonly<ClosedSpan>[] = []): string[] => {
  const { id, spans: { scope } } = machine;
  const problems: string[] = [];
  const keys = after.map((s) => scopeKey(scope, s));
  keys.forEach((key, i) => keys.indexOf(key) !== i && problems.push(`${id}: two open spans in ${key}`));
  for (const t of transitionsOf(scope, before as OpenSpan[], after as OpenSpan[], closed as ClosedSpan[])) {
    if (!machine.transitions.some(([f, to]) => f === t.from && to === t.to)) problems.push(`${id}: undeclared ${t.from} -> ${t.to} in ${t.scope}`);
  }
  for (const was of before) {
    const now = after.find((s) => scopeKey(scope, s) === scopeKey(scope, was));
    if (now?.id === was.id && (now.kind !== was.kind || now.start !== was.start || now.startFrame !== was.startFrame)) {
      problems.push(`${id}: open span #${was.id} changed kind or start`);
    }
  }
  return problems;
};

/** What is wrong with a machine's complete span list (log order): gaps, reversed spans, ids that do not count. */
export const spanListProblems = (machine: Steppable, spans: readonly DeepReadonly<Span>[]): string[] => {
  const { id, spans: { scope } } = machine;
  /** The machine may leave a scope without a span (it declares `kind -> none`): a successor opens at or after the end. */
  const gaps = machine.transitions.some(([, to]) => to === 'none');
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
      if (gaps ? span.start < prev.end : span.start !== prev.end) {
        problems.push(`${id}: ${gaps ? 'overlap' : 'gap'} in ${key} between #${prev.id} (end ${prev.end}) and #${span.id} (start ${span.start})`);
      }
      if (gaps ? span.startFrame < prev.endFrame : span.startFrame !== prev.endFrame) {
        problems.push(`${id}: frame ${gaps ? 'overlap' : 'gap'} in ${key} between #${prev.id} (end frame ${prev.endFrame}) and #${span.id} (start frame ${span.startFrame})`);
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
