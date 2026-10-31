// The unknown value's cell part is built by one kit function (review 6, R6-4). Contract assumed of `kit/grid/grid.ts`,
// next to `CellPart` (the grid's convention, read by `fitParts`):
//  - `unknownPart(reason)`: the part of an unknown value, `{ text: '', reason }` (its mark shows in place);
//  - `knownPart(v, format)`: a `Known<T>` as a part: `{ text: format(value) }` (no `reason` key) when known, else
//    `unknownPart(v.reason)`; `format` is not called for an unknown;
//  - no other UI source spells the unknown part out by hand: displays and the kit build it through these two. "By hand"
//    is the convention, not a field order (review 7, R7-6): one object literal with an empty `text` and a `reason` key,
//    in any order, with any spacing and any other fields (a cell that extends the part spreads `unknownPart(reason)`);
//  - no UI source restates the part's type (R7-7): an object type of exactly `text: string` and `reason?: UnknownReason`
//    is `CellPart`;
//  - no UI source repeats the part's fields in a wider type (review 8, R8-6): an object type that holds `text: string`
//    and `reason?: UnknownReason` among other fields is the part plus those fields, written `CellPart & { … }` (the
//    literal after `CellPart &` holds only the other fields). `WIDENED_ELSEWHERE` names the types whose text and reason
//    follow another convention than the part's (the reason is not that of the text).
// The grid does not import kit/values (the dependency goes values -> grid); that is a depcruise rule, not a test here.
import { known, unknown, type Known, type UnknownReason } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { knownPart, unknownPart } from '../../src/kit/grid/grid.ts';
import { unknownReason } from '../../src/kit/text.ts';

const REASONS = Object.keys(unknownReason) as UnknownReason[];

describe('unknownPart', () => {
  it.each(REASONS)('%s: an empty text with the reason, so the mark shows in place', (reason) => {
    expect(unknownPart(reason)).toStrictEqual({ text: '', reason });
  });
});

describe('knownPart', () => {
  const format = (n: number): string => `P${n}`;

  it('a known value is its formatted text, with no reason', () => {
    expect(knownPart(known(3, 0), format)).toStrictEqual({ text: 'P3' });
  });

  it.each(REASONS)('an unknown value (%s) is the unknown part, and its format is never called', (reason) => {
    const never = (): string => {
      throw new Error('format called for an unknown value');
    };
    const v: Known<number> = unknown(reason);
    expect(knownPart(v, never)).toStrictEqual(unknownPart(reason));
  });
});

// The UI's types have no Node, so fs is typed here.
const FS = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ FS)) as { readFileSync(path: URL, encoding: 'utf8'): string };

// Every UI source (the glob only lists them; nothing is imported), tests and gallery declarations left out, and the grid
// file that owns the builder.
const SOURCES = Object.keys(
  import.meta.glob(['../../src/**/*.svelte', '../../src/**/*.ts', '!../../src/**/*.test.ts', '!../../src/**/gallery.ts', '!../../src/kit/grid/grid.ts']),
);
const source = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

