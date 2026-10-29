// The shell's control look (shell/controls.css): keyboard focus is drawn with the theme's `focus` role, never the
// browser's own accent, on the select and on the options of its open list.
import { describe, expect, it } from 'vitest';

// Read from disk: Vitest serves CSS imports (also `?raw`) empty. The UI's types have no Node, so fs is typed here.
const FS = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ FS)) as { readFileSync(path: URL, encoding: 'utf8'): string };
const css = readFileSync(new URL('../../src/shell/controls.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (selector: string): string => {
  const at = css.split('}').find((block: string) => block.split('{')[0]?.split(',').some((s: string) => s.trim() === selector));
  return at ?? '';
};

describe('controls.css focus', () => {
  it.each(['select.pw-input:focus-visible', 'select.pw-input option:focus-visible'])('%s uses the focus role', (selector) => {
    expect(rule(selector)).toContain('var(--pw-focus)');
  });
});
