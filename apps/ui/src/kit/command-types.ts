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

/** A command that sends its uiAction: its id is the uiAction's kind. */
export type ActionCommandId = (typeof WIDGET_COMMAND_IDS)[number];

/**
 * The ids of the shell commands without arguments a widget may invoke (SP4.3f Task 10): each opens a shell overlay and
 * is no uiAction kind; invoking one resolves `ok` once it ran. `plans.save.pick`: the name prompt "Save plan".
 */
export const SHELL_WIDGET_COMMAND_IDS = ['plans.save.pick'] as const;

export type ShellWidgetCommandId = (typeof SHELL_WIDGET_COMMAND_IDS)[number];

export type WidgetCommandId = ActionCommandId | ShellWidgetCommandId;

/** True for a shell command without arguments. */
export const isShellWidgetCommand = (id: WidgetCommandId): id is ShellWidgetCommandId => (SHELL_WIDGET_COMMAND_IDS as readonly string[]).includes(id);

/** The arguments of command `K`: its uiAction without `kind` (the feed included: the widget's link's); none for a shell command. */
export type WidgetCommandArgs<K extends WidgetCommandId> = K extends ActionCommandId ? Omit<Extract<UiAction, { kind: K }>, 'kind'> : Record<string, never>;

/** Invokes command `id` with its arguments; resolves with the uiAction's outcome. */
export type InvokeCommand = <K extends WidgetCommandId>(id: K, args: WidgetCommandArgs<K>) => Promise<ActionOutcome>;
