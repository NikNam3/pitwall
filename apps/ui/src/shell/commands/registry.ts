// The one registry of shell commands (spec 7.7): every action is a command with an id you can find and bind.

/** A named action. `id` is dotted (`workbook.open.3`); `group` is the heading in the key overview. */
export type Command = { id: string; title: string; group: string; run: () => void };

/** Commands by id. */
export class CommandRegistry {
  readonly #commands = new Map<string, Command>();

  /** Adds a command (a second one with the same id replaces it); returns the function that removes it again. */
  register(command: Command): () => void {
    this.#commands.set(command.id, command);
    return () => {
      if (this.#commands.get(command.id) === command) this.#commands.delete(command.id);
    };
  }

  /** Runs the command; false when there is none with this id. */
  run(id: string): boolean {
    const command = this.#commands.get(id);
    if (command === undefined) return false;
    command.run();
    return true;
  }

  /** Every registered command, in registration order. */
  list(): Command[] {
    return [...this.#commands.values()];
  }
}
