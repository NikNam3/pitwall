// The catalogue (spec 8.1): imports every widget, feature and topic file, writes catalogue.generated.json and checks the naming rules.
import { existsSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Catalogue } from '../packages/contracts/src/topics/dev.catalogue.ts';
import { findFeatureFolders } from './gen-features.ts';
import { findTopicFiles } from './gen-topics.ts';
import { findWidgetFolders } from './gen-widgets.ts';
import { topicPrefix } from './units.ts';

export type { Catalogue };

const ROOT = join(import.meta.dirname, '..');
const OUT_FILE = join(ROOT, 'catalogue.generated.json');

/** The directories the catalogue reads; absolute. `analysis` is optional: a feature without a folder there has none. */
export type CatalogueDirs = { widgets: string; features: string; topics: string; analysis?: string };

const DEFAULT_DIRS: Required<CatalogueDirs> = {
  widgets: join(ROOT, 'apps', 'ui', 'src', 'widgets'),
  features: join(ROOT, 'apps', 'bridge', 'src', 'features'),
  topics: join(ROOT, 'packages', 'contracts', 'src', 'topics'),
  analysis: join(ROOT, 'packages', 'analysis', 'src'),
};

/** Topics that no feature binds because the bridge publishes them itself (global topics are exempt by their scope). */
const PUBLISHED_BY_BRIDGE = ['replay.status'];

/** A path as the catalogue shows it: relative to the repo root, with forward slashes. */
const shown = (path: string): string => relative(ROOT, path).split('\\').join('/');

const importDefault = async <T>(file: string): Promise<T> => ((await import(pathToFileURL(file).href)) as { default: T }).default;

type WidgetModule = {
  decl: {
    name: string;
    data: Record<string, { topic: string; kind: 'state' | 'folded'; optional?: boolean }>;
    options: object;
    sizes: object;
  };
};
type BindingShape = { topic: string } & Partial<Record<'from' | 'fromHistory' | 'fromJob', string>> & { fromInsights?: true };
type FeatureModule = {
  calculators: Array<{ id: string; reads: ReadonlyArray<string | { calculator: string }>; cadence: string | { hz: number } }>;
  topics: BindingShape[];
  jobs?: Array<{ id: string }>;
  config?: Array<{ key: string }>;
};
type TopicModule = { owner: string; scope: string; mode: string; maxHz: number };

/** An engine `Cadence` as text: `{ hz: 10 }` becomes `10 Hz`. */
const cadenceText = (cadence: string | { hz: number }): string => (typeof cadence === 'string' ? cadence : `${cadence.hz} Hz`);

/** An engine `Dependency` as text: `{ calculator: id }` becomes `calculator:<id>`. */
const readText = (read: string | { calculator: string }): string => (typeof read === 'string' ? read : `calculator:${read.calculator}`);

function bindingOf(shape: BindingShape, feature: string): NonNullable<Catalogue['topics'][number]['binding']> {
  if (shape.from !== undefined) return { kind: 'calculator', source: shape.from, feature };
  if (shape.fromHistory !== undefined) return { kind: 'history', source: shape.fromHistory, feature };
  if (shape.fromJob !== undefined) return { kind: 'job', source: shape.fromJob, feature };
  return { kind: 'insights', source: shape.topic, feature };
}

/** Imports every widget, feature and topic file in `dirs` and describes how they connect. */
export async function buildCatalogue(dirs: CatalogueDirs = DEFAULT_DIRS): Promise<Catalogue> {
  const widgetFolders = findWidgetFolders(dirs.widgets);
  const widgets: Catalogue['widgets'] = [];
  for (const folder of widgetFolders) {
    const { decl } = await importDefault<WidgetModule>(join(dirs.widgets, folder, 'register.ts'));
    widgets.push({
      name: decl.name,
      folder: shown(join(dirs.widgets, folder)),
      topics: Object.values(decl.data).map((entry) => ({ topic: entry.topic, kind: entry.kind, optional: entry.optional === true })),
      options: Object.keys(decl.options),
      sizes: Object.keys(decl.sizes),
    });
  }

  const widgetNames = new Set(widgets.map((w) => w.name));
  const features: Catalogue['features'] = [];
  const bindings = new Map<string, NonNullable<Catalogue['topics'][number]['binding']>>();
  for (const name of findFeatureFolders(dirs.features)) {
    const feature = await importDefault<FeatureModule>(join(dirs.features, name, 'register.ts'));
    const analysis = dirs.analysis === undefined ? undefined : join(dirs.analysis, name);
    features.push({
      name,
      folder: shown(join(dirs.features, name)),
      ...(analysis !== undefined && existsSync(analysis) && { analysisFolder: shown(analysis) }),
      private: widgetNames.has(name),
      calculators: feature.calculators.map((c) => ({ id: c.id, reads: c.reads.map(readText), cadence: cadenceText(c.cadence) })),
      jobs: (feature.jobs ?? []).map((job) => job.id),
      config: (feature.config ?? []).map((key) => key.key),
    });
    for (const shape of feature.topics) if (!bindings.has(shape.topic)) bindings.set(shape.topic, bindingOf(shape, name));
  }

  const topics: Catalogue['topics'] = [];
  for (const name of findTopicFiles(dirs.topics)) {
    const file = join(dirs.topics, `${name}.ts`);
    const def = await importDefault<TopicModule>(file);
    const binding = bindings.get(name);
    topics.push({
      name,
      owner: def.owner,
      mode: def.mode,
      scope: def.scope,
      maxHz: Number.isFinite(def.maxHz) ? def.maxHz : null,
      file: shown(file),
      ...(binding !== undefined && { binding }),
      readers: widgets.filter((w) => w.topics.some((t) => t.topic === name)).map((w) => w.name).sort(),
    });
  }
  return { widgets, topics, features };
}

