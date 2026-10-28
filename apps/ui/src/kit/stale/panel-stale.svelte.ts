import type { SessionTime } from '@pitwall/domain';
import { getContext, setContext } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';

/** The session clock a panel reads to judge staleness; the shell passes the store's. */
export type PanelClock = { now(): SessionTime | undefined; cadenceMs(): number | undefined };

/** What value cells of one panel share: the clock, and how long the staleest cell has been behind. */
export type PanelStale = {
  readonly clock: PanelClock;
  /** Milliseconds the most behind cell has been stale; undefined while none is. */
  readonly staleForMs: number | undefined;
  reportStale(id: symbol, staleSinceMs: number | undefined): void;
};

const KEY = Symbol('panel-stale');
const NO_CLOCK: PanelClock = { now: () => undefined, cadenceMs: () => undefined };

/** Creates the panel's staleness state and provides it to the cells below. */
export function providePanelStale(clock: PanelClock = NO_CLOCK): PanelStale {
  const reports = new SvelteMap<symbol, number>();
  const panel: PanelStale = {
    clock,
    get staleForMs() {
      let max: number | undefined;
      for (const ms of reports.values()) if (max === undefined || ms > max) max = ms;
      return max;
    },
    reportStale(id, ms) {
      if (ms === undefined) reports.delete(id);
      else reports.set(id, ms);
    },
  };
  setContext(KEY, panel);
  return panel;
}

/** The panel's staleness state, or undefined outside a panel. */
export const usePanelStale = (): PanelStale | undefined => getContext<PanelStale | undefined>(KEY);
