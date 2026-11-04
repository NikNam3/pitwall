// One generic property over the registry (contract C85, C87): random signal sequences, run through step 2's
// `runMachine` frame by frame and closed by `closeSession`, never give an undeclared transition (a scope left without
// its open span included), a throw, two open spans in one scope or a gap between spans (in time and in frames); span
// ids count the spans opened before them; the spans closed by the session's end cover its last frame. The Participants
// data (`updatedAt.participants`) arrives on a random frame, as a car sub-machine opens a car's first span with it.
// The registry is `MACHINES` plus the test machines (`test/support/test-machines.ts`). Step 0's clock, a sub-machine
// outside the registry (C7), has its own property on the same invariants (`clock/clock.property.test.ts`).
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

// 100 runs in four shards of 25 (each shard draws its own sequences): one test stays under 2 s, the registry is walked on every frame.
const SHARDS = 4;
describe('every sub-machine (C85)', () => {
  it.each(Array.from({ length: SHARDS }, (_, i) => i + 1))('random signal sequences (shard %i) never give an undeclared transition, a throw, two open spans in one scope or a gap between spans', () => {
    fc.assert(
      fc.property(arbSignalSequence(initial), fc.nat({ max: 20 }), (sequence, participantsAt) => {
        const state = initialState(initFor([first]));
        const problems: string[] = [];
        let before = situationOf(state).byMachine;
        sequence.forEach((signals, index) => {
          state.signals = signals;
          // Participants data arrives on frame `participantsAt` (the car sub-machines open a car's first span then, C3)
          if (index === participantsAt) for (const car of state.cars) car.updatedAt.participants = index * FRAME_MS;
          state.frameNumber = index + 1;
          const out: StepOutput = { changed: new Set(), corrections: [] };
          const lengths = new Map(MACHINES.map((m) => [m.id, state.log.spans[m.id]?.length ?? 0]));
          runMachine(state, frameAt(index), out);
          const after = situationOf(state).byMachine;
          for (const m of MACHINES) {
            const closed = (state.log.spans[m.id] ?? []).slice(lengths.get(m.id));
            problems.push(...frameProblems(m, before[m.id] ?? [], after[m.id] ?? [], closed).map((p) => `frame ${index}: ${p}`));
          }
          before = after;
        });
        const end = sequence.length * FRAME_MS;
        closeSession(state, end);
        for (const m of MACHINES) {
          const spans = state.log.spans[m.id] ?? [];
          problems.push(...spanListProblems(m, spans));
          const last = new Map(spans.map((s) => [scopeKey(m.spans.scope, s), s]));
          for (const [scope, span] of last) {
            if (span.end !== end) problems.push(`${m.id}: ${scope} ends at ${span.end}, not at the session's close ${end}`);
            if (span.endFrame !== sequence.length + 1) problems.push(`${m.id}: ${scope} ends on frame ${span.endFrame}, not after the last frame ${sequence.length}`);
          }
        }
        expect(problems).toEqual([]);
      }),
      { numRuns: 100 / SHARDS },
    );
  });
});
