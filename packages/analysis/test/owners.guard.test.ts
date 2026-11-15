// The owners guard (SP4.3c spec §5.8, contract C43, C87): one row per owner of a judgement; only the owner (and the
// readers its row allows) reads the raw source of that judgement. A row fails when another unit declares the source in
// its `reads` or imports the owner's private module. The units are every feature of the generated catalogue
// (`catalogue.generated.json`, `pnpm gen`) with its calculators' and jobs' `reads`, every analysis unit folder and every
// entry of `shared/`, each with the modules its source files import. Every owner task adds its row (plan, "Guards").
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { JOBS } from './units.ts';

/** The part of the catalogue (`Catalogue` of the contracts package, which analysis may not import, C1) the guard reads. */
type Catalogue = {
  features: Array<{ name: string; analysisFolder?: string; calculators: Array<{ id: string; reads: string[] }>; jobs: string[] }>;
};

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ANALYSIS_SRC = join(ROOT, 'packages', 'analysis', 'src');
const CATALOGUE_FILE = join(ROOT, 'catalogue.generated.json');

/**
 * A unit as the guard sees it: its name (a feature or analysis folder, or `shared/<entry>`), its analysis folder or
 * file (repo-relative) if any, what it declares in `reads` (a calculator dependency as `calculator:<id>`), and every
 * module its source files import (a relative import as the repo-relative path of the file, a package as its specifier).
 */
type UnitDecl = { unit: string; folder: string | undefined; reads: readonly string[]; imports: readonly string[] };

/** One owner of a judgement: `source` says whether a unit reads the judgement's raw source; only `owner` and `allowed` may. */
type OwnerRow = { judgement: string; owner: string; source: (unit: UnitDecl) => boolean; allowed: readonly string[] };

/** `text` without its comments (line and block), so a doc comment that names a field is no read of it. */
const codeOf = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

/** Whether the code (comments left out) of a unit's source files names one of `names` as an identifier. */
function codeNames(unit: UnitDecl, names: readonly string[]): boolean {
  if (unit.folder === undefined) return false;
  const pattern = new RegExp(`\\b(?:${names.join('|')})\\b`);
  return sourceFiles(join(ROOT, unit.folder)).some((file) => pattern.test(codeOf(readFileSync(file, 'utf8'))));
}

/** The owners (spec §5.2–§5.3); each owner task adds its row. */
const OWNERS: OwnerRow[] = [
  // SP4.3c Task 5 (O7): which laps count is `lap-classes`' (`isNeutralisedLap`, `touchesNeutralisation`); no other unit
  // reads a lap record's SC or VSC share itself. Expressed by name: `lap-classes` has no private module to import.
  { judgement: 'lap counts', owner: 'lap-classes', source: (u) => codeNames(u, ['scShare', 'vscShare']), allowed: [] },
];

/** A path as the guard shows it: repo-relative with forward slashes. */
const shown = (path: string): string => relative(ROOT, path).split('\\').join('/');

/** Every `.ts` file under `path` (a file or a folder), sorted. */
function sourceFiles(path: string): string[] {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return path.endsWith('.ts') ? [path] : [];
  return readdirSync(path)
    .sort()
    .flatMap((name) => sourceFiles(join(path, name)));
}

/** Matches the specifier of a static `import … from`, an `export … from`, a side-effect `import '…'` and a dynamic `import('…')`. */
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g;

/** The modules `file` imports: relative ones resolved to repo-relative paths, packages as written. */
function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(IMPORT)].map((m) => {
    const spec = m[1] as string;
    return spec.startsWith('.') ? shown(resolve(dirname(file), spec)) : spec;
  });
}

/** Every module the source files under `path` import, sorted, each once. */
const importsUnder = (path: string): string[] => [...new Set(sourceFiles(path).flatMap(importsOf))].sort();

/** An engine `Dependency` as text: `{ calculator: id }` becomes `calculator:<id>`. */
const readText = (read: string | { calculator: string }): string => (typeof read === 'string' ? read : `calculator:${read.calculator}`);

function loadCatalogue(): Catalogue {
  if (!existsSync(CATALOGUE_FILE)) throw new Error(`${shown(CATALOGUE_FILE)} is missing: run pnpm gen`);
  return JSON.parse(readFileSync(CATALOGUE_FILE, 'utf8')) as Catalogue;
}

/** Every unit: the catalogue's features, the analysis folders without one, and each entry of `shared/`. */
function loadUnits(catalogue: Catalogue): UnitDecl[] {
  const units = new Map<string, UnitDecl>();
  for (const feature of catalogue.features) {
    const jobReads = JOBS.filter((job) => feature.jobs.includes(job.id)).flatMap((job) => job.reads.map(readText));
    const reads = [...new Set([...feature.calculators.flatMap((c) => c.reads), ...jobReads])];
    const folder = feature.analysisFolder;
    units.set(feature.name, { unit: feature.name, folder, reads, imports: folder === undefined ? [] : importsUnder(join(ROOT, folder)) });
  }
  for (const name of readdirSync(ANALYSIS_SRC).sort()) {
    const path = join(ANALYSIS_SRC, name);
    if (!statSync(path).isDirectory()) continue;
    if (name === 'shared') {
      for (const entry of readdirSync(path).sort()) {
        const unit = `shared/${entry}`;
        units.set(unit, { unit, folder: shown(join(path, entry)), reads: [], imports: importsUnder(join(path, entry)) });
      }
      continue;
    }
    if (!units.has(name)) units.set(name, { unit: name, folder: shown(path), reads: [], imports: importsUnder(path) });
  }
  return [...units.values()];
}

