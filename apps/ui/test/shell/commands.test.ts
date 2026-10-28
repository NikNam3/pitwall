// @vitest-environment jsdom
// CommandRegistry and the command palette (spec 7.7).
// Contract assumed of Palette.svelte: props `{ registry: CommandRegistry; bindings: ReadonlyMap<string, string> /* key -> command id */;
// onClose?: () => void }`; one text input (role textbox) filters by a fuzzy match on the command titles; each result shows
// its title and, when bound, its key.
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandRegistry, type Command } from '../../src/shell/commands/registry.ts';
import Palette from '../../src/shell/commands/Palette.svelte';

afterEach(cleanup);

const cmd = (id: string, title: string, run: () => void = () => {}): Command => ({ id, title, group: id.split('.')[0]!, run });

describe('CommandRegistry', () => {
  it('run calls the command and returns true; an unknown id returns false and calls nothing', () => {
    const registry = new CommandRegistry();
    const run = vi.fn();
    registry.register(cmd('alerts.ackAll', 'Acknowledge all alerts', run));
    expect(registry.run('alerts.ackAll')).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(registry.run('nope')).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('register returns an unregister function; afterwards the command is neither listed nor runnable', () => {
    const registry = new CommandRegistry();
    const run = vi.fn();
    const off = registry.register(cmd('a.b', 'A B', run));
    registry.register(cmd('c.d', 'C D'));
    off();
    expect(registry.run('a.b')).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(registry.list().map((c) => c.id)).toEqual(['c.d']);
  });

  it('list returns every registered command with its id, title and group', () => {
    const registry = new CommandRegistry();
    expect(registry.list()).toEqual([]);
    registry.register(cmd('workbook.pick', 'Pick a workbook'));
    registry.register(cmd('palette.open', 'Command palette'));
    expect(registry.list().map((c) => [c.id, c.title, c.group]).sort()).toEqual([
      ['palette.open', 'Command palette', 'palette'],
      ['workbook.pick', 'Pick a workbook', 'workbook'],
    ]);
  });
});

describe('Palette', () => {
  const setup = () => {
    const registry = new CommandRegistry();
    registry.register(cmd('alerts.ackAll', 'Acknowledge all alerts'));
    registry.register(cmd('workbook.pick', 'Pick a workbook'));
    registry.register(cmd('realism.toggle', 'Toggle realism mode'));
    const bindings = new Map([
      ['Ctrl+Enter', 'alerts.ackAll'],
      ['Ctrl+O', 'workbook.pick'],
    ]);
    return render(Palette, { registry, bindings });
  };

  it('typing "ack" lists alerts.ackAll with its key Ctrl+Enter, and not the commands that do not match', async () => {
    setup();
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'ack' } });
    expect(screen.getByText('Acknowledge all alerts')).toBeTruthy();
    expect(screen.getByText('Ctrl+Enter')).toBeTruthy();
    expect(screen.queryByText('Pick a workbook')).toBeNull();
    expect(screen.queryByText('Toggle realism mode')).toBeNull();
    expect(screen.queryByText('Ctrl+O')).toBeNull();
  });

  it('matches fuzzily: the typed letters appear in order in the title', async () => {
    setup();
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'pkwb' } });
    expect(screen.getByText('Pick a workbook')).toBeTruthy();
    expect(screen.queryByText('Acknowledge all alerts')).toBeNull();
  });

  it('an empty query lists every command', () => {
    setup();
    for (const title of ['Acknowledge all alerts', 'Pick a workbook', 'Toggle realism mode']) expect(screen.getByText(title)).toBeTruthy();
  });
});
