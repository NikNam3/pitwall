// The source badge's hover in words, and the SOURCE words (ruling R25; C65, C68). Contract the tests assume:
//  - `kit/values/source-badge.ts` exports a pure `sourceTitle(source: EstimateSource): string`, the one switch on the
//    source kind for the hover: exactly the hover `SourceBadge` shows (the texts `sourceHover.*` of kit/text.ts, pinned by
//    source-badge.test.ts); `SourceBadge.svelte` takes its hover from it, so a widget that shows the source in words
//    gives the same hover without a second switch;
//  - `kit/text.ts` exports `sourceWord = { session, calibration, default }`: the source kind in words (the SOURCE
//    column), shared by every display that names a source.
import type { EstimateSource } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { sourceWord } from '../../src/kit/text.ts';
import { sourceTitle } from '../../src/kit/values/source-badge.ts';

const calibration: EstimateSource = {
  kind: 'calibration', setName: 'league', sources: 4, sessionShare: 0.25, parts: '1 stop (race 15 Oct) + 0 stops this session',
};
const fallback: EstimateSource = { kind: 'default', note: 'Silverstone track file: community value (R3)', sessionShare: 0, parts: 'track file' };
const session: EstimateSource = { kind: 'session', sessionShare: 0.75, parts: '6 stops + league 20.4 (75 % session)' };

describe('sourceTitle: the badge\'s hover per kind', () => {
  it('calibration: the word, the set name, its sources and the parts', () => {
    expect(sourceTitle(calibration)).toBe('calibration · league · 4 sources · 1 stop (race 15 Oct) + 0 stops this session');
  });
  it('calibration with one source: "1 source"', () => {
    expect(sourceTitle({ ...calibration, setName: 'pre-season', sources: 1 })).toBe(
      'calibration · pre-season · 1 source · 1 stop (race 15 Oct) + 0 stops this session',
    );
  });
  it('default: the word and the source note', () => {
    expect(sourceTitle(fallback)).toBe('default · Silverstone track file: community value (R3)');
  });
  it('session: the word and the parts', () => {
    expect(sourceTitle(session)).toBe('session · 6 stops + league 20.4 (75 % session)');
  });
  it.each([0, 0.5, 1])('never reads sessionShare (%s): the calculator decided the kind (C43)', (sessionShare) => {
    expect(sourceTitle({ ...session, sessionShare })).toBe(sourceTitle(session));
    expect(sourceTitle({ ...calibration, sessionShare })).toBe(sourceTitle(calibration));
  });
});

describe('sourceWord: the source kind in words', () => {
  it('holds the four words', () => {
    expect(sourceWord).toEqual({ session: 'session', calibration: 'calibration', profile: 'profile', default: 'default' });
  });
});

// The UI's types have no Node, so fs is typed here.
const FS = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ FS)) as { readFileSync(path: URL, encoding: 'utf8'): string };

describe('SourceBadge takes its hover from sourceTitle (one switch on the kind)', () => {
  it('SourceBadge.svelte imports sourceTitle and no longer composes the hover from sourceHover', () => {
    const badge = readFileSync(new URL('../../src/kit/values/SourceBadge.svelte', import.meta.url), 'utf8');
    expect(badge).toMatch(/import\s*\{[^}]*\bsourceTitle\b[^}]*\}\s*from\s*'\.\/source-badge\.ts'/);
    expect(badge).not.toContain('sourceHover');
  });
});
