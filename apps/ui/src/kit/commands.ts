// Commands for widgets (C72, C74): the context through which the panel hands the shell's commands to the widget below
// it. Only the ids a widget's declaration lists reach the registry; the registry's command sends the uiAction and
// resolves with its outcome (C73).
import type { ActionOutcome } from '@pitwall/contracts';
import { getContext, setContext } from 'svelte';
import type { InvokeCommand, WidgetCommandId } from './command-types.ts';

export type { InvokeCommand, WidgetCommandArgs, WidgetCommandId } from './command-types.ts';

const KEY = Symbol('widget-commands');
type Commands = { invoke: InvokeCommand };

const NOT_SUPPORTED: ActionOutcome = { ok: false, reason: 'notSupported' };

/**
 * Called by the panel: makes `invoke` (the registry's) available to the widget below it, for the ids in `commands`
 * (`decl.commands`). An id the widget did not declare is never invoked: in dev it throws, in production it resolves
 * `notSupported`.
 */
export function setWidgetCommands(invoke: InvokeCommand, commands: readonly WidgetCommandId[]): void {
  const declared = new Set<WidgetCommandId>(commands);
  setContext<Commands>(KEY, {
    invoke: (id, args) => {
      if (declared.has(id)) return invoke(id, args);
      if (import.meta.env.DEV) throw new Error(`command "${id}" is not declared by the widget (C74)`);
      return Promise.resolve(NOT_SUPPORTED);
    },
  });
}

/**
 * The commands of the panel above; outside a panel (gallery, a widget rendered alone) `invoke` runs nothing and
 * resolves `notSupported`: a control wired to nothing answers with a rejection, never a silent `ok` (C73).
 */
export function getWidgetCommands(): Commands {
  return getContext<Commands | undefined>(KEY) ?? { invoke: () => Promise.resolve(NOT_SUPPORTED) };
}
