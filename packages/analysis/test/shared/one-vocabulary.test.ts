// One vocabulary, one copy each (SP4.3c Task 1, spec §5.3; C43, C68): the plan's Step 4 grep as a test. `ourCars`,
// `pointAt` and `tyreTypeOf` are domain helpers and every reader calls them; `SessionKind`, `SESSION_KIND_LABEL`,
// `formatSessionKind`, `cornersFromGameOrder` and the tyre-type tables are gone; `DrsOffReason` is declared once (the
// race-control span detail); the ui's weekend-phase names come from the kit's `formatWeekendPhase` and
// `isSprintShootout`, its ms → s from `msToSeconds`. Belongs in `packages/domain/test/` (this worker's hooks could
// not write `packages/domain/test`).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '../../../..');
const SOURCE_ROOTS = ['packages/domain/src', 'packages/engine/src', 'packages/analysis/src', 'packages/contracts/src', 'apps/bridge/src', 'apps/ui/src'];

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else if (/\.(ts|svelte)$/.test(name) && !/\.test\.ts$/.test(name) && !name.includes('.generated.')) out.push(path);
  }
  return out;
}

const SOURCES: ReadonlyArray<{ file: string; text: string }> = SOURCE_ROOTS.flatMap((r) => filesUnder(join(ROOT, r))).map((path) => ({
  file: relative(ROOT, path),
  text: readFileSync(path, 'utf8'),
}));

/** The source files whose text matches `pattern`. */
const matching = (pattern: RegExp): string[] => SOURCES.filter((s) => pattern.test(s.text)).map((s) => s.file).toSorted();
const source = (file: string): string => readFileSync(join(ROOT, file), 'utf8');

describe('one vocabulary (SP4.3c Task 1)', () => {
  it('the deleted names appear in no source: SessionKind, SESSION_KIND_LABEL, formatSessionKind, cornersFromGameOrder, TYPE_OF', () => {
    expect(matching(/\bSessionKind\b|\bSESSION_KIND_LABEL\b|\bformatSessionKind\b|\bcornersFromGameOrder\b|\bTYPE_OF\b/)).toEqual([]);
  });

  it('the deleted copies are gone', () => {
    for (const file of ['packages/analysis/src/shared/our-cars.ts', 'packages/analysis/src/crossover/tyre-type.ts']) {
      expect([file, existsSync(join(ROOT, file))]).toEqual([file, false]);
    }
  });

  it('ourCars is defined once, in the domain; the bridge and the ui kit call it', () => {
    expect(matching(/function ourCars\b|const ourCars\s*=/)).toEqual(['apps/ui/src/kit/car/our-cars.ts', 'packages/domain/src/our-cars.ts']);
    const fromDomain = /import\s*\{[^}]*\bourCars\b[^}]*\}\s*from\s*'@pitwall\/domain'/;
    for (const file of ['apps/ui/src/kit/car/our-cars.ts', 'apps/bridge/src/pipeline/session-processor.ts']) {
      expect([file, fromDomain.test(source(file))]).toEqual([file, true]);
    }
    // The session processor's inline copy (the player and the teammate as a list) is gone.
    expect(source('apps/bridge/src/pipeline/session-processor.ts')).not.toMatch(/\[\s*state\.playerCar\s*,\s*state\.teammateCar/);
  });

  it('pointAt is defined once, in the domain', () => {
    expect(matching(/function pointAt\b|const pointAt\s*=/)).toEqual(['packages/domain/src/track-geometry.ts']);
  });

  it('a compound-to-tyre-type table lives only in the domain helper', () => {
    expect(matching(/Record<NoiseCompound,\s*TyreType>|function tyreTypeOf\b/)).toEqual(['packages/domain/src/tyre-type.ts']);
  });

  it('DrsOffReason is declared once, on the race-control span detail; the battle calculator reads it without a cast', () => {
    expect(matching(/export type DrsOffReason\b/)).toEqual(['packages/domain/src/situations/race-control-race.ts']);
    expect(source('packages/analysis/src/battle/calculator.ts')).not.toMatch(/as \{ reason\?: DrsOffReason \}/);
  });

  it('the shootout formats are listed once, in the kit; the gap chart converts ms through msToSeconds', () => {
    expect(matching(/'oneShotSprintShootout'/).filter((f) => f.startsWith('apps/ui/'))).toEqual(['apps/ui/src/kit/values/format.ts']);
    const series = source('apps/ui/src/widgets/gap-chart/series.ts');
    expect(series).not.toMatch(/\/\s*1000\b|\/\s*1_000\b/);
    expect(series).toMatch(/\bmsToSeconds\(/);
  });
});