/** The units other than `row`'s owner and its allowed readers that read its source, each named with what it reads. */
function violations(row: OwnerRow, units: readonly UnitDecl[]): string[] {
  return units
    .filter((u) => u.unit !== row.owner && !row.allowed.includes(u.unit) && row.source(u))
    .map((u) => `${row.judgement}: ${u.unit} reads the raw source; only ${[row.owner, ...row.allowed].join(', ')} may`);
}

const UNITS = loadUnits(loadCatalogue());

describe('owners guard (spec §5.8)', () => {
  for (const row of OWNERS) {
    it(`${row.judgement}: only ${row.owner}${row.allowed.length > 0 ? ` and ${row.allowed.join(', ')}` : ''} read its raw source`, () => {
      expect(violations(row, UNITS)).toEqual([]);
    });
  }

  it('every row names a known owner and known allowed readers', () => {
    const names = new Set(UNITS.map((u) => u.unit));
    const unknownNames = OWNERS.flatMap((row) => [row.owner, ...row.allowed].filter((n) => !names.has(n)).map((n) => `${row.judgement}: ${n}`));
    expect(unknownNames).toEqual([]);
  });

  describe('the harness', () => {
    const unit = (name: string): UnitDecl | undefined => UNITS.find((u) => u.unit === name);

    it('finds every analysis unit folder and every entry of shared/', () => {
      const folders = readdirSync(ANALYSIS_SRC).filter((n) => n !== 'shared' && statSync(join(ANALYSIS_SRC, n)).isDirectory());
      for (const name of folders) expect(unit(name), name).toBeDefined();
      expect(unit('shared/neutralised.ts')?.folder).toBe('packages/analysis/src/shared/neutralised.ts');
      expect(unit('shared/forecast-field')?.folder).toBe('packages/analysis/src/shared/forecast-field');
    });

    it("takes a feature's calculators' reads from the catalogue", () => {
      expect(unit('talk-window')?.reads).toContain('spans:car-location');
    });

    it("takes a job's reads from the job: the strategy job reads the race's session phase", () => {
      expect(unit('strategy')?.reads).toEqual(expect.arrayContaining(['spans:session-phase-race', 'spans:car-activity-race']));
    });

    it('resolves relative imports to repo-relative files and keeps packages as written', () => {
      const imports = unit('driver-noise')?.imports ?? [];
      expect(imports).toContain('packages/analysis/src/shared/stint-laps.ts');
      expect(imports).toContain('@pitwall/domain');
      expect(imports.some((i) => i.startsWith('./') || i.startsWith('../'))).toBe(false);
    });

    it('codeNames finds a name in code, never in a comment', () => {
      expect(codeOf('/** `scShare` */\nconst a = 1; // vscShare\n')).not.toMatch(/scShare/);
      expect(codeOf("const s = lap.scShare; // a note\nconst u = 'http://x';")).toMatch(/lap\.scShare/);
      expect(codeOf("const u = 'http://x';")).toBe("const u = 'http://x';");
      const lapClasses = unit('lap-classes');
      const gaps = unit('gaps');
      expect(lapClasses !== undefined && codeNames(lapClasses, ['scShare'])).toBe(true);
      expect(gaps !== undefined && codeNames(gaps, ['scShare', 'vscShare'])).toBe(false);
    });

    it('a row names every unit but the owner and the allowed ones that reads its source, by reads or by import', () => {
      const probe: UnitDecl[] = [
        { unit: 'owner', folder: undefined, reads: ['tyres'], imports: [] },
        { unit: 'friend', folder: undefined, reads: ['tyres'], imports: [] },
        { unit: 'reader', folder: undefined, reads: ['tyres'], imports: [] },
        { unit: 'importer', folder: undefined, reads: [], imports: ['packages/analysis/src/owner/private.ts'] },
        { unit: 'clean', folder: undefined, reads: ['timing'], imports: ['@pitwall/domain'] },
      ];
      const row: OwnerRow = {
        judgement: 'tyre rates',
        owner: 'owner',
        allowed: ['friend'],
        source: (u) => u.reads.includes('tyres') || u.imports.includes('packages/analysis/src/owner/private.ts'),
      };
      expect(violations(row, probe)).toEqual([
        'tyre rates: reader reads the raw source; only owner, friend may',
        'tyre rates: importer reads the raw source; only owner, friend may',
      ]);
    });
  });
});
