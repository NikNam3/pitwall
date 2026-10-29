import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { seedDefaultWorkbooks } from '../../src/ui-state/default-workbooks.ts';

/** The folder the bridge ships its default workbooks in. */
const SHIPPED = join(import.meta.dirname, '../../src/ui-state/default-workbooks');
const dataDir = (): string => mkdtempSync(join(tmpdir(), 'default-workbooks-'));
const workbooks = (dir: string): string => join(dir, 'ui', 'workbooks');
const defaultsWith = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'defaults-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
};

describe('seedDefaultWorkbooks', () => {
  it('a missing car.json is created', async () => {
    const dir = dataDir();
    await seedDefaultWorkbooks(dir, SHIPPED);
    const seeded = readFileSync(join(workbooks(dir), 'car.json'), 'utf8');
    expect(seeded).toBe(readFileSync(join(SHIPPED, 'car.json'), 'utf8'));
    expect(JSON.parse(seeded)).toMatchObject({ name: 'car' });
  });

  it('the shipped defaults are car, quali and race, each seeded under its own name', async () => {
    expect(readdirSync(SHIPPED).sort()).toEqual(['car.json', 'quali.json', 'race.json']);
    const dir = dataDir();
    await seedDefaultWorkbooks(dir, SHIPPED);
    for (const name of ['car', 'quali', 'race']) {
      const seeded = readFileSync(join(workbooks(dir), `${name}.json`), 'utf8');
      expect(seeded).toBe(readFileSync(join(SHIPPED, `${name}.json`), 'utf8'));
      expect(JSON.parse(seeded)).toMatchObject({ name });
    }
  });

  it('an existing car.json is untouched', async () => {
    const dir = dataDir();
    mkdirSync(workbooks(dir), { recursive: true });
    const mine = '{"name":"car","windows":[],"edited":"by hand"}\n';
    writeFileSync(join(workbooks(dir), 'car.json'), mine);
    await seedDefaultWorkbooks(dir, SHIPPED);
    expect(readFileSync(join(workbooks(dir), 'car.json'), 'utf8')).toBe(mine);
  });

  it('every file of the defaults folder is seeded, byte for byte', async () => {
    const dir = dataDir();
    const defaults = defaultsWith({ 'one.json': '{"name":"one"}\n', 'two.json': '{ "name": "two" }' });
    await seedDefaultWorkbooks(dir, defaults);
    expect(readdirSync(workbooks(dir)).sort()).toEqual(['one.json', 'two.json']);
    for (const file of ['one.json', 'two.json']) {
      expect(readFileSync(join(workbooks(dir), file), 'utf8')).toBe(readFileSync(join(defaults, file), 'utf8'));
    }
  });

  it('only the missing files are created and the existing ones keep their text', async () => {
    const dir = dataDir();
    mkdirSync(workbooks(dir), { recursive: true });
    writeFileSync(join(workbooks(dir), 'one.json'), 'mine');
    await seedDefaultWorkbooks(dir, defaultsWith({ 'one.json': 'shipped one', 'two.json': 'shipped two' }));
    expect(readFileSync(join(workbooks(dir), 'one.json'), 'utf8')).toBe('mine');
    expect(readFileSync(join(workbooks(dir), 'two.json'), 'utf8')).toBe('shipped two');
  });

  it('seeding twice changes nothing', async () => {
    const dir = dataDir();
    await seedDefaultWorkbooks(dir, SHIPPED);
    const first = readdirSync(workbooks(dir)).sort();
    writeFileSync(join(workbooks(dir), 'car.json'), 'edited');
    await seedDefaultWorkbooks(dir, SHIPPED);
    expect(readdirSync(workbooks(dir)).sort()).toEqual(first);
    expect(readFileSync(join(workbooks(dir), 'car.json'), 'utf8')).toBe('edited');
  });
});