/** The catalogue's rule violations (errors, each naming its file) and hints (warnings). */
export function checkCatalogue(c: Catalogue): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const widgetNames = new Set(c.widgets.map((w) => w.name));
  const units = new Set([...widgetNames, ...c.features.map((f) => f.name)]);
  const topicOf = new Map(c.topics.map((t) => [t.name, t]));

  for (const t of c.topics) {
    if (t.owner !== 'core' && !units.has(t.owner)) {
      errors.push(`${t.file}: topic "${t.name}" has owner "${t.owner}", which is neither core nor a unit`);
    } else if (t.owner !== 'core' && !t.name.startsWith(`${topicPrefix(t.owner)}.`)) {
      errors.push(`${t.file}: topic "${t.name}" must start with "${topicPrefix(t.owner)}", the prefix of its owner "${t.owner}"`);
    }
    const isPrivate = widgetNames.has(t.owner);
    if (isPrivate && !t.readers.includes(t.owner)) {
      errors.push(`${t.file}: private topic "${t.name}" is not read by its own widget "${t.owner}"`);
    }
    if (t.owner !== 'core' && units.has(t.owner) && !isPrivate && t.readers.length === 0) {
      warnings.push(`${t.file}: analysis topic "${t.name}" has no reader yet`);
    }
  }

  for (const w of c.widgets) {
    const register = `${w.folder}/register.ts`;
    const folderName = w.folder.slice(w.folder.lastIndexOf('/') + 1);
    if (w.name !== folderName) errors.push(`${register}: widget name "${w.name}" differs from its folder "${folderName}"`);
    for (const entry of w.topics) {
      const t = topicOf.get(entry.topic);
      if (t === undefined) {
        errors.push(`${register}: reads "${entry.topic}", which is not a topic`);
        continue;
      }
      if (widgetNames.has(t.owner) && t.owner !== w.name) {
        errors.push(`${register}: reads "${t.name}", a private topic of display "${t.owner}"`);
      }
      if (t.binding === undefined && t.scope !== 'global' && !PUBLISHED_BY_BRIDGE.includes(t.name)) {
        errors.push(`${register}: reads "${t.name}", which no feature binds`);
      }
      if (t.mode === 'append' && entry.kind === 'state') {
        errors.push(`${register}: reads "${t.name}", an append topic, with topic(); use folded()`);
      }
      if (t.mode === 'state' && entry.kind === 'folded') {
        errors.push(`${register}: reads "${t.name}", a state topic, with folded(); use topic()`);
      }
    }
  }
  return { errors, warnings };
}

/** Builds the catalogue, writes `catalogue.generated.json` and prints the findings; returns the exit code (0 for errors too when `failOnErrors` is false, so `pitwall where` can help fix them). */
export async function generateCatalogue(outFile: string = OUT_FILE, failOnErrors = true): Promise<number> {
  const catalogue = await buildCatalogue();
  writeFileSync(outFile, `${JSON.stringify(catalogue, null, 2)}\n`);
  const { errors, warnings } = checkCatalogue(catalogue);
  for (const warning of warnings) console.warn(`warning: ${warning}`);
  for (const error of errors) console.error(`error: ${error}`);
  return errors.length === 0 || !failOnErrors ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await generateCatalogue(OUT_FILE, !process.argv.includes('--no-fail'));
