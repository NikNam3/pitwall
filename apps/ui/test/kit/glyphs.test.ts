// ★ ☆ ■ (SP4.3b2 Task 3; docs/design/2026-11-12-sp4.3b/README.md, "Follow-ups": check that the glyphs are in the bundled
// JetBrains Mono, otherwise kit icons). Contract assumed, one of the two:
//  - every glyph is in the bundled font's cmap: `kit/text.ts` exports `starFilled = '★'`, `starOutline = '☆'` and
//    `square = '■'`, and `kit/icons/` holds none of `Star.svelte`, `StarOutline.svelte`, `Square.svelte`;
//  - a glyph is missing: `kit/icons/` holds `Star.svelte` (filled), `StarOutline.svelte` and `Square.svelte`, each drawn in
//    `currentColor` like `Gear.svelte`, and `kit/text.ts` exports none of the three strings (a glyph the font lacks would
//    draw in a fallback font).
// The test reads the font's cmap itself: the woff2 table directory, its one brotli stream, then cmap format 4 or 12.
import { describe, expect, it } from 'vitest';
import * as text from '../../src/kit/text.ts';

// The UI's types have no Node, so fs and zlib are typed here.
const FS = 'node:fs';
const ZLIB = 'node:zlib';
const { readFileSync } = (await import(/* @vite-ignore */ FS)) as { readFileSync(path: URL): Uint8Array };
const { brotliDecompressSync } = (await import(/* @vite-ignore */ ZLIB)) as { brotliDecompressSync(data: Uint8Array): Uint8Array };

const FONT = new URL('../../src/theme/font/JetBrainsMono[wght].woff2', import.meta.url);
const ICONS = Object.keys(import.meta.glob('../../src/kit/icons/*.svelte')).map((p) => p.split('/').pop());

/** Big-endian reads over bytes. */
const reader = (b: Uint8Array) => {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { u16: (o: number): number => v.getUint16(o), u32: (o: number): number => v.getUint32(o) };
};

/** The woff2 known-table tags, by index (WOFF2 spec, 5.1). */
const TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
  'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH',
  'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
];

/** The decompressed cmap table of a woff2 file. */
function woff2Cmap(file: Uint8Array): Uint8Array {
  const r = reader(file);
  const numTables = r.u16(12);
  const compressed = r.u32(20);
  let p = 48;
  const base128 = (): number => {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const b = file[p++]!;
      v = v * 128 + (b & 0x7f);
      if ((b & 0x80) === 0) return v;
    }
    throw new Error('bad UIntBase128');
  };
  const dir: { tag: string; length: number }[] = [];
  for (let i = 0; i < numTables; i++) {
    const flags = file[p++]!;
    let tag: string;
    if ((flags & 0x3f) === 0x3f) {
      tag = String.fromCharCode(...file.subarray(p, p + 4));
      p += 4;
    } else tag = TAGS[flags & 0x3f]!;
    const version = flags >> 6;
    const origLength = base128();
    const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0;
    dir.push({ tag, length: transformed ? base128() : origLength });
  }
  const data = brotliDecompressSync(file.subarray(p, p + compressed));
  let offset = 0;
  for (const t of dir) {
    if (t.tag === 'cmap') return data.subarray(offset, offset + t.length);
    offset += t.length;
  }
  throw new Error('no cmap');
}

/** Whether a cmap maps a code point (formats 4 and 12). */
function maps(table: Uint8Array, codePoint: number): boolean {
  const cmap = reader(table);
  const n = cmap.u16(2);
  for (let i = 0; i < n; i++) {
    const o = cmap.u32(8 + i * 8);
    const format = cmap.u16(o);
    if (format === 12) {
      const groups = cmap.u32(o + 12);
      for (let g = 0; g < groups; g++) {
        const start = cmap.u32(o + 16 + g * 12);
        const end = cmap.u32(o + 20 + g * 12);
        if (codePoint >= start && codePoint <= end) return true;
      }
    } else if (format === 4) {
      const segX2 = cmap.u16(o + 6);
      for (let s = 0; s < segX2 / 2; s++) {
        const end = cmap.u16(o + 14 + s * 2);
        const start = cmap.u16(o + 16 + segX2 + s * 2);
        if (start === 0xffff) continue;
        if (codePoint >= start && codePoint <= end) return true;
      }
    }
  }
  return false;
}

describe('the star and square glyphs', () => {
  it('★ ☆ ■: glyphs in the bundled font or kit icons, one of the two', () => {
    const cmap = woff2Cmap(readFileSync(FONT));
    // The reader itself: a letter and the bar's block are in the font, a CJK ideograph is not.
    expect(maps(cmap, 'A'.codePointAt(0)!)).toBe(true);
    expect(maps(cmap, '█'.codePointAt(0)!)).toBe(true);
    expect(maps(cmap, '中'.codePointAt(0)!)).toBe(false);

    const inFont = ['★', '☆', '■'].every((g) => maps(cmap, g.codePointAt(0)!));
    const strings = text as Record<string, unknown>;
    const iconFiles = ['Star.svelte', 'StarOutline.svelte', 'Square.svelte'];
    if (inFont) {
      expect({ starFilled: strings.starFilled, starOutline: strings.starOutline, square: strings.square }).toEqual({
        starFilled: '★',
        starOutline: '☆',
        square: '■',
      });
      for (const f of iconFiles) expect(ICONS).not.toContain(f);
    } else {
      for (const f of iconFiles) expect(ICONS).toContain(f);
      for (const k of ['starFilled', 'starOutline', 'square']) expect(strings[k]).toBeUndefined();
    }
  });
});
