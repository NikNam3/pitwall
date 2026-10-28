import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findFeatureFolders } from './gen-features.ts';

const tempDir = () => mkdtempSync(join(tmpdir(), 'features-'));
const folder = (dir: string, name: string, ...files: string[]) => {
  mkdirSync(join(dir, name));
  for (const file of files) writeFileSync(join(dir, name, file), '');
};

describe('findFeatureFolders on malformed features', () => {
  it.each(['regsiter.ts', 'Register.ts', 'register.tsx'])('throws for a folder whose entry file is %s', (file) => {
    const dir = tempDir();
    folder(dir, 'alpha', 'register.ts');
    folder(dir, 'broken', file, 'helper.ts');
    expect(() => findFeatureFolders(dir)).toThrow(/feature folder "broken" has no register\.ts file/);
  });
  it('throws when register.ts is a directory', () => {
    const dir = tempDir();
    folder(dir, 'broken');
    mkdirSync(join(dir, 'broken', 'register.ts'));
    expect(() => findFeatureFolders(dir)).toThrow(/feature folder "broken" has no register\.ts file/);
  });
  it('ignores folders without TypeScript files', () => {
    const dir = tempDir();
    folder(dir, 'notes', 'todo.md');
    folder(dir, 'empty');
    expect(findFeatureFolders(dir)).toEqual([]);
  });
  it('follows a symlinked feature folder', () => {
    const dir = tempDir();
    const target = tempDir();
    writeFileSync(join(target, 'register.ts'), '');
    symlinkSync(target, join(dir, 'linked'), 'dir');
    expect(findFeatureFolders(dir)).toEqual(['linked']);
  });
  it('names the missing features directory', () => {
    const dir = join(tempDir(), 'nope');
    expect(() => findFeatureFolders(dir)).toThrow(`features directory not found: ${dir}`);
  });
});
