// Folds a recording or segment through `SessionRunner.apply`, from the first frame that carries a Session, so history,
// deltas and flashbacks are part of the run.
import { basename } from 'node:path';
import type { FeedId } from '@pitwall/domain';
import { SessionRunner, type Frame, type StepResult } from '@pitwall/engine';
import { trackFile } from './replay.ts';

export async function replayRunner(path: string, onResult: (r: StepResult, f: Frame) => void = () => {}): Promise<SessionRunner> {
  const box: { runner?: SessionRunner } = {};
  await trackFile(path, (f) => {
    if (!box.runner && f.session) box.runner = new SessionRunner({ feedId: basename(path) as FeedId, sessionUid: f.sessionUid, session: f.session });
    if (box.runner) onResult(box.runner.apply(f), f);
  });
  if (!box.runner) throw new Error(`${path}: no frame carried a session`);
  return box.runner;
}
