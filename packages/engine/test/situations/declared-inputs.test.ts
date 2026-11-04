// A sub-machine reads only its declared inputs (contract C15, C41, C87): one generic test over the registry (`MACHINES`)
// and the test machines. Each machine steps through guarded inputs (`test/support/guarded-input.ts`) that throw on any
// read outside its declaration: signals it does not list (session and car level, `events`), live-state areas it does not
// list, upstream machines it does not name. The inputs are the rows of its transition table and random signal sequences
// (the invariants property's generator, `arb-signals.ts`), in the machine's weekend phase. Step 0's clock has its own
// inputs (C7) and is not a registered sub-machine.
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import type { WeekendPhase, WeekendPhaseKind } from '@pitwall/domain';
import { initialState, type Frame } from '../../src/index.ts';
import { MACHINES } from '../../src/situations/index.generated.ts';
import type { MachineInput, SubMachine } from '../../src/situations/machine.ts';
import { ScenarioBuilder } from '../builders/index.ts';
import { arbSignalSequence } from '../support/arb-signals.ts';
import { guardedInput, UndeclaredReadError } from '../support/guarded-input.ts';
import { initFor } from '../support/run.ts';
import { TEST_TABLES } from '../support/test-machines.transitions.ts';
import { FRAME_MS, inputs, loadTransitionTables } from '../support/transition-table.ts';

vi.mock('../../src/situations/index.generated.ts', async (importOriginal) => {
  const registered = await importOriginal<{ MACHINES: ReadonlyArray<SubMachine<unknown>> }>();
  const { TEST_MACHINES } = await import('../support/test-machines.ts');
  return { ...registered, MACHINES: [...registered.MACHINES, ...TEST_MACHINES] };
});

const tables = [...(await loadTransitionTables()), ...TEST_TABLES];
const [first] = new ScenarioBuilder({ cars: 2 }).frames(1, () => {}).build() as [Frame];
/** One built frame; the random frames share it (machines read inputs, never write them), so none is cloned per frame. */
const [base] = inputs().frame().build() as [MachineInput];
const initialSignals = initialState(initFor([first])).signals;
/** The base live state with every car's Participants data updated at `at`; the base's areas are shared, not cloned. */
const liveWithParticipants = (at: number): MachineInput['live'] => ({
  ...base.live,
  cars: base.live.cars.map((car) => ({ ...car, updatedAt: { ...car.updatedAt, participants: at } })),
});

/** A weekend phase of each kind, for a machine of that phase. */
const PHASE_OF: Readonly<Partial<Record<WeekendPhaseKind, WeekendPhase>>> = {
  race: { kind: 'race', format: 'grandPrix' },
  qualifying: { kind: 'qualifying', format: 'grandPrix', segment: 2 },
  practice: { kind: 'practice', format: 'practice', segment: 1 },
};

/** The weekend phase a machine runs in: its first phase, or pending for a machine of every phase. */
const phaseFor = (machine: SubMachine<unknown>): WeekendPhase =>
  machine.appliesTo === 'all' ? { kind: 'pending' } : (PHASE_OF[machine.appliesTo[0]!] ?? { kind: 'pending' });

/** Every registered machine's id with no open span, the weekend-phase span of `phase` when it is decided. */
const upstreamFor = (phase: WeekendPhase): MachineInput['upstream'] =>
  Object.fromEntries(
    MACHINES.map((m) => {
      if (m.id !== 'weekend-phase' || phase.kind === 'pending') return [m.id, []];
      const { kind, ...detail } = phase;
      return [m.id, [{ machine: m.id, id: 0, kind, start: 0, startFrame: 1, confirmed: true, detail }]];
    }),
  );

/** A read path with its car index left out, so each read is listed once. */
const pathOf = (path: string): string => path.replace(/\[\d+\]/g, '[i]');

/**
 * Steps `machine` from `init()` through `frames` with guarded inputs; the undeclared reads, sorted. After a read throws,
 * the frame is stepped again unguarded, so the frames after it run as they would.
 */
