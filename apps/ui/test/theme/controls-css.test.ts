// The shell's control look (shell/controls.css): keyboard focus is drawn with the theme's `focus` role, never the
// browser's own accent, on the select and on the options of its open list.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../src/shell/controls.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (selector: string): string => {
  const at = css.split('}').find((block) => block.split('{')[0]?.split(',').some((s) => s.trim() === selector));
  return at ?? '';
};

describe('controls.css focus', () => {
  it.each(['select.pw-input:focus-visible', 'select.pw-input option:focus-visible'])('%s uses the focus role', (selector) => {
    expect(rule(selector)).toContain('var(--pw-focus)');
  });
});
