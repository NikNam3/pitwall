// UI actions for widgets: the panel hands its `send` and the widget's declared action kinds (C74) to the widget below it
// through a context, so a widget can acknowledge, mute, etc., but only with the kinds its declaration lists.
import type { UiAction } from '@pitwall/contracts';
import { getContext, setContext } from 'svelte';

const KEY = Symbol('ui-actions');
type Actions = { send: (action: UiAction) => void };

/**
 * Called by the panel: makes `send` available to the widget below it, for the kinds in `actions` (`decl.actions`).
 * A kind the widget did not declare is never sent: in dev it throws, in production it is dropped.
 */
export function setUiActions(send: (action: UiAction) => void, actions: readonly UiAction['kind'][]): void {
  const declared = new Set<UiAction['kind']>(actions);
  setContext<Actions>(KEY, {
    send: (action) => {
      if (declared.has(action.kind)) {
        send(action);
        return;
      }
      if (import.meta.env.DEV) throw new Error(`uiAction "${action.kind}" is not declared by the widget (C74)`);
    },
  });
}

/** The actions of the panel above; a no-op `send` outside a panel (gallery, tests). */
export function getUiActions(): Actions {
  return getContext<Actions | undefined>(KEY) ?? { send: () => {} };
}
