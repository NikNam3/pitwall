// Shared by the step tests: feeds a scenario's frames through `step` and returns the final state plus each step's output.
import type { FeedId } from '@pitwall/domain';
import { initialState, step, type EngineState, type Frame, type StepOutput } from '../../src/index.ts';
import type { ScenarioBuilder } from '../builders/index.ts';

export const initFor = (frames: Frame[]): Parameters<typeof initialState>[0] => ({
  feedId: 'test' as FeedId,
  sessionUid: frames[0]!.sessionUid,
  session: frames[0]!.session!,
});

export const runFrames = (frames: Frame[]): { st: EngineState; frames: Frame[]; results: StepOutput[] } => {
  const st = initialState(initFor(frames));
  return { st, frames, results: frames.map((f) => step(st, f)) };
};

export const runScenario = (b: ScenarioBuilder) => runFrames(b.build());
