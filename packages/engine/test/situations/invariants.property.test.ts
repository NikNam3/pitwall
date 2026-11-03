// One generic property over the registry (contract C85, C87): random signal sequences, run through step 2's
// `runMachine` frame by frame and closed by `closeSession`, never give an undeclared transition, a throw, two open spans
// in one scope, a scope left without its open span or a gap between spans (in time and in frames); span ids count the
// spans opened before them; the spans closed by the session's end cover its last frame.
// The registry is `MACHINES` plus the test machines (`test/support/test-machines.ts`) while no sub-machine is registered.
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { initialState, type Frame, type StepOutput } from '../../src/index.ts';
import { MACHINES } from '../../src/situations/index.generated.ts';
import type { SubMachine } from '../../src/situations/machine.ts';
import { closeSession, runMachine, situationOf } from '../../src/situations/run.ts';
import { ScenarioBuilder } from '../builders/index.ts';
import { arbSignalSequence } from '../support/arb-signals.ts';
import { frameProblems, spanListProblems } from '../support/machine-invariants.ts';
import { initFor } from '../support/run.ts';
import { FRAME_MS, scopeKey } from '../support/transition-table.ts';

vi.mock('../../src/situations/index.generated.ts', async (importOriginal) => {
  const registered = await importOriginal<{ MACHINES: ReadonlyArray<SubMachine<unknown>> }>();
  const { TEST_MACHINES } = await import('../support/test-machines.ts');
  return { ...registered, MACHINES: [...registered.MACHINES, ...TEST_MACHINES] };
});

const [first] = new ScenarioBuilder({ cars: 2 }).frames(1, () => {}).build() as [Frame];
const initial = initialState(initFor([first])).signals;
const frameAt = (index: number): Frame => ({ ...first, frameId: index, sessionTime: index * FRAME_MS });

describe('every sub-machine (C85)', () => {
  it('random signal sequences never give an undeclared transition, a throw, two open spans in one scope or a gap between spans', () => {
    fc.assert(
      fc.property(arbSignalSequence(initial), (sequence) => {
        const state = initialState(initFor([first]));
        const problems: string[] = [];
        let before = situationOf(state).byMachine;
        sequence.forEach((signals, index) => {
          state.signals = signals;
          state.frameNumber = index + 1;
          const out: StepOutput = { changed: new Set(), corrections: [] };
          runMachine(state, frameAt(index), out);
          const after = situationOf(state).byMachine;
          for (const m of MACHINES) problems.push(...frameProblems(m, before[m.id] ?? [], after[m.id] ?? []).map((p) => `frame ${index}: ${p}`));
          before = after;
        });
        const end = sequence.length * FRAME_MS;
        closeSession(state, end);
        for (const m of MACHINES) {
          const spans = state.log.spans[m.id] ?? [];
          problems.push(...spanListProblems(m, spans));
          const last = new Map(spans.map((s) => [scopeKey(m.scope, s), s]));
          for (const [scope, span] of last) {
            if (span.end !== end) problems.push(`${m.id}: ${scope} ends at ${span.end}, not at the session's close ${end}`);
            if (span.endFrame !== sequence.length + 1) problems.push(`${m.id}: ${scope} ends on frame ${span.endFrame}, not after the last frame ${sequence.length}`);
          }
        }
        expect(problems).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});
