// Browser shortcuts the desktop shell blocks outside --dev (pure; the Electron `before-input-event` only calls this).
// Assumed: `apps/desktop/src/blocked-keys.ts` exports `isBlockedKey(input: { key: string; control: boolean; shift: boolean; alt: boolean }, dev: boolean): boolean`
// and the main process uses it. Electron's default menu accelerators (zoom, force reload) clash with the UI's font keys.
import { describe, expect, it } from 'vitest';
import { isBlockedKey } from '../src/blocked-keys.ts';

const press = (key: string, mods: { control?: boolean; shift?: boolean; alt?: boolean } = {}) => ({ key, control: false, shift: false, alt: false, ...mods });

describe('isBlockedKey outside --dev', () => {
  it.each([
    ['Ctrl+W', press('w', { control: true })],
    ['Ctrl+R', press('r', { control: true })],
    ['Ctrl+Shift+R (force reload)', press('R', { control: true, shift: true })],
    ['F5', press('F5')],
    ['Alt+Left', press('ArrowLeft', { alt: true })],
    ['Alt+Right', press('ArrowRight', { alt: true })],
    ['Ctrl+Shift+I', press('I', { control: true, shift: true })],
    ['Ctrl+= (zoom in)', press('=', { control: true })],
    ['Ctrl++ (zoom in)', press('+', { control: true, shift: true })],
    ['Ctrl+- (zoom out)', press('-', { control: true })],
    ['Ctrl+_ (zoom out)', press('_', { control: true, shift: true })],
    ['Ctrl+0 (zoom reset)', press('0', { control: true })],
  ])('blocks %s', (_name, input) => {
    expect(isBlockedKey(input, false)).toBe(true);
  });

  it.each([
    ['a plain letter', press('r')],
    ['Ctrl+K (the palette)', press('k', { control: true })],
    ['Ctrl+Shift+K', press('K', { control: true, shift: true })],
    ['Ctrl+N (a workbook switch)', press('n', { control: true })],
    ['a plain minus', press('-')],
    ['Enter', press('Enter')],
  ])('lets %s through', (_name, input) => {
    expect(isBlockedKey(input, false)).toBe(false);
  });
});

describe('isBlockedKey with --dev', () => {
  it.each([press('r', { control: true }), press('R', { control: true, shift: true }), press('=', { control: true }), press('F5'), press('I', { control: true, shift: true })])(
    'blocks nothing (%j)',
    (input) => {
      expect(isBlockedKey(input, true)).toBe(false);
    },
  );
});
