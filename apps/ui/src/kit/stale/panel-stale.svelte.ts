import type { CarState } from '@pitwall/domain';
import { getContext, setContext } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import type { CarFieldPath } from '../values/car-sources.ts';
import { carFieldStaleMs, type PanelFeed } from './stale.ts';

export type { PanelFeed };

/** What value cells of one panel share: the feed's cadence, and how long the staleest cell has been behind. */
export type PanelStale = {
  readonly feed: PanelFeed;
  /** Milliseconds the most behind cell has been stale; undefined while none is. */
  readonly staleForMs: number | undefined;
  reportStale(id: symbol, staleSinceMs: number | undefined): void;
};

const KEY = Symbol('panel-stale');
const NO_FEED: PanelFeed = { cadenceMs: () => undefined };

/** Creates the panel's staleness state and provides it to the cells below. */
export function providePanelStale(feed: PanelFeed = NO_FEED): PanelStale {
  const reports = new SvelteMap<symbol, number>();
  const panel: PanelStale = {
    feed,
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

/** What `useStaleCarFields` reads: the car's `updatedAt` and the fields the component shows. */
export type CarFields = { updatedAt: CarState['updatedAt'] | undefined; fields: readonly CarFieldPath[] };

/**
 * The kit's stale path for car fields (spec 6.4): which of the component's fields have fallen behind the car's newest
 * update, and for how long. The most behind one is reported to the panel (its header's `stale N s`) while the component
 * lives. Call it once while the component initialises; `car` is read reactively.
 */
export function useStaleCarFields(car: () => CarFields | undefined): { readonly ages: ReadonlyMap<CarFieldPath, number>; isStale(field: CarFieldPath): boolean } {
  const panel = usePanelStale();
  const id = Symbol('car-fields');
  const ages = $derived.by(() => {
    const out = new Map<CarFieldPath, number>();
    const c = car();
    const cadenceMs = panel?.feed.cadenceMs();
    for (const field of c?.fields ?? []) {
      const ms = carFieldStaleMs(c?.updatedAt, field, cadenceMs);
      if (ms !== undefined) out.set(field, ms);
    }
    return out;
  });
  $effect(() => {
    let max: number | undefined;
    for (const ms of ages.values()) if (max === undefined || ms > max) max = ms;
    panel?.reportStale(id, max);
    return () => panel?.reportStale(id, undefined);
  });
  return {
    get ages() {
      return ages;
    },
    isStale: (field) => ages.has(field),
  };
}
