// The shell commands a widget may invoke by id with arguments (C72, C74), and their argument types. No Svelte or DOM
// here: Node scripts import every widget.ts, whose declaration lists these ids.
import type { ActionOutcome, UiAction } from '@pitwall/contracts';

/** The ids of the shell commands that take arguments from a widget: the planning round's controls (SP4.3d2 call 10). */
export const WIDGET_COMMAND_IDS = [
  'plans.race.set',
  'plans.prepare.save',
  'plans.prepare.accept',
  'plans.prepare.remove',
  'plans.prepare.activate',
  'plan.accept',
] as const satisfies readonly UiAction['kind'][];

export type WidgetCommandId = (typeof WIDGET_COMMAND_IDS)[number];

/** The arguments of command `K`: its uiAction without `kind` (the feed included: the widget's link's). */
export type WidgetCommandArgs<K extends WidgetCommandId> = Omit<Extract<UiAction, { kind: K }>, 'kind'>;

/** Invokes command `id` with its arguments; resolves with the uiAction's outcome. */
export type InvokeCommand = <K extends WidgetCommandId>(id: K, args: WidgetCommandArgs<K>) => Promise<ActionOutcome>;
