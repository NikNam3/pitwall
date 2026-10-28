// Folds a recording through the engine: `initialState` on the first frame that carries a Session, `step` for every frame from there on.
import type { FeedId } from '@pitwall/domain';
import { initialState, SessionRunner, step, type EngineState, type Frame, type StepResult } from '@pitwall/engine';
import type { FixtureName } from '../../../../test-support/fixtures.ts';
import { trackFixture } from './replay.ts';

export async function replayState(name: FixtureName): Promise<EngineState> {
  const box: { st?: EngineState } = {};
  await trackFixture(name, (f) => {
    if (!box.st && f.session) box.st = initialState({ feedId: name as string as FeedId, sessionUid: f.sessionUid, session: f.session });
    if (box.st) step(box.st, f);
  });
  if (!box.st) throw new Error(`${name}: no frame carried a session`);
  return box.st;
}

/** Like `replayState`, but through `SessionRunner.apply`, so history, deltas and flashbacks are part of the run. */
export async function replayRunner(name: FixtureName, onResult: (r: StepResult, f: Frame) => void = () => {}): Promise<SessionRunner> {
  const box: { runner?: SessionRunner } = {};
  await trackFixture(name, (f) => {
    if (!box.runner && f.session) box.runner = new SessionRunner({ feedId: name as string as FeedId, sessionUid: f.sessionUid, session: f.session });
    if (box.runner) onResult(box.runner.apply(f), f);
  });
  if (!box.runner) throw new Error(`${name}: no frame carried a session`);
  return box.runner;
}
