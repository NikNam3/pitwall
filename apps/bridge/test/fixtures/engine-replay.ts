// Folds a recording or segment through `SessionRunner.apply`, from the first frame that carries a Session, so history,
// deltas and flashbacks are part of the run.
import { basename } from 'node:path';
import { unknown, type CarId, type FeedId } from '@pitwall/domain';
import {
  CalculatorRegistry,
  Scheduler,
  SessionRunner,
  situationOf,
  type Calculator,
  type DeepReadonly,
  type EngineState,
  type EngineView,
  type Frame,
  type SchedulerResult,
  type StepResult,
} from '@pitwall/engine';
import { IDLE_FEED } from '../../../../test-support/builders/index.ts';
import { trackFile } from './replay.ts';

/**
 * The cars in the session after a step: the slots whose car-status span is open and not `absent` (C43), in slot order.
 * Task 24: the one source, as `car.active` left the live state.
 */
export const carsInSession = (state: DeepReadonly<EngineState>): CarId[] =>
  (situationOf(state).byMachine['car-status'] ?? []).flatMap((s) => (s.kind !== 'absent' && s.carId !== undefined ? [s.carId] : [])).sort((a, b) => a - b);

/**
 * `onResult` gets each frame the runner applied with its result, in order: the frames before the first Participants
 * wait in the runner (its identity wait) and come once it ends, or at the end of the file.
 */
export async function replayRunner(path: string, onResult: (r: StepResult, f: Frame) => void = () => {}): Promise<SessionRunner> {
  const box: { runner?: SessionRunner } = {};
  await trackFile(path, (f) => {
    if (!box.runner && f.session) box.runner = new SessionRunner({ feedId: basename(path) as FeedId, sessionUid: f.sessionUid, session: f.session });
    box.runner?.apply(f, onResult);
  });
  if (!box.runner) throw new Error(`${path}: no frame carried a session`);
  box.runner.end(onResult);
  return box.runner;
}

/**
 * `replayRunner` plus a `Scheduler` over `calculators`, every one needed, on a healthy feed and `config` (by section key
 * over the defaults; none by default): the engine and the units under test, without topics. A flashback (`delta.rewound`,
 * the only rewind, C30) resets the scheduler: nothing restores its bookkeeping here, as the bridge's runner does.
 */
export async function replayScheduled(
  path: string,
  calculators: readonly Calculator[],
  onStep: (r: StepResult, scheduled: SchedulerResult, f: Frame) => void = () => {},
  config: EngineView['config'] = {},
): Promise<SessionRunner> {
  const scheduler = new Scheduler(CalculatorRegistry.build(calculators), { freezeOutputs: true });
  scheduler.setNeeded(calculators.map((c) => c.id));
  return replayRunner(path, (r, f) => {
    if (r.delta.rewound !== undefined) scheduler.reset();
    const scheduled = scheduler.run({ live: r.state, situation: situationOf(r.state), history: r.state.history, changed: r.changed, delta: r.delta, weekend: r.state.weekend, feed: IDLE_FEED, config, priors: {}, track: unknown('notApplicable') });
    onStep(r, scheduled, f);
  });
}
