// Key names (spec 7.7): `keys.json` spellings and keydown events normalise to the `Ctrl+Shift+K` style.
import { describe, expect, it } from 'vitest';
import * as text from '../../src/kit/text.ts';
import { eventKey, normaliseKey, parseKeys } from '../../src/shell/commands/keys.ts';

const ev = (key: string, mods: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {}) => ({
  key, ctrlKey: mods.ctrl === true, altKey: mods.alt === true, shiftKey: mods.shift === true, metaKey: mods.meta === true,
});

describe('normaliseKey', () => {
  it.each([
    ['  ctrl+k  ', 'Ctrl+K'],
    ['shift+ctrl+k', 'Ctrl+Shift+K'],
    ['META+alt+ctrl+shift+x', 'Ctrl+Alt+Shift+Meta+X'],
    ['control+k', 'Ctrl+K'],
    ['cmd+k', 'Meta+K'],
    ['ctrl+alt+delete', 'Ctrl+Alt+Delete'],
    ['esc', 'Escape'],
    ['ESC', 'Escape'],
    ['return', 'Enter'],
    ['ctrl+space', 'Ctrl+Space'],
    ['pagedown', 'PageDown'],
    ['ARROWUP', 'ArrowUp'],
    ['f12', 'F12'],
    ['FOO', 'Foo'],
    ['k', 'K'],
    ['?', '?'],
  ])('%j -> %s', (raw, expected) => {
    expect(normaliseKey(raw)).toBe(expected);
  });

  it('a plus sign as the key itself ends the text', () => {
    expect(normaliseKey('+')).toBe('+');
    expect(normaliseKey('Ctrl++')).toBe('Ctrl++');
    expect(normaliseKey('ctrl+alt++')).toBe('Ctrl+Alt++');
    expect(normaliseKey('Ctrl+Shift++')).toBe('Ctrl++');
  });

  it('Shift is not part of the name of a symbol key, but is of a letter, a digit and a named key', () => {
    expect(normaliseKey('shift+?')).toBe('?');
    expect(normaliseKey('ctrl+shift+?')).toBe('Ctrl+?');
    expect(normaliseKey('shift+k')).toBe('Shift+K');
    expect(normaliseKey('shift+1')).toBe('Shift+1');
    expect(normaliseKey('shift+enter')).toBe('Shift+Enter');
  });

  it('empty parts between plus signs are ignored', () => {
    expect(normaliseKey('ctrl++k')).toBe('Ctrl+K');
    expect(normaliseKey('ctrl+')).toBe('Ctrl');
  });
});

describe('eventKey', () => {
  it('names the held modifiers in the fixed order, then the key', () => {
    expect(eventKey(ev('a', { ctrl: true, alt: true, shift: true, meta: true }))).toBe('Ctrl+Alt+Shift+Meta+A');
    expect(eventKey(ev('a'))).toBe('A');
  });
  it.each([
    ['Ctrl', { ctrl: true }],
    ['Alt', { alt: true }],
    ['Shift', { shift: true }],
    ['Meta', { meta: true }],
  ])('%s alone', (name, mods) => {
    expect(eventKey(ev('a', mods))).toBe(`${name}+A`);
  });
  it('a symbol typed with Shift is the symbol alone; with Ctrl the Ctrl stays', () => {
    expect(eventKey(ev('?', { shift: true }))).toBe('?');
    expect(eventKey(ev('?', { ctrl: true, shift: true }))).toBe('Ctrl+?');
    expect(eventKey(ev('+', { ctrl: true, shift: true }))).toBe('Ctrl++');
  });
  it('Shift stays with a letter, a digit and a named key', () => {
    expect(eventKey(ev('K', { shift: true }))).toBe('Shift+K');
    expect(eventKey(ev('1', { shift: true }))).toBe('Shift+1');
    expect(eventKey(ev('Enter', { shift: true }))).toBe('Shift+Enter');
  });
  it('names keys as KeyboardEvent spells them', () => {
    expect(eventKey(ev(' '))).toBe('Space');
    expect(eventKey(ev('Escape'))).toBe('Escape');
    expect(eventKey(ev('ArrowLeft', { alt: true }))).toBe('Alt+ArrowLeft');
    expect(eventKey(ev('F5'))).toBe('F5');
  });
});

describe('parseKeys notes', () => {
  const ids = new Set(['palette.open']);
  it('a value that is not a string is one note of its own, not also an unknown command', () => {
    const { bindings, notes } = parseKeys({ f2: 5 }, ids, {});
    expect(notes).toEqual([text.keyNotString('F2')]);
    expect(bindings.size).toBe(0);
  });
});
