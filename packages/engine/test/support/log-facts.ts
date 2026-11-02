// Facts for the log and projection tests, built directly so the tests depend on no sub-machine.
import type { ClockFact, MachineId, OpenSpan, RaceEvent, SessionTime, Span, SpanId, Stamp, VoidFact, WeekendPhase } from '@pitwall/domain';
import type { Situation } from '../../src/situations/situation.ts';

export const event = (at: SessionTime, stamp: Stamp = {}): RaceEvent => ({ at, kind: 'overtake', params: {}, in: stamp });

export const clockJump = (at: SessionTime, stamp: Stamp = {}): ClockFact => ({ kind: 'jump', at, fromMs: at, toMs: at + 1000, in: stamp });

export const span = (machine: MachineId, id: SpanId, kind: string, start: SessionTime, end: SessionTime, stamp: Stamp = {}): Span => ({
  machine, id, kind, start, end, confirmed: true, detail: undefined, in: stamp,
});

export const openSpan = (machine: MachineId, id: SpanId, kind: string, start: SessionTime): OpenSpan => ({
  machine, id, kind, start, confirmed: true, detail: undefined,
});

export const voidFact = (frameId: number, at: SessionTime, ranges: VoidFact['ranges']): VoidFact => ({ target: { frameId, at }, ranges, in: {} });

const RACE: WeekendPhase = { kind: 'race', format: 'grandPrix' };

/** A situation with the given open spans, grouped by their sub-machine. */
export const situation = (...open: OpenSpan[]): Situation => {
  const byMachine: Record<MachineId, OpenSpan[]> = {};
  for (const s of open) (byMachine[s.machine] ??= []).push(s);
  return { weekendPhase: RACE, session: undefined, byMachine };
};

export const NOTHING_OPEN: Situation = situation();
