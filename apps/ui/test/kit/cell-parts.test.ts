// @vitest-environment jsdom
// The kit draws a cell's parts (review 7, R7-8): one component renders a `CellPart[]`, so no display or gallery cell
// writes its own loop over parts. Contract the tests assume of kit/values/CellParts.svelte:
//  - props `{ parts: readonly CellPart[]; separator?: string }`;
//  - each part in order, as the kit's `TextCell` shows it: a known part's text as given, a part with a reason its
//    reason's mark (`unknownMark`) in the faint role with the reason's hover text (`unknownReason`) as its title;
//  - `separator` (none by default) goes between neighbouring parts only: never before the first or after the last;
//  - no parts draw nothing.
// Also: no other Svelte source loops over cell parts itself (`{#each … as part…}`); the incident feed, the gap chart's
// reference line, the damage card's jump loss (review 9, R9-1) and the gallery's position-pair cell draw their parts
// through this component.
import type { UnknownReason } from '@pitwall/domain';
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { unknownPart, type CellPart } from '../../src/kit/grid/grid.ts';
import { unknownMark, unknownReason } from '../../src/kit/text.ts';
import CellParts from '../../src/kit/values/CellParts.svelte';
import { role } from '../../src/theme/index.ts';

afterEach(cleanup);

const REASONS = Object.keys(unknownReason) as UnknownReason[];
const draw = (parts: readonly CellPart[], separator?: string): HTMLElement =>
  render(CellParts, { props: separator === undefined ? { parts } : { parts, separator } }).container;
/** The elements with a hover text, by the text they show. */
const titled = (c: HTMLElement): Array<[string, string | null]> =>
  [...c.querySelectorAll<HTMLElement>('[title]')].map((e) => [e.textContent ?? '', e.getAttribute('title')]);

describe('CellParts', () => {
  it('draws the known parts as given, in order, with nothing between them', () => {
    expect(draw([{ text: 'P7' }, { text: '→' }, { text: 'P9' }]).textContent).toBe('P7→P9');
  });

  it.each(REASONS)('draws a part with a reason (%s) as its mark, faint, with the reason on hover', (reason) => {
    const c = draw([{ text: 'P7' }, { text: '→' }, unknownPart(reason)]);
    expect(c.textContent).toBe(`P7→${unknownMark[reason]}`);
    expect(titled(c)).toEqual([[unknownMark[reason], unknownReason[reason]]]);
    const mark = c.querySelector<HTMLElement>('[title]');
    expect(mark?.style.color).toBe(role('textFaint'));
  });

  it('keeps every mark at its own place among the known parts', () => {
    const c = draw([unknownPart('notReceived'), { text: '→' }, unknownPart('insufficientData')]);
    expect(c.textContent).toBe(`${unknownMark.notReceived}→${unknownMark.insufficientData}`);
    expect(titled(c)).toEqual([
      [unknownMark.notReceived, unknownReason.notReceived],
      [unknownMark.insufficientData, unknownReason.insufficientData],
    ]);
  });

  it('gives a known part no hover text', () => {
    expect(titled(draw([{ text: 'ref' }, { text: 'leader avg' }]))).toEqual([]);
  });

  it('puts the separator between neighbouring parts only', () => {
    expect(draw([{ text: 'ref' }, { text: 'leader avg' }, unknownPart('insufficientData')], ' ').textContent).toBe(
      `ref leader avg ${unknownMark.insufficientData}`,
    );
    expect(draw([{ text: 'ref' }], ' ').textContent).toBe('ref');
  });

  it('draws nothing for no parts', () => {
    expect(draw([]).textContent).toBe('');
    expect(draw([], ' ').textContent).toBe('');
  });
});

// The UI's types have no Node, so fs is typed here.
const FS = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ FS)) as { readFileSync(path: URL, encoding: 'utf8'): string };

// Every Svelte source (the glob only lists them; nothing is imported) but the component itself.
const SVELTE = Object.keys(import.meta.glob(['../../src/**/*.svelte', '!../../src/kit/values/CellParts.svelte']));
const source = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
/** A loop over parts: an `{#each … as part…}` block (each of today's copies binds `part`). */
const PART_LOOP = /\{#each\s[^}]*\bas\s+part\b/;

describe('one drawing of cell parts', () => {
  it('the glob finds the Svelte sources that draw parts', () => {
    expect(SVELTE.map((p) => p.replace('../../src/', ''))).toEqual(
      expect.arrayContaining(['widgets/incident-feed/IncidentFeed.svelte', 'widgets/gap-chart/GapChart.svelte', 'gallery/KitParts.svelte']),
    );
  });

  it('no Svelte source loops over cell parts itself: it draws them with the kit CellParts', () => {
    expect(SVELTE.filter((p) => PART_LOOP.test(source(p))).map((p) => p.replace('../../src/', ''))).toEqual([]);
  });

  it.each(['widgets/incident-feed/IncidentFeed.svelte', 'widgets/gap-chart/GapChart.svelte', 'widgets/damage-card/DamageCard.svelte', 'gallery/KitParts.svelte'])(
    '%s draws its parts with the kit CellParts',
    (file) => {
      expect(source(`../../src/${file}`)).toMatch(/import CellParts from '[./]+kit\/values\/CellParts\.svelte'/);
    },
  );
});
