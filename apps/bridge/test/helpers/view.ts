// Builds the `EngineView` a calculator sees after the last of `frames`, with feed health you control.
import { SessionRunner, type EngineView, type FeedMetricsView, type Frame } from '@pitwall/engine';
import { IDLE_FEED } from '../../../../test-support/builders/index.ts';
import { initFor } from '../../../../packages/engine/test/support/run.ts';

/**
 * Runs a `SessionRunner` over `frames` (initialised from the first frame that carries a Session) and views the last result.
 * `config` is the features' effective config the view carries; none by default, so every `ConfigKey` reads its defaults.
 */
export const viewFrom = (frames: readonly Frame[], feed: Partial<FeedMetricsView> = {}, config: EngineView['config'] = {}): EngineView => {
  const start = frames.findIndex((f) => f.session !== undefined);
  if (start < 0) throw new Error('viewFrom: no frame carries a session');
  const fromSession = frames.slice(start);
  const runner = new SessionRunner(initFor(fromSession));
  const results = fromSession.map((f) => runner.apply(f));
  const last = results.at(-1)!;
  return { state: last.state, changed: last.changed, delta: last.delta, feed: { ...IDLE_FEED, ...feed }, outputs: new Map(), config };
};
