// `strategy`'s job input (SP4.3b spec §8.1): the shared strategy input (`shared/strategy-input/`, SP4.3b2 Task 6),
// which the calls build from too (C43).
import type { EngineView } from '@pitwall/engine/readers';
import { strategyInputFrom, type StrategyInput } from '../shared/strategy-input/index.ts';

export type { StrategyInput };

/** The job's input from the view (≤ 20 ms, spec §8.1). */
export const prepareStrategy = (view: EngineView): StrategyInput => strategyInputFrom(view);
