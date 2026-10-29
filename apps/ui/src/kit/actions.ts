// UI actions for widgets: the panel hands its `send` to every widget through a context, so a widget can acknowledge, mute, etc.
import type { UiAction } from '@pitwall/contracts';
import { getContext, setContext } from 'svelte';

const KEY = Symbol('ui-actions');
type Actions = { send: (action: UiAction) => void };

/** Called by the panel: makes `send` available to the widget below it. */
export function setUiActions(send: (action: UiAction) => void): void {
  setContext<Actions>(KEY, { send: (action) => send(action) });
}

/** The actions of the panel above; a no-op `send` outside a panel (gallery, tests). */
export function getUiActions(): Actions {
  return getContext<Actions | undefined>(KEY) ?? { send: () => {} };
}
