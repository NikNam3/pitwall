import type { HistoryLengths } from '../state/engine-state.ts';

/**
 * What one step added to the append-only history: the list lengths before and after it. `truncated` marks a
 * flashback, which cut the history back first, so a reader must start from 0 instead of `before`.
 */
export type HistoryDelta = { before: HistoryLengths; after: HistoryLengths; truncated: boolean };