const undeclaredReads = (machine: SubMachine<unknown>, frames: readonly MachineInput[]): string[] => {
  const reads = new Set<string>();
  let open = machine.init();
  for (const input of frames) {
    try {
      open = machine.step(open, guardedInput(machine.id, machine.inputs, input, (path) => reads.add(pathOf(path)))).open;
    } catch (error) {
      if (!(error instanceof UndeclaredReadError)) throw error;
      open = machine.step(open, input).open;
    }
  }
  return [...reads].sort();
};

describe('the guarded input', () => {
  const [input] = inputs().frame().build() as [MachineInput];
  const guarded = (declared: SubMachine<unknown>['inputs']) => guardedInput('probe', declared, input);
  it('lets the declared signals, live areas and upstream machines through', () => {
    const g = guarded({ signals: ['safetyCarStatus', 'pitStatus', 'events'], values: ['session', 'timing'], upstream: ['test-session'] });
    expect(() => [g.signals.session.safetyCarStatus, g.signals.cars[0]!.pitStatus, g.signals.events, g.live.session, g.live.cars[0]!.timing, g.live.cars[0]!.id, g.upstream['test-session'], g.at, g.clock, g.weekendPhase]).not.toThrow();
  });
  it.each([
    ['an undeclared session signal', (g: MachineInput) => g.signals.session.gamePaused, 'signals.session.gamePaused'],
    ['an undeclared car signal', (g: MachineInput) => g.signals.cars[0]!.resultStatus, 'signals.cars[0].resultStatus'],
    ['undeclared events', (g: MachineInput) => g.signals.events, 'signals.events'],
    ['an undeclared live area of the session', (g: MachineInput) => g.live.playerCar, 'live.playerCar'],
    ['an undeclared live area of a car', (g: MachineInput) => g.live.cars[0]!.tyres, 'live.cars[0].tyres'],
    ['an undeclared upstream machine', (g: MachineInput) => g.upstream['weekend-phase'], 'upstream.weekend-phase'],
  ] as const)('throws on %s', (_, read, path) => {
    const g = guarded({ signals: ['safetyCarStatus', 'pitStatus'], values: ['session', 'timing'], upstream: ['test-session'] });
    expect(() => read(g)).toThrow(new UndeclaredReadError('probe', path));
  });
  it('throws on the cars of the signals or the live state when the machine declares nothing of a car', () => {
    const g = guarded({ signals: ['safetyCarStatus'], values: ['session'], upstream: [] });
    expect(() => g.signals.cars.length).toThrow(UndeclaredReadError);
    expect(() => g.live.cars.filter(() => true)).toThrow(UndeclaredReadError);
  });
});

describe('a sub-machine reads only its declared inputs (C15)', () => {
  for (const machine of MACHINES) {
    describe(machine.id, () => {
      it('on every row of its transition table', () => {
        const table = tables.find((t) => t.machine.id === machine.id);
        expect(table, `${machine.id} has a transition table`).toBeDefined();
        const reads = new Set(table!.rows.flatMap((row) => undeclaredReads(machine, row.input.build() as MachineInput[])));
        expect([...reads].sort(), `${machine.id} declares ${JSON.stringify(machine.inputs)}`).toEqual([]);
      });
      it('on random signal sequences, in its weekend phase', () => {
        const phase = phaseFor(machine);
        const upstream = upstreamFor(phase);
        fc.assert(
          fc.property(arbSignalSequence(initialSignals), fc.nat({ max: 20 }), (sequence, participantsAt) => {
            // the Participants data arrives on frame `participantsAt` and stays (a car sub-machine waits for it, C3):
            // the frames from it on share a second base live state with it, built once per run
            const withParticipants = liveWithParticipants(participantsAt * FRAME_MS);
            const frames = sequence.map((signals, k): MachineInput => ({
              ...base,
              at: k * FRAME_MS,
              frameId: k,
              frameNumber: k + 1,
              signals,
              live: k >= participantsAt ? withParticipants : base.live,
              weekendPhase: phase,
              upstream,
            }));
            expect(undeclaredReads(machine, frames), `${machine.id} declares ${JSON.stringify(machine.inputs)}`).toEqual([]);
          }),
          { numRuns: 50 },
        );
      });
    });
  }
});
