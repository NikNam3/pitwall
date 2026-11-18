// The one registry of shell commands (spec 7.7): every action is a command with an id you can find and bind.
import type { ActionOutcome } from '@pitwall/contracts';
import { isShellWidgetCommand, type ActionCommandId, type WidgetCommandArgs, type WidgetCommandId } from '../../kit/command-types.ts';

/** A named action. `id` is dotted (`workbook.open.3`); `group` is the heading in the key overview. */
export type Command = { id: string; title: string; group: string; run: () => void };

/**
 * A named action that takes arguments (C72): a widget invokes it by id through its panel (C74), and the palette and keys
 * through the zero-argument commands the shell derives from it where the shell can supply the arguments. `run` resolves
 * with the outcome of the uiAction it sends (C73).
 */
export type ArgCommand<K extends ActionCommandId = ActionCommandId> = {
  id: K;
  title: string;
  group: string;
  run: (args: WidgetCommandArgs<K>) => Promise<ActionOutcome>;
};

const NOT_REGISTERED: ActionOutcome = { ok: false, reason: 'notSupported' };
const RAN: ActionOutcome = { ok: true };

/** Commands by id. */
export class CommandRegistry {
  readonly #commands = new Map<string, Command>();
  readonly #withArgs = new Map<ActionCommandId, ArgCommand>();

  /** Adds a command (a second one with the same id replaces it); returns the function that removes it again. */
  register(command: Command): () => void {
    this.#commands.set(command.id, command);
    return () => {
      if (this.#commands.get(command.id) === command) this.#commands.delete(command.id);
    };
  }

  /** Adds a command that takes arguments (a second one with the same id replaces it); returns the function that removes it. */
  registerWithArgs<K extends ActionCommandId>(command: ArgCommand<K>): () => void {
    const stored = command as unknown as ArgCommand;
    this.#withArgs.set(command.id, stored);
    return () => {
      if (this.#withArgs.get(command.id) === stored) this.#withArgs.delete(command.id);
    };
  }

  /** Runs the command; false when there is none with this id. */
  run(id: string): boolean {
    const command = this.#commands.get(id);
    if (command === undefined) return false;
    command.run();
    return true;
  }

  /**
   * Runs the command `id` with `args`; resolves `notSupported` when there is none with this id. A shell command without
   * arguments (`SHELL_WIDGET_COMMAND_IDS`) runs the registered command of that id and resolves `ok` once it ran.
   */
  invoke<K extends WidgetCommandId>(id: K, args: WidgetCommandArgs<K>): Promise<ActionOutcome> {
    if (isShellWidgetCommand(id)) return Promise.resolve(this.run(id) ? RAN : NOT_REGISTERED);
    const command = this.#withArgs.get(id as ActionCommandId) as ArgCommand<ActionCommandId> | undefined;
    return command === undefined ? Promise.resolve(NOT_REGISTERED) : command.run(args as WidgetCommandArgs<ActionCommandId>);
  }

  /** Every registered command without arguments, in registration order (the palette and the keys run these). */
  list(): Command[] {
    return [...this.#commands.values()];
  }

  /** Every registered command that takes arguments, in registration order. */
  listWithArgs(): ArgCommand[] {
    return [...this.#withArgs.values()];
  }
}
