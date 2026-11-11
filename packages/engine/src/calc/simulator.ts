// The simulator marker (contract C50): a simulator unit's `index.ts` exports `SIMULATOR = defineSimulator('<name>')`,
// so the catalogue finds simulators by convention (C63). A simulator has no reads, no cadence and no topic.

/** A simulator unit's marker. */
export type SimulatorMarker<N extends string = string> = { readonly kind: 'simulator'; readonly name: N };

/** The marker of the simulator `name` (its unit folder's name). */
export const defineSimulator = <const N extends string>(name: N): SimulatorMarker<N> => ({ kind: 'simulator', name });
