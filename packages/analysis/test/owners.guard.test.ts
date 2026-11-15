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

/** Whether the code (comments left out) of a unit's source files matches `pattern`. */
function codeMatches(unit: UnitDecl, pattern: RegExp): boolean {
  if (unit.folder === undefined) return false;
  return sourceFiles(join(ROOT, unit.folder)).some((file) => pattern.test(codeOf(readFileSync(file, 'utf8'))));
}

/**
 * The leader taken from the raw order: a car state's `position === 1` (the live timing) or a lap record's
 * `positionAtEnd === 1`, compared either way.
 */
const LEADER_BY_POSITION = /\bposition(?:AtEnd)?\s*[!=]==?\s*1\b|\b1\s*[!=]==?\s*\w+\.position(?:AtEnd)?\b/;

/** A fresh-set predicate: a set's wear compared with 0 (new), either way round. */
const FRESH_SET = /\.wearPct\s*[!=]==?\s*0(?![\d.])|(?<![\d.])0\s*[!=]==?\s*[\w.]+\.wearPct\b/;

/** The laps-to-limit rule: the limit less the wear, or the limit over a rate (`limitPct - …`, `limitPct / …`). */
const LAPS_TO_LIMIT = /\blimitPct\s*[-/]/;

/** A numeric literal 70 (not part of another number: `0.70`, `170`, `70_000`, `7.0` stay out). */
const LITERAL_70 = /(?<![\w.])70(?![\w.])/;

/**
 * A car's pace from its laps: a lap time less a fuel term (degradation's `gammaMsPerKg`, the lap model's `fuelMsPerKg`)
 * or less a field median of the laps (`fieldMedian`), on one line of code.
 */
const PACE_FROM_LAPS = /\blapTimeMs\s*-[^;\n]*\b(?:gammaMsPerKg|fuelMsPerKg|fieldMedian)\b/;

/** A lap record of the leader taken by index: `<…>lap(s)[leader]` or `<…>lap(s)[order[0]]` (a stand-in lap of its own). */
const LAP_OF_LEADER = /\b\w*[Ll]aps?\s*\[\s*(?:leader|order\s*\[\s*0\s*\])\s*\]/;

/**
 * A dry pace from the slick medians: a field median of slick laps read (`medianMs.slick`, crossover's medians per type)
 * as a reference, or crossover's `dryRefOf` (SP4.3c Task 14, O3, B3).
 */
const DRY_PACE_FROM_MEDIANS = /\bmedianMs\.slick\b|\bdryRefOf\b/;

/**
 * Reading "rain coming" from the forecast samples: the samples ahead filtered by their offset (`offsetMin >= 0`) or a
 * rain chance held against a threshold (`rainPct >= …`) (SP4.3c Task 14, O3a).
 */
const RAIN_FROM_SAMPLES = /\boffsetMin\s*>=?\s*0(?![\d.])|\brainPct\s*>=/;

/** The weather path's dynamics: the wetness a rain lap adds, a dry lap takes and the ceiling (SP4.3c Task 14, O3b). */
const WETNESS_DYNAMICS = ['WETNESS_RISE_MS_PER_LAP', 'WETNESS_FALL_MS_PER_LAP', 'WETNESS_MAX_MS'];

/**
 * The lap model's compound and wetness term computed outside it: a tyre type's wetness slope read by index
 * (`wetnessMsPerMs[type]`), as `race-monte-carlo/rivals.ts`' `typeMs` did (SP4.3c Task 15, O4).
 */
const TYPE_TERM = /\bwetnessMsPerMs\s*\[/;

/** The pass curve evaluated: its slope times an advantage (`slopePerMs * …`), as `race-forecast`'s copy did (SP4.3c Task 15, O13). */
const PASS_CURVE = /\bslopePerMs\s*\*/;

/**
 * A burn per lap computed from a fuel load: a `burn…` assigned a fuel divided by something (`burn = fuelKg / n`,
 * `burnKg[c] = … fuelKg[c] … / lapsLeft`), the three `fuel ÷ laps left` formulas (SP4.3c Task 15, O15).
 */
const BURN_FROM_FUEL = /\bburn\w*(?:\[[^\]\n]*\])?\s*=(?!=)[^;\n]*\bfuel\w*[^;\n]*\//;

