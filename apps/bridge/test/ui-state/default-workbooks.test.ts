import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { workbookNames } from '../../src/ui-state/ui-files.ts';
import { seedDefaultWorkbooks } from '../../src/ui-state/default-workbooks.ts';

/** The folder the bridge ships its default workbooks in. */
const SHIPPED = join(import.meta.dirname, '../../src/ui-state/default-workbooks');
/** A fresh UI dir (`PITWALL_DATA_DIR/ui`). */
const uiDir = (): string => mkdtempSync(join(tmpdir(), 'default-workbooks-'));
const workbooks = (dir: string): string => join(dir, 'workbooks');
const defaultsWith = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'defaults-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
};

describe('seedDefaultWorkbooks', () => {
  it('a missing car.json is created', async () => {
    const dir = uiDir();
    await seedDefaultWorkbooks(dir, SHIPPED);
    const seeded = readFileSync(join(workbooks(dir), 'car.json'), 'utf8');
    expect(seeded).toBe(readFileSync(join(SHIPPED, 'car.json'), 'utf8'));
    expect(JSON.parse(seeded)).toMatchObject({ name: 'car' });
  });

  it('the shipped defaults are car, quali and race, each seeded under its own name', async () => {
    expect(readdirSync(SHIPPED).sort()).toEqual(['car.json', 'quali.json', 'race.json']);
    const dir = uiDir();
    await seedDefaultWorkbooks(dir, SHIPPED);
    for (const name of ['car', 'quali', 'race']) {
      const seeded = readFileSync(join(workbooks(dir), `${name}.json`), 'utf8');
      expect(seeded).toBe(readFileSync(join(SHIPPED, `${name}.json`), 'utf8'));
      expect(JSON.parse(seeded)).toMatchObject({ name });
    }
  });

  it('an existing car.json is untouched', async () => {
    const dir = uiDir();
    mkdirSync(workbooks(dir), { recursive: true });
    const mine = '{"name":"car","windows":[],"edited":"by hand"}\n';
    writeFileSync(join(workbooks(dir), 'car.json'), mine);
    await seedDefaultWorkbooks(dir, SHIPPED);
    expect(readFileSync(join(workbooks(dir), 'car.json'), 'utf8')).toBe(mine);
  });

  it('every file of the defaults folder is seeded, byte for byte', async () => {
    const dir = uiDir();
    const defaults = defaultsWith({ 'one.json': '{"name":"one"}\n', 'two.json': '{ "name": "two" }' });
    await seedDefaultWorkbooks(dir, defaults);
    expect(workbookNames(workbooks(dir))).toEqual(['one', 'two']);
    for (const file of ['one.json', 'two.json']) {
      expect(readFileSync(join(workbooks(dir), file), 'utf8')).toBe(readFileSync(join(defaults, file), 'utf8'));
    }
  });

  it('only the missing files are created and the existing ones keep their text', async () => {
    const dir = uiDir();
    mkdirSync(workbooks(dir), { recursive: true });
    writeFileSync(join(workbooks(dir), 'one.json'), 'mine');
    await seedDefaultWorkbooks(dir, defaultsWith({ 'one.json': 'shipped one', 'two.json': 'shipped two' }));
    expect(readFileSync(join(workbooks(dir), 'one.json'), 'utf8')).toBe('mine');
    expect(readFileSync(join(workbooks(dir), 'two.json'), 'utf8')).toBe('shipped two');
  });

  it('seeding twice changes nothing', async () => {
    const dir = uiDir();
    await seedDefaultWorkbooks(dir, SHIPPED);
    const first = readdirSync(workbooks(dir)).sort();
    writeFileSync(join(workbooks(dir), 'car.json'), 'edited');
    await seedDefaultWorkbooks(dir, SHIPPED);
    expect(readdirSync(workbooks(dir)).sort()).toEqual(first);
    expect(readFileSync(join(workbooks(dir), 'car.json'), 'utf8')).toBe('edited');
  });

  it('a seeded default that was deleted is not recreated', async () => {
    const dir = uiDir();
    await seedDefaultWorkbooks(dir, SHIPPED);
    rmSync(join(workbooks(dir), 'quali.json'));
    await seedDefaultWorkbooks(dir, SHIPPED);
    expect(existsSync(join(workbooks(dir), 'quali.json'))).toBe(false);
    expect(existsSync(join(workbooks(dir), 'car.json'))).toBe(true);
  });

  it('a default added in a later release is copied once', async () => {
    const dir = uiDir();
    const defaults = defaultsWith({ 'one.json': 'one' });
    await seedDefaultWorkbooks(dir, defaults);
    writeFileSync(join(defaults, 'two.json'), 'two');
    await seedDefaultWorkbooks(dir, defaults);
    expect(readFileSync(join(workbooks(dir), 'two.json'), 'utf8')).toBe('two');
    rmSync(join(workbooks(dir), 'two.json'));
    await seedDefaultWorkbooks(dir, defaults);
    expect(existsSync(join(workbooks(dir), 'two.json'))).toBe(false);
  });

  it('an existing file is kept and counts as seeded', async () => {
    const dir = uiDir();
    mkdirSync(workbooks(dir), { recursive: true });
    writeFileSync(join(workbooks(dir), 'one.json'), 'mine');
    const defaults = defaultsWith({ 'one.json': 'shipped' });
    await seedDefaultWorkbooks(dir, defaults);
    expect(readFileSync(join(workbooks(dir), 'one.json'), 'utf8')).toBe('mine');
    rmSync(join(workbooks(dir), 'one.json'));
    await seedDefaultWorkbooks(dir, defaults);
    expect(existsSync(join(workbooks(dir), 'one.json'))).toBe(false);
  });

  it('the marker is a sorted JSON array of the seeded names and is not a workbook', async () => {
    const dir = uiDir();
    await seedDefaultWorkbooks(dir, defaultsWith({ 'b.json': '{}', 'a.json': '{}' }));
    const marker = join(workbooks(dir), '.seeded-defaults.json');
    expect(JSON.parse(readFileSync(marker, 'utf8'))).toEqual(['a.json', 'b.json']);
    expect(workbookNames(workbooks(dir))).toEqual(['a', 'b']);
  });
});
