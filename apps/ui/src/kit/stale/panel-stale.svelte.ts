import type { CarState } from '@pitwall/domain';
import { getContext, setContext } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import type { CarFieldPath } from '../values/car-sources.ts';
import { carFieldStaleMs, type PanelClock } from './stale.ts';

export type { PanelClock };

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

/** What `useStaleCarFields` reads: the car's `updatedAt` and the fields the component shows. */
export type CarFields = { updatedAt: CarState['updatedAt'] | undefined; fields: readonly CarFieldPath[] };

/**
 * The kit's stale path for car fields (spec 6.4): which of the component's fields have fallen behind, by the panel
 * clock, and for how long. The most behind one is reported to the panel (its header's `stale N s`) while the component
 * lives. Call it once while the component initialises; `car` is read reactively.
 */
export function useStaleCarFields(car: () => CarFields | undefined): { readonly ages: ReadonlyMap<CarFieldPath, number>; isStale(field: CarFieldPath): boolean } {
  const panel = usePanelStale();
  const id = Symbol('car-fields');
  const ages = $derived.by(() => {
    const out = new Map<CarFieldPath, number>();
    const c = car();
    for (const field of c?.fields ?? []) {
      const ms = carFieldStaleMs(c?.updatedAt, field, panel?.clock);
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
