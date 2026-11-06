// @vitest-environment jsdom
// The source badge (spec 4.4, plan Task 12; C43, C65, C68). Contract the tests assume of `kit/values/SourceBadge.svelte`:
//  - props `{ source: EstimateSource }`, nothing else;
//  - it maps `source.kind` only: `session` renders no mark, `calibration` renders `ᶜ`, `default` renders `ᵈ`. It never
//    reads `sessionShare`: the calculator decided the kind with spec 4.4's half rule (C43), the badge only shows it (C65);
//  - the element carrying the hover is the one with a `title` attribute, also for `session` (every badged value carries
//    its hover with its parts):
//      calibration: `calibration · <setName> · <n> sources · <parts>` (`1 source` for one)
//      default:     `default · <note>`
//      session:     `session · <parts>`
//  - its marks and hover words are kit text (kit/text.ts): the component's code holds no non-ASCII character.
import type { EstimateSource } from '@pitwall/domain';
import { cleanup, render } from '@testing-library/svelte';
import type { ComponentProps } from 'svelte';
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import SourceBadge from '../../src/kit/values/SourceBadge.svelte';

afterEach(cleanup);

const mount = (source: EstimateSource): HTMLElement => render(SourceBadge, { source }).container;
const mark = (source: EstimateSource): string => mount(source).textContent?.trim() ?? '';
const hover = (source: EstimateSource): string | null => mount(source).querySelector('[title]')?.getAttribute('title') ?? null;

const calibration: EstimateSource = {
  kind: 'calibration', setName: 'league', sources: 4, sessionShare: 0.25, parts: '1 stop (race 15 Oct) + 0 stops this session',
};
const fallback: EstimateSource = { kind: 'default', note: 'Silverstone track file: community value (R3)', sessionShare: 0, parts: 'track file' };
const session: EstimateSource = { kind: 'session', sessionShare: 0.75, parts: '6 stops + league 20.4 (75 % session)' };

describe('SourceBadge: the mark per kind', () => {
  it('a calibration source shows ᶜ', () => {
    expect(mark(calibration)).toBe('ᶜ');
  });
  it('a default source shows ᵈ', () => {
    expect(mark(fallback)).toBe('ᵈ');
  });
  it('a session source shows no mark', () => {
    expect(mark(session)).toBe('');
  });
});

describe('SourceBadge: the hover per kind', () => {
  it('calibration: the word, the set name, its sources and the parts', () => {
    expect(hover(calibration)).toBe('calibration · league · 4 sources · 1 stop (race 15 Oct) + 0 stops this session');
  });
  it('calibration with one source: "1 source"', () => {
    expect(hover({ ...calibration, setName: 'pre-season', sources: 1 })).toBe(
      'calibration · pre-season · 1 source · 1 stop (race 15 Oct) + 0 stops this session',
    );
  });
  it('default: the word and the source note', () => {
    expect(hover(fallback)).toBe('default · Silverstone track file: community value (R3)');
  });
  it('session: the word and the parts, though no mark shows', () => {
    expect(hover(session)).toBe('session · 6 stops + league 20.4 (75 % session)');
  });
});

describe('SourceBadge never reads sessionShare: the calculator decided the kind (C43)', () => {
  it.each([0, 0.1, 0.5, 0.51, 0.99, 1])('a session source with sessionShare %s shows no mark', (sessionShare) => {
    expect(mark({ ...session, sessionShare })).toBe('');
  });
  it.each([0, 0.5, 0.9, 1])('a calibration source with sessionShare %s still shows ᶜ', (sessionShare) => {
    expect(mark({ ...calibration, sessionShare })).toBe('ᶜ');
  });
  it.each([0, 0.9])('a default source with sessionShare %s still shows ᵈ', (sessionShare) => {
    expect(mark({ ...fallback, sessionShare })).toBe('ᵈ');
  });
});

describe('SourceBadge props', () => {
  it('are { source: EstimateSource }', () => {
    expectTypeOf<ComponentProps<typeof SourceBadge>>().toEqualTypeOf<{ source: EstimateSource }>();
  });
});

// The UI's types have no Node, so fs is typed here.
const FS = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ FS)) as { readFileSync(path: URL, encoding: 'utf8'): string };
const source = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
/** A source without its comments (JS block and line comments, HTML comments). */
const code = (text: string): string =>
  text.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('the badge\'s marks and words are kit text (C68)', () => {
  it('SourceBadge.svelte holds no fixed glyph in its code: every non-ASCII character is in kit/text.ts', () => {
    expect([...code(source('../../src/kit/values/SourceBadge.svelte'))].filter((c) => c > '\u007f')).toEqual([]);
  });
  it('kit/text.ts holds the calibration and default marks', () => {
    const text = code(source('../../src/kit/text.ts'));
    for (const glyph of ['ᶜ', 'ᵈ']) expect(text, glyph).toContain(glyph);
  });
});
