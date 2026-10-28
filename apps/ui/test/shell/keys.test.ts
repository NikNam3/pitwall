// parseKeys (spec 7.7): keys.json is read leniently; every ignored entry leaves a note for the key overview.
// Contract assumed: a note is one string that names the offending key and (where there is one) the command id.
import { describe, expect, it } from 'vitest';
import { parseKeys } from '../../src/shell/commands/keys.ts';

const IDS: ReadonlySet<string> = new Set(['palette.open', 'alerts.ackAll', 'keys.overview', 'workbook.pick']);
const DEFAULTS = { 'Ctrl+K': 'palette.open', 'Ctrl+Enter': 'alerts.ackAll', '?': 'keys.overview' };

describe('parseKeys', () => {
  it('no file: the defaults, no notes', () => {
    const { bindings, notes } = parseKeys({}, IDS, DEFAULTS);
    expect([...bindings]).toEqual(Object.entries(DEFAULTS));
    expect(notes).toEqual([]);
  });

  it('normalises keys to the Ctrl+Shift+K style', () => {
    const { bindings, notes } = parseKeys({ 'shift+ctrl+k': 'workbook.pick' }, IDS, {});
    expect(bindings.get('Ctrl+Shift+K')).toBe('workbook.pick');
    expect(bindings.size).toBe(1);
    expect(notes).toEqual([]);
  });

  it('a file binding overrides the default on the same key', () => {
    const { bindings, notes } = parseKeys({ 'Ctrl+K': 'workbook.pick', 'F2': 'palette.open' }, IDS, DEFAULTS);
    expect(bindings.get('Ctrl+K')).toBe('workbook.pick');
    expect(bindings.get('F2')).toBe('palette.open');
    expect(bindings.get('Ctrl+Enter')).toBe('alerts.ackAll');
    expect(notes).toEqual([]);
  });

  it('an unknown command is ignored with a note naming the key and the command', () => {
    const { bindings, notes } = parseKeys({ 'Ctrl+W': 'close' }, IDS, DEFAULTS);
    expect(bindings.has('Ctrl+W')).toBe(false);
    expect(bindings.get('Ctrl+K')).toBe('palette.open');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('Ctrl+W');
    expect(notes[0]).toContain('close');
  });

  it('a key bound twice: the first one in file order wins, the second leaves a note', () => {
    const { bindings, notes } = parseKeys({ 'ctrl+p': 'workbook.pick', 'Ctrl+P': 'palette.open' }, IDS, {});
    expect(bindings.get('Ctrl+P')).toBe('workbook.pick');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('Ctrl+P');
    expect(notes[0]).toContain('palette.open');
  });

  it('a value that is not a string is ignored with a note, and the default of that key stays', () => {
    const { bindings, notes } = parseKeys({ 'Ctrl+K': 42, F3: null }, IDS, DEFAULTS);
    expect(bindings.get('Ctrl+K')).toBe('palette.open');
    expect(bindings.has('F3')).toBe(false);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toContain('Ctrl+K');
    expect(notes[1]).toContain('F3');
  });
});
