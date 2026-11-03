// Every sub-machine's scope, read from its span declaration (contract C15, C26): readers find a machine's scope here,
// never in a sub-machine's code. Outside `situations/`, so the folder holds declarations and their generated index only.
import type { MachineId, Scope } from './facts.ts';
import { SPAN_DECLARATIONS } from './situations/index.generated.ts';

export { SPAN_DECLARATIONS };

/** The scope `machine` declares; `undefined` for a machine without a span declaration. */
export const scopeOf = (machine: MachineId): Scope | undefined => SPAN_DECLARATIONS.find((d) => d.machine === machine)?.scope;