/** `code` without its string and template literals (a note that quotes "70" is no literal of the limit). */
const withoutStrings = (code: string): string => code.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''");

/** Whether the code of a unit's source files, comments and strings left out, matches `pattern`. */
function literalMatches(unit: UnitDecl, pattern: RegExp): boolean {
  if (unit.folder === undefined) return false;
  return sourceFiles(join(ROOT, unit.folder)).some((file) => pattern.test(withoutStrings(codeOf(readFileSync(file, 'utf8')))));
}

/** The owners (spec §5.2–§5.3); each owner task adds its row. */
const OWNERS: OwnerRow[] = [
  // SP4.3c Task 5 (O7): which laps count is `lap-classes`' (`isNeutralisedLap`, `touchesNeutralisation`); no other unit
  // reads a lap record's SC or VSC share itself. Expressed by name: `lap-classes` has no private module to import.
  { judgement: 'lap counts', owner: 'lap-classes', source: (u) => codeNames(u, ['scShare', 'vscShare']), allowed: [] },
  // SP4.3c Task 6 (O10): gaps, the order and the leader's progress now are `gaps`' (`intervals`, `leaderProgress`); no
  // other unit finds the leader now in the raw order (the live timing's position, a lap record's position at its end).
  // `forecast-score` scores past races lap by lap from their stored laps (`forecasts.ts`), not the race now.
  { judgement: 'gaps and order now', owner: 'gaps', source: (u) => codeMatches(u, LEADER_BY_POSITION), allowed: ['forecast-score'] },
  // SP4.3c Task 12 (O1, spec §5.2): tyre rates, offsets and availability are `tyre-model`'s; no other unit reads the
  // game's tyre sets (the live state's `tyres.sets`, a lap record's `tyreSets`, or their fields). `track-wetness` may,
  // only for the slick delta as a wetness reading (O3, research 22 §1.9); `degradation` may, only for its filter prior
  // through `shared/tyre-prior.ts` (the plan's interface: the game's usable life and loss per %, no unit read).
  {
    judgement: 'tyre rates, offsets and availability',
    owner: 'tyre-model',
    source: (u) => codeNames(u, ['tyreSets', 'fittedIdx', 'usableLifeLaps', 'lapDeltaMs', 'lifeSpanLaps', 'tyres\\.sets', 'setsNow']),
    // `forecast-score` only writes `setsNow: null` into the past views it builds (a past frame has no sets now).
    // `shared/tyre-prior.ts` holds the shared rules over the sets (fix round 2: the fresh-set pick, the game's loss).
    allowed: ['track-wetness', 'degradation', 'forecast-score', 'shared/tyre-prior.ts'],
  },
  // SP4.3c Task 12 fix round 2 (C43): `degradation` reads the game's sets only through `shared/tyre-prior.ts`: it hands
  // a lap record's `tyreSets` over and names no field of a set (its usable life, its delta, the fitted index).
  {
    judgement: "the game's set fields (degradation through shared/tyre-prior)",
    owner: 'tyre-model',
    source: (u) => codeNames(u, ['usableLifeLaps', 'lapDeltaMs', 'fittedIdx', 'lifeSpanLaps']),
    allowed: ['shared/tyre-prior.ts', 'track-wetness'],
  },
  // SP4.3c Task 12 fix round 2 (C43): which set is fresh (new, `wearPct === 0`) is decided by `tyre-model` and the shared
  // pick `bestFreshSet` of `shared/tyre-prior.ts` alone.
  { judgement: 'the fresh-set pick', owner: 'tyre-model', source: (u) => codeMatches(u, FRESH_SET), allowed: ['shared/tyre-prior.ts'] },
  // SP4.3c Task 12 fix round 2 (C43): laps to the wear limit ((limit − wear) / rate, 0 at or past it) are computed by
  // `lapsToLimitOf` of `shared/tyre-prior.ts` alone; tyre-model and tyre-life call it.
  { judgement: 'laps to the limit', owner: 'shared/tyre-prior.ts', source: (u) => codeMatches(u, LAPS_TO_LIMIT), allowed: [] },
  // SP4.3c Task 12 fix round 2 (C47, C3): the wear limit 70 % is `tyre-model`'s config key `limitPct` alone; no other
  // unit has a literal 70 in its code (strings and comments left out).
  { judgement: 'the wear limit literal', owner: 'tyre-model', source: (u) => literalMatches(u, LITERAL_70), allowed: [] },
  // SP4.3c Task 13 (O2, spec §5.3): a car's pace (the fuel-corrected base pace, its line, the residuals) is
  // `degradation`'s; no other unit takes a pace from lap times less fuel or less a field median of the laps
  // (`forecast-field`'s raw-lap fallback and `race-interaction`'s own residuals are deleted).
  { judgement: "a car's pace", owner: 'degradation', source: (u) => codeMatches(u, PACE_FROM_LAPS), allowed: [] },
  // SP4.3c Task 13 fix round 2 (R47, C43): which car's lap stands in for a car without a lap is `degradation`'s (its
  // field `standIn`, `fromCarId`); no other unit takes the leader's lap record (`newestLap[leader]`, `laps[order[0]]`).
  { judgement: "which car's lap stands in", owner: 'degradation', source: (u) => codeMatches(u, LAP_OF_LEADER), allowed: [] },
  // SP4.3c Task 14 (O3, B3): the dry pace (the dry reference) is `track-wetness`'s; no other unit takes one from the slick
  // medians (`crossover`'s `dryRefOf` is deleted: it reads `track-wetness`'s reference and 110 % line).
  { judgement: 'dry pace', owner: 'track-wetness', source: (u) => codeMatches(u, DRY_PACE_FROM_MEDIANS), allowed: [] },
  // SP4.3c Task 14 (O3a): "rain coming" (one threshold), the highest chance per lap and the samples ahead are
  // `rain-outlook`'s; no other unit filters the forecast samples or holds a rain chance against a threshold (`weather`'s
  // filter and `strategy`'s `rainCandidatePct` are deleted).
  { judgement: 'rain coming', owner: 'rain-outlook', source: (u) => codeMatches(u, RAIN_FROM_SAMPLES), allowed: [] },
  // SP4.3c Task 14 (O3b, spec §5.4a): the weather path (rain chance → wetness per lap) is `weather-paths`'; no other unit
  // holds the wetness dynamics (`race-monte-carlo`'s own timeline is moved, the MC calls `weatherPath`).
  { judgement: 'weather path', owner: 'weather-paths', source: (u) => codeNames(u, WETNESS_DYNAMICS), allowed: [] },
  // SP4.3c Task 15 (O4): the lap time's compound and wetness term is `lap-model`'s (`typeTermMs`); no other unit reads a
  // tyre type's wetness slope to price a compound (`rivals.ts`' `typeMs` is deleted). `track-wetness` reads the slopes
  // as the slick scale and the dry reference's slope per type (O3: "the slick scale from the lap model's parameters").
  { judgement: 'the compound and wetness term', owner: 'lap-model', source: (u) => codeMatches(u, TYPE_TERM), allowed: ['track-wetness'] },
  // SP4.3c Task 15 (O13): "can a car pass" is `race-interaction`'s one pass curve (`passChance`, its fit); no other unit
  // evaluates the curve (`race-forecast`'s copy is deleted; `battle`'s fixed margin gives way to the chance).
  { judgement: 'the pass curve', owner: 'race-interaction', source: (u) => codeMatches(u, PASS_CURVE), allowed: [] },
  // SP4.3c Task 15 (O15): the burn the simulators use is `shared/fuel-burn.ts`' through the starting point; no other
  // unit computes a burn from a fuel load (`race-forecast/field.ts`, `strategy-dp/thresholds.ts`, `strategy-dp/state.ts`).
  { judgement: 'the fuel burn', owner: 'shared/fuel-burn.ts', source: (u) => codeMatches(u, BURN_FROM_FUEL), allowed: [] },
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

    it('the leader-by-position pattern finds a leader read from the order, in code only', () => {
      expect(LEADER_BY_POSITION.test(codeOf('const leader = cars.find((c) => c.timing.position === 1);'))).toBe(true);
      expect(LEADER_BY_POSITION.test(codeOf('if (lap.positionAtEnd !== 1) continue;'))).toBe(true);
      expect(LEADER_BY_POSITION.test(codeOf('if (1 === car.position) x();'))).toBe(true);
      expect(LEADER_BY_POSITION.test(codeOf('// the car with position === 1\nconst p = position === 10;'))).toBe(false);
      expect(LEADER_BY_POSITION.test(codeOf('const g = timing.gridPosition - timing.position;'))).toBe(false);
    });

    it('fix round 2 patterns: a fresh-set predicate, the laps-to-limit rule, a literal 70 (in code only, not in strings)', () => {
      expect(FRESH_SET.test(codeOf('const f = s.available && s.wearPct === 0;'))).toBe(true);
      expect(FRESH_SET.test(codeOf('if (0 == set.wearPct) x();'))).toBe(true);
      expect(FRESH_SET.test(codeOf('const w = s.wearPct === 0.5; // s.wearPct === 0'))).toBe(false);
      expect(LAPS_TO_LIMIT.test(codeOf('known((limitPct - wear.value) / rate.value, 0)'))).toBe(true);
      expect(LAPS_TO_LIMIT.test(codeOf('known(v.c.limitPct / worst.value.value, 0)'))).toBe(true);
      expect(LAPS_TO_LIMIT.test(codeOf('return (k * limitPct) / usableLife;'))).toBe(false);
      expect(LITERAL_70.test(withoutStrings(codeOf('const limitPct = car?.limitPct ?? 70;')))).toBe(true);
      expect(LITERAL_70.test(withoutStrings(codeOf("const note = 'k · 70 / usableLife'; // 70 %")))).toBe(false);
      expect(LITERAL_70.test(withoutStrings(codeOf('const a = 0.70 + 170 + 70_000 + 7.0;')))).toBe(false);
    });

    it("Task 13 pattern: a pace from lap times less fuel or a field median, in code only; degradation's fuel correction matches", () => {
      expect(PACE_FROM_LAPS.test(codeOf('sp.paceMs[k] = lap.lapTimeMs - (fuel.known ? lapModel.fuelMsPerKg * fuel.value : 0);'))).toBe(true);
      expect(PACE_FROM_LAPS.test(codeOf('const residual = record.lapTimeMs - nth(fieldMedian, lap);'))).toBe(true);
      expect(PACE_FROM_LAPS.test(codeOf('known(Math.round(lap.lapTimeMs - config.gammaMsPerKg * fuel.value), at)'))).toBe(true);
      expect(PACE_FROM_LAPS.test(codeOf('// lap.lapTimeMs - fieldMedian\nconst d = lap.lapTimeMs - fastest;'))).toBe(false);
      expect(PACE_FROM_LAPS.test(codeOf('const g = p.fuelMsPerKg * car.fuelKg;'))).toBe(false);
      const degradation = unit('degradation');
      expect(degradation !== undefined && codeMatches(degradation, PACE_FROM_LAPS)).toBe(true);
    });

    it("Task 13 fix round 2 pattern: the leader's lap record by index, in code only; a lap time array is no lap record", () => {
      expect(LAP_OF_LEADER.test(codeOf('const standIn = newestLap[leader];'))).toBe(true);
      expect(LAP_OF_LEADER.test(codeOf('const lap = laps[order[0]];'))).toBe(true);
      expect(LAP_OF_LEADER.test(codeOf('const ms = lapMs[leader] ?? 0;'))).toBe(false);
      expect(LAP_OF_LEADER.test(codeOf('// newestLap[leader]\nconst own = newestLap[k];'))).toBe(false);
    });

    it('Task 14 patterns: a dry pace from slick medians, rain read from the samples, the wetness dynamics (in code only)', () => {
      expect(DRY_PACE_FROM_MEDIANS.test(codeOf('const m = row.medianMs.slick;'))).toBe(true);
      expect(DRY_PACE_FROM_MEDIANS.test(codeOf('const dryRefMs = dryRefOf(byLap);'))).toBe(true);
      expect(DRY_PACE_FROM_MEDIANS.test(codeOf('// row.medianMs.slick\nconst m = row.medianMs[type];'))).toBe(false);
      expect(RAIN_FROM_SAMPLES.test(codeOf('const ahead = forecast.filter((s) => s.offsetMin >= 0);'))).toBe(true);
      expect(RAIN_FROM_SAMPLES.test(codeOf('return byLap.some((l) => l.rainPct >= config.rainCandidatePct);'))).toBe(true);
      expect(RAIN_FROM_SAMPLES.test(codeOf('const rain = u < rainPctAt(byLap, lap + shift);'))).toBe(false);
      expect(RAIN_FROM_SAMPLES.test(codeOf('// s.offsetMin >= 0\nconst d = Math.abs(s.offsetMin);'))).toBe(false);
      expect(RAIN_FROM_SAMPLES.test(codeOf('const later = s.offsetMin >= 0.5;'))).toBe(false);
      const mc = unit('race-monte-carlo');
      const wp = unit('weather-paths');
      expect(wp?.folder).toBe('packages/analysis/src/weather-paths');
      expect(wp !== undefined && codeNames(wp, WETNESS_DYNAMICS), 'weather-paths holds the dynamics').toBe(true);
      expect(mc !== undefined && codeNames(mc, ['weatherPath']), 'race-monte-carlo calls weatherPath').toBe(true);
      expect(mc?.imports).toContain('packages/analysis/src/weather-paths/index.ts');
    });

    it('Task 15 patterns: a type term by index, the pass curve evaluated, a burn from a fuel load (in code only)', () => {
      expect(TYPE_TERM.test(codeOf('const ms = p.compoundOffsetMs[c] + p.wetnessMsPerMs[typeOf(c)] * w;'))).toBe(true);
      expect(TYPE_TERM.test(codeOf('wetnessMsPerMs: { slick: 1, inter: 0, wet: 0 },'))).toBe(false);
      expect(TYPE_TERM.test(codeOf('// p.wetnessMsPerMs[type]\nconst s = params.wetnessMsPerMs.slick;'))).toBe(false);
      expect(PASS_CURVE.test(codeOf('const eta = curve.level + curve.slopePerMs * advantageMs;'))).toBe(true);
      expect(PASS_CURVE.test(codeOf('slopePerMs: config.passSlopePerMs,'))).toBe(false);
      expect(PASS_CURVE.test(codeOf('// cap · σ(level + slopePerMs * u)\nconst p = passChance(u, gap, ctx);'))).toBe(false);
      expect(BURN_FROM_FUEL.test(codeOf('const burn = input.carParams.fuelKg / n;'))).toBe(true);
      expect(BURN_FROM_FUEL.test(codeOf('f.burnKg[c] = lapsLeft > 0 ? (f.fuelKg[c] ?? 0) / lapsLeft : 0;'))).toBe(true);
      expect(BURN_FROM_FUEL.test(codeOf('const burn = burnPerLapKg(laps, options);'))).toBe(false);
      expect(BURN_FROM_FUEL.test(codeOf('const lapsOfFuel = fuelKg / burn;'))).toBe(false);
      expect(BURN_FROM_FUEL.test(codeOf('const burn = start.fuelBurnKgPerLap[c] ?? 0;'))).toBe(false);
      // the readers call the owners: rivals the lap model's term, race-forecast and battle the one pass chance
      const mc = unit('race-monte-carlo');
      expect(mc !== undefined && codeNames(mc, ['typeTermMs']), 'race-monte-carlo calls typeTermMs').toBe(true);
      expect(mc?.imports).toContain('packages/analysis/src/lap-model/index.ts');
      for (const name of ['race-forecast', 'battle']) {
        const u = unit(name);
        expect(u !== undefined && codeNames(u, ['passChance']), `${name} calls passChance`).toBe(true);
        expect(u?.imports.some((i) => i.startsWith('packages/analysis/src/race-interaction/')), `${name} imports race-interaction`).toBe(true);
      }
      const forecastField = unit('shared/forecast-field');
      expect(forecastField !== undefined && codeNames(forecastField, ['planBurnKgPerLap']), 'forecast-field calls planBurnKgPerLap').toBe(true);
    });

    it('fix round 2: degradation and tyre-model both call the shared fresh-set pick; tyre-model and tyre-life the shared laps-to-limit rule', () => {
      const PRIOR = 'packages/analysis/src/shared/tyre-prior.ts';
      for (const name of ['degradation', 'tyre-model']) {
        const u = unit(name);
        expect(u?.imports, name).toContain(PRIOR);
        expect(u !== undefined && codeNames(u, ['bestFreshSet']), `${name} calls bestFreshSet`).toBe(true);
      }
      for (const name of ['tyre-model', 'tyre-life']) {
        const u = unit(name);
        expect(u?.imports, name).toContain(PRIOR);
        expect(u !== undefined && codeNames(u, ['lapsToLimitOf']), `${name} calls lapsToLimitOf`).toBe(true);
      }
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
