// The log as the storage writer and the stored projection need it (C24, C28, C34): only the bridge's storage imports
// this entry (depcruise). A stored session's projection is computed here, by the one projection module.
import { emptySituation } from './situations/situation.ts';
import { ProjectionTracker } from './log/projection.ts';
import type { Log, Projection } from './log/types.ts';
import type { DeepReadonly } from './util/deep-readonly.ts';

export type { Log } from './log/types.ts';
export { FACT_LISTS, logLengths, machineOf } from './log/log.ts';

/**
 * The projection of a complete log (a stored session's, C28, C34): one `ProjectionTracker` over it, updated once. A
 * complete log has no open span, so the situation is empty.
 */
export const projectionOfLog = (log: DeepReadonly<Log>): Projection => {
  const tracker = new ProjectionTracker(log);
  tracker.update(emptySituation());
  return tracker.projection;
};