/** Object literals without a nested brace: a part is built in one flat literal. */
const LITERAL = /\{[^{}]*\}/g;
/** An empty `text` field (not `compactText`, not `subtext`). */
const EMPTY_TEXT = /(?<![\w$])text\s*:\s*(?:''|""|``)/;
/** A `reason` key, written out or shorthand (not `value.reason`, not `reasons`). */
const REASON_KEY = /(?<![\w$.])reason\s*(?::|,|\}|$)/m;
/** A `text: string` field and a `reason?: UnknownReason` field. */
const TEXT_FIELD = /(?<![\w$])text\s*:\s*string\s*[;,}]/;
const REASON_FIELD = /(?<![\w$.])reason\s*\?\s*:\s*UnknownReason\s*[;,}]/;
/** A field name of an object type: `name:` or `name?:` at the start or after `{`, `;` or `,`. */
const FIELD_NAME = /(?:^|[{;,])\s*(?:\/\*[^]*?\*\/\s*)?([\w$]+)\s*\??\s*:/g;

/** An object type literal with the name of the type it declares (`type Name = {…}` or `type Name<T> = {…}`), if any. */
const TYPE_LITERAL = /(?:\btype\s+([\w$]+)\s*(?:<[^=]*>)?\s*=\s*)?(\{[^{}]*\})/g;

/**
 * Types that hold a `text` and a `reason` of another convention than the part's, so they do not extend it:
 * - the incident feed's cell: the plain text with the reason's mark after it, never in its place.
 * (The damage card's jump row is no exception: its loss is a `CellPart` of its own, review 9 R9-1.)
 */
const WIDENED_ELSEWHERE = ['widgets/incident-feed/rows.ts: IncidentCell'];

/** The unknown part written out: one literal with an empty text and a reason, in any order. */
const handBuilt = (code: string): string[] =>
  [...code.matchAll(LITERAL)].map((m) => m[0]).filter((lit) => EMPTY_TEXT.test(lit) && REASON_KEY.test(lit));
/** `CellPart` restated: an object type whose only fields are `text: string` and `reason?: UnknownReason`. */
const restated = (code: string): string[] =>
  [...code.matchAll(LITERAL)]
    .map((m) => m[0])
    .filter((lit) => TEXT_FIELD.test(lit) && REASON_FIELD.test(lit) && [...lit.matchAll(FIELD_NAME)].length === 2);

/**
 * The part's fields repeated in a wider type: an object type literal with `text: string`, `reason?: UnknownReason` and
 * more fields. Each is named `<type>: <literal>`, or `-: <literal>` when the literal declares no named type.
 */
const widened = (code: string): string[] =>
  [...code.matchAll(TYPE_LITERAL)]
    .filter(([, , lit = '']) => TEXT_FIELD.test(lit) && REASON_FIELD.test(lit) && [...lit.matchAll(FIELD_NAME)].length > 2)
    .map(([, name = '-', lit = '']) => `${name}: ${lit}`);

describe('the scans see the convention, not a spelling', () => {
  it.each([
    "{ text: '', reason }",
    "{ reason, text: '' }",
    "{text:'',reason:r}",
    "{ value, text: '', compactText: '', reason: value.reason }",
    "{\n  text: \"\",\n  role,\n  reason: v.reason,\n}",
    "{ reason: v.reason, title: 'x', text: `` }",
  ])('finds the hand-built unknown part %j', (code) => {
    expect(handBuilt(`return ${code};`)).toHaveLength(1);
  });

  it.each([
    "{ text: 'P7' }",
    "{ value, compactText: '', ...unknownPart(value.reason) }",
    "{ text: '', title: unknownReason[value.reason] }",
    "{ text: '', reasons }",
    "{ text: s, reason }",
  ])('leaves %j alone', (code) => {
    expect(handBuilt(`return ${code};`)).toEqual([]);
  });

  it.each([
    '{ text: string; reason?: UnknownReason }',
    '{ reason?: UnknownReason; text: string }',
    '{\n  /** The text. */\n  text: string;\n  reason?: UnknownReason;\n}',
    '{text:string,reason?:UnknownReason}',
  ])('finds the restated part type %j', (code) => {
    expect(restated(`export type Cell = ${code};`)).toHaveLength(1);
  });

  it.each([
    '{ text: string; reason?: UnknownReason; parts?: CellPart[] }',
    '{ text: string; role?: Role; reason?: UnknownReason }',
    '{ text: string; reason: UnknownReason | undefined }',
    '{ text: string }',
  ])('leaves the type %j alone (it is not exactly the part)', (code) => {
    expect(restated(`export type Cell = ${code};`)).toEqual([]);
  });
});

describe('the scan of wider types sees the part repeated, not a spelling', () => {
  it.each([
    ['type Cell = { text: string; role?: Role; reason?: UnknownReason; title?: string };', 'Cell'],
    ['export type Row = {\n  key: K;\n  label: string;\n  text: string;\n  reason?: UnknownReason;\n  bold?: boolean;\n};', 'Row'],
    ['type Cell<T> = { reason?: UnknownReason; value: T; text: string };', 'Cell'],
    ['function f(): { text: string; reason?: UnknownReason; title?: string } {', '-'],
  ])('finds the part repeated in %j', (code, name) => {
    expect(widened(code).map((found) => found.slice(0, found.indexOf(':')))).toEqual([name]);
  });

  it.each([
    'type Cell = CellPart & { role?: Role; title?: string };',
    'type Cell = { text: string; reason?: UnknownReason };',
    'type Cells = { text: string; kinds: Kind[]; reason: UnknownReason | undefined };',
    'type Shown = { text: string; title: string; colour: string };',
  ])('leaves %j alone', (code) => {
    expect(widened(code)).toEqual([]);
  });
});

describe('one builder of the unknown part', () => {
  it('the glob finds the UI sources', () => {
    expect(SOURCES.map((p) => p.replace('../../src/', ''))).toEqual(
      expect.arrayContaining(['kit/values/position-mark.ts', 'widgets/incident-feed/rows.ts', 'kit/car/gap-to-car.ts', 'widgets/corner-block/rows.ts']),
    );
  });

  it('no UI source writes the unknown part out by hand: it is unknownPart or knownPart', () => {
    const found = SOURCES.flatMap((p) => handBuilt(source(p)).map((lit) => `${p.replace('../../src/', '')}: ${lit.replace(/\s+/g, ' ')}`));
    expect(found).toEqual([]);
  });

  it("no UI source restates the part's type: it is CellPart", () => {
    const found = SOURCES.flatMap((p) => restated(source(p)).map((lit) => `${p.replace('../../src/', '')}: ${lit.replace(/\s+/g, ' ')}`));
    expect(found).toEqual([]);
  });

  it('no UI source repeats the part\'s fields in a wider type: it is CellPart & { … }', () => {
    const found = SOURCES.flatMap((p) => widened(source(p)).map((w) => `${p.replace('../../src/', '')}: ${w.replace(/\s+/g, ' ')}`));
    const named = (f: string): string => f.slice(0, f.indexOf(':', f.indexOf(':') + 1));
    expect(found.filter((f) => !WIDENED_ELSEWHERE.includes(named(f)))).toEqual([]);
  });

  it('every type named as another convention still exists and still holds both fields (no stale exception)', () => {
    const found = SOURCES.flatMap((p) => widened(source(p)).map((w) => `${p.replace('../../src/', '')}: ${w.slice(0, w.indexOf(':'))}`));
    expect(found).toEqual(expect.arrayContaining(WIDENED_ELSEWHERE));
  });
});
