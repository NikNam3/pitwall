// SP4.3c Task 24 (spec §5.9, C70): a changed or added shipped workbook reaches the user.
// Contract:
//  - `seedDefaultWorkbooks(uiDir, defaultsDir, now: () => string)`; `now()` is the date in the backup's name.
//  - The marker `<uiDir>/workbooks/.seeded-defaults.json` is `{ [fileName]: sha256(shipped text) }`, sha256 as hex.
//  - A default that is new (no hash recorded) or whose shipped hash differs from the recorded one is copied over the
//    user's file; an existing user file is first kept as `<fileName>.bak-<now()>` beside it; the new hash is recorded.
//  - A default whose shipped hash equals the recorded one leaves the user's file as it is (an edit is kept, a deleted
//    file stays deleted).
//  - An old list-form marker (`["car.json", …]`) is read as names with unknown hashes: every default is refreshed once.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { workbookNames } from '../../src/ui-state/ui-files.ts';
import { seedDefaultWorkbooks } from '../../src/ui-state/default-workbooks.ts';

/** The folder the bridge ships its default workbooks in. */
const SHIPPED = join(import.meta.dirname, '../../src/ui-state/default-workbooks');
const DATE = '2026-11-15';
const now = (): string => DATE;
const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
/** A fresh UI dir (`PITWALL_DATA_DIR/ui`). */
const uiDir = (): string => mkdtempSync(join(tmpdir(), 'default-workbooks-'));
const workbooks = (dir: string): string => join(dir, 'workbooks');
const at = (dir: string, file: string): string => join(workbooks(dir), file);
const text = (path: string): string => readFileSync(path, 'utf8');
const marker = (dir: string): unknown => JSON.parse(text(at(dir, '.seeded-defaults.json')));
const defaultsWith = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'defaults-'));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
};
/** A UI dir whose workbooks folder already holds these files. */
const uiDirWith = (files: Record<string, string>): string => {
  const dir = uiDir();
  mkdirSync(workbooks(dir), { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(at(dir, name), content);
  return dir;
};
const backups = (dir: string): string[] => readdirSync(workbooks(dir)).filter((file) => file.includes('.bak-')).sort();

describe('seedDefaultWorkbooks: first start', () => {
  it('a missing car.json is created', async () => {
    const dir = uiDir();
    await seedDefaultWorkbooks(dir, SHIPPED, now);
    const seeded = text(at(dir, 'car.json'));
    expect(seeded).toBe(text(join(SHIPPED, 'car.json')));
    expect(JSON.parse(seeded)).toMatchObject({ name: 'car' });
  });

  it('the shipped defaults are car, garage, plan, quali, race and strategy, each seeded under its own name', async () => {
    expect(readdirSync(SHIPPED).sort()).toEqual([
      'car.json',
      'garage.json',
      'plan.json',
      'quali.json',
      'race.json',
      'strategy.json',
    ]);
    const dir = uiDir();
    await seedDefaultWorkbooks(dir, SHIPPED, now);
    for (const name of ['car', 'garage', 'plan', 'quali', 'race', 'strategy']) {
      const seeded = text(at(dir, `${name}.json`));
      expect(seeded).toBe(text(join(SHIPPED, `${name}.json`)));
      expect(JSON.parse(seeded)).toMatchObject({ name });
    }
  });

  it('every file of the defaults folder is seeded, byte for byte, and no backup is made where there was no file', async () => {
    const dir = uiDir();
    const defaults = defaultsWith({ 'one.json': '{"name":"one"}\n', 'two.json': '{ "name": "two" }' });
    await seedDefaultWorkbooks(dir, defaults, now);
    expect(workbookNames(workbooks(dir))).toEqual(['one', 'two']);
    for (const file of ['one.json', 'two.json']) expect(text(at(dir, file))).toBe(text(join(defaults, file)));
    expect(backups(dir)).toEqual([]);
  });

  it('a user file of a default never seeded is replaced by the default and kept as a dated .bak', async () => {
    const dir = uiDirWith({ 'one.json': 'mine' });
    await seedDefaultWorkbooks(dir, defaultsWith({ 'one.json': 'shipped one', 'two.json': 'shipped two' }), now);
    expect(text(at(dir, 'one.json'))).toBe('shipped one');
    expect(text(at(dir, `one.json.bak-${DATE}`))).toBe('mine');
    expect(text(at(dir, 'two.json'))).toBe('shipped two');
    expect(backups(dir)).toEqual([`one.json.bak-${DATE}`]);
  });

  it('a user workbook that is no default is left alone', async () => {
    const dir = uiDirWith({ 'mine.json': 'my own' });
    await seedDefaultWorkbooks(dir, defaultsWith({ 'one.json': 'shipped' }), now);
    expect(text(at(dir, 'mine.json'))).toBe('my own');
    expect(backups(dir)).toEqual([]);
  });

  it('the marker maps each seeded file name to the sha256 of its shipped text, and neither it nor a .bak is a workbook', async () => {
    const dir = uiDirWith({ 'a.json': 'old a' });
    await seedDefaultWorkbooks(dir, defaultsWith({ 'b.json': '{"b":1}', 'a.json': '{"a":1}' }), now);
    expect(marker(dir)).toEqual({ 'a.json': hash('{"a":1}'), 'b.json': hash('{"b":1}') });
    expect(workbookNames(workbooks(dir))).toEqual(['a', 'b']);
  });
});

describe('seedDefaultWorkbooks: an unchanged default', () => {
  it('seeding twice changes nothing: the user edit is kept and no backup is made', async () => {
    const dir = uiDir();
    await seedDefaultWorkbooks(dir, SHIPPED, now);
    const first = readdirSync(workbooks(dir)).sort();
    writeFileSync(at(dir, 'car.json'), 'edited');
    await seedDefaultWorkbooks(dir, SHIPPED, now);
    expect(readdirSync(workbooks(dir)).sort()).toEqual(first);
    expect(text(at(dir, 'car.json'))).toBe('edited');
  });

  it('a seeded default that was deleted is not recreated', async () => {
    const dir = uiDir();
    await seedDefaultWorkbooks(dir, SHIPPED, now);
    rmSync(at(dir, 'quali.json'));
    await seedDefaultWorkbooks(dir, SHIPPED, now);
    expect(existsSync(at(dir, 'quali.json'))).toBe(false);
    expect(existsSync(at(dir, 'car.json'))).toBe(true);
  });
});

describe('seedDefaultWorkbooks: a release changes or adds a default', () => {
  it('a changed default overwrites the edited user file, keeps the edit as a dated .bak and records the new hash', async () => {
    const dir = uiDir();
    const defaults = defaultsWith({ 'one.json': 'v1', 'two.json': 'two' });
    await seedDefaultWorkbooks(dir, defaults, now);
    writeFileSync(at(dir, 'one.json'), 'my edit');
    writeFileSync(at(dir, 'two.json'), 'my two');
    writeFileSync(join(defaults, 'one.json'), 'v2');
    await seedDefaultWorkbooks(dir, defaults, now);
    expect(text(at(dir, 'one.json'))).toBe('v2');
    expect(text(at(dir, `one.json.bak-${DATE}`))).toBe('my edit');
    // the unchanged default keeps the user's edit
    expect(text(at(dir, 'two.json'))).toBe('my two');
    expect(backups(dir)).toEqual([`one.json.bak-${DATE}`]);
    expect(marker(dir)).toEqual({ 'one.json': hash('v2'), 'two.json': hash('two') });
  });

  it('a changed default is copied again although the user had deleted it', async () => {
    const dir = uiDir();
    const defaults = defaultsWith({ 'one.json': 'v1' });
    await seedDefaultWorkbooks(dir, defaults, now);
    rmSync(at(dir, 'one.json'));
    writeFileSync(join(defaults, 'one.json'), 'v2');
    await seedDefaultWorkbooks(dir, defaults, now);
    expect(text(at(dir, 'one.json'))).toBe('v2');
    expect(backups(dir)).toEqual([]);
  });

  it('after the changed default is seeded, a further start keeps the next edit', async () => {
    const dir = uiDir();
    const defaults = defaultsWith({ 'one.json': 'v1' });
    await seedDefaultWorkbooks(dir, defaults, now);
    writeFileSync(join(defaults, 'one.json'), 'v2');
    await seedDefaultWorkbooks(dir, defaults, now);
    writeFileSync(at(dir, 'one.json'), 'edit of v2');
    await seedDefaultWorkbooks(dir, defaults, () => '2026-11-16');
    expect(text(at(dir, 'one.json'))).toBe('edit of v2');
    expect(existsSync(at(dir, 'one.json.bak-2026-11-16'))).toBe(false);
  });

  it('a default added in a later release is copied once', async () => {
    const dir = uiDir();
    const defaults = defaultsWith({ 'one.json': 'one' });
    await seedDefaultWorkbooks(dir, defaults, now);
    writeFileSync(join(defaults, 'two.json'), 'two');
    await seedDefaultWorkbooks(dir, defaults, now);
    expect(text(at(dir, 'two.json'))).toBe('two');
    rmSync(at(dir, 'two.json'));
    await seedDefaultWorkbooks(dir, defaults, now);
    expect(existsSync(at(dir, 'two.json'))).toBe(false);
  });

  it('a default added in a later release overwrites a user file of the same name, keeping it as a .bak', async () => {
    const dir = uiDir();
    const defaults = defaultsWith({ 'one.json': 'one' });
    await seedDefaultWorkbooks(dir, defaults, now);
    writeFileSync(at(dir, 'two.json'), 'my two');
    writeFileSync(join(defaults, 'two.json'), 'shipped two');
    await seedDefaultWorkbooks(dir, defaults, now);
    expect(text(at(dir, 'two.json'))).toBe('shipped two');
    expect(text(at(dir, `two.json.bak-${DATE}`))).toBe('my two');
  });
});

describe('seedDefaultWorkbooks: the list-form marker of earlier releases', () => {
  it('is read as names with unknown hashes: every default is refreshed once, edits kept as .bak, the marker becomes the map', async () => {
    const dir = uiDirWith({ '.seeded-defaults.json': '["one.json","two.json"]\n', 'one.json': 'my edit' });
    const defaults = defaultsWith({ 'one.json': 'shipped one', 'two.json': 'shipped two' });
    await seedDefaultWorkbooks(dir, defaults, now);
    expect(text(at(dir, 'one.json'))).toBe('shipped one');
    expect(text(at(dir, `one.json.bak-${DATE}`))).toBe('my edit');
    // two.json had been seeded and deleted; with its hash unknown it counts as changed and comes back once
    expect(text(at(dir, 'two.json'))).toBe('shipped two');
    expect(marker(dir)).toEqual({ 'one.json': hash('shipped one'), 'two.json': hash('shipped two') });
    // the upgrade happens once: the next start keeps a new edit and a deletion
    writeFileSync(at(dir, 'one.json'), 'edit again');
    rmSync(at(dir, 'two.json'));
    await seedDefaultWorkbooks(dir, defaults, () => '2026-11-16');
    expect(text(at(dir, 'one.json'))).toBe('edit again');
    expect(existsSync(at(dir, 'two.json'))).toBe(false);
  });
});
