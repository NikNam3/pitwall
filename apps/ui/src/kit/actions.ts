// UI actions for widgets: the panel hands its `send` and the widget's declared action kinds (C74) to the widget below it
// through a context, so a widget can acknowledge, mute, etc., but only with the kinds its declaration lists.
import type { ActionOutcome, UiAction } from '@pitwall/contracts';
import { getContext, setContext } from 'svelte';

const KEY = Symbol('ui-actions');
/** `send` resolves with the action's outcome: the bridge's answer, or a rejection the UI shows (C73). */
type Actions = { send: (action: UiAction) => Promise<ActionOutcome> };

/** The panel's `send`: the topic store's outcome passed through, or nothing (counted as accepted). */
type PanelSend = ((action: UiAction) => Promise<ActionOutcome>) | ((action: UiAction) => void);

const OK: ActionOutcome = { ok: true };
const NOT_DECLARED: ActionOutcome = { ok: false, reason: 'notSupported' };

/**
 * Called by the panel: makes `send` available to the widget below it, for the kinds in `actions` (`decl.actions`).
 * A kind the widget did not declare is never sent: in dev it throws, in production it resolves `notSupported`.
 */
export function setUiActions(send: PanelSend, actions: readonly UiAction['kind'][]): void {
  const declared = new Set<UiAction['kind']>(actions);
  setContext<Actions>(KEY, {
    send: (action) => {
      if (declared.has(action.kind)) return send(action) ?? Promise.resolve(OK);
      if (import.meta.env.DEV) throw new Error(`uiAction "${action.kind}" is not declared by the widget (C74)`);
      return Promise.resolve(NOT_DECLARED);
    },
  });
}

/** The actions of the panel above; outside a panel (gallery, tests) `send` sends nothing and resolves `ok`. */
export function getUiActions(): Actions {
  return getContext<Actions | undefined>(KEY) ?? { send: () => Promise.resolve(OK) };
}
