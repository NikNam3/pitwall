import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { describeWithFixture, FIXTURES, fixturePath, fixturesDir } from './fixtures.ts';

const ROOT = resolve(import.meta.dirname, '..');
const index = JSON.parse(readFileSync(join(ROOT, 'fixtures/index.json'), 'utf8')) as { fixtures: Array<{ id: string; file: string; sha256: string }> };

describe('fixture paths', () => {
  it('defaults to <repo>/recordings and honours PITWALL_FIXTURES_DIR', () => {
    expect(fixturesDir({})).toBe(join(ROOT, 'recordings'));
    expect(fixturesDir({ PITWALL_FIXTURES_DIR: '/data/fx' })).toBe('/data/fx');
  });
  it('returns the path only when the file exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fx-'));
    expect(fixturePath('menuOnly', { PITWALL_FIXTURES_DIR: dir })).toBeUndefined();
    writeFileSync(join(dir, FIXTURES.menuOnly), '');
    expect(fixturePath('menuOnly', { PITWALL_FIXTURES_DIR: dir })).toBe(join(dir, '2026-10-27_22-50-28_5cc4798807ebe7a5.pwrec.gz'));
  });
  it('FIXTURES and fixtures/index.json list the same recordings', () => {
    expect(index.fixtures.map((f) => [f.id, f.file])).toEqual(Object.entries(FIXTURES));
  });
});

const notes: string[] = [];
const info = vi.spyOn(console, 'info').mockImplementation((m: unknown) => { notes.push(String(m)); });
const saved = process.env['PITWALL_FIXTURES_DIR'];
process.env['PITWALL_FIXTURES_DIR'] = mkdtempSync(join(tmpdir(), 'fx-empty-'));
describeWithFixture('ttZandvoort', 'a suite whose fixture is missing', () => {
  it('is skipped, never run', () => { throw new Error('must be skipped'); });
});
if (saved === undefined) delete process.env['PITWALL_FIXTURES_DIR']; else process.env['PITWALL_FIXTURES_DIR'] = saved;
info.mockRestore();
it('prints a note naming the missing file', () => {
  expect(notes).toEqual([expect.stringContaining('2026-10-27_23-31-43_1a4f5531395c7884.pwrec.gz')]);
});

for (const f of index.fixtures) {
  describeWithFixture(f.id as keyof typeof FIXTURES, `checksum of ${f.id}`, (path) => {
    it('matches fixtures/index.json', () => {
      expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(f.sha256);
    });
  });
}
