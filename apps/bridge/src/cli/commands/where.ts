import { DEFAULT_CATALOGUE_FILE, readCatalogue, type Catalogue } from '../../dev/catalogue.ts';
import { StartupError } from '../../startup-error.ts';
import type { CliIo } from '../io.ts';
import { UsageError } from '../usage.ts';

type WhereValues = { topic?: string | undefined; catalogue?: string | undefined };

type Topic = Catalogue['topics'][number];

/** The lines for one topic: its file, its binding and its readers. */
function topicLines(c: Catalogue, t: Topic): string[] {
  const lines = [`topic    ${t.name}  ${t.file}  (owner ${t.owner}, ${t.mode})`];
  if (t.binding !== undefined) {
    const feature = c.features.find((f) => f.name === t.binding?.feature);
    lines.push(`binding  ${t.name}  ${t.binding.kind} ${t.binding.source}  ${feature?.folder ?? t.binding.feature}`);
  }
  for (const reader of t.readers) lines.push(`reader   ${t.name}  ${c.widgets.find((w) => w.name === reader)?.folder ?? reader}`);
  return lines;
}

/** Every folder, file and link of a unit: its widget, feature, analysis folder, calculators, and the topics it owns, binds or reads. */
function unitLines(c: Catalogue, unit: string): string[] {
  const widget = c.widgets.find((w) => w.name === unit);
  const feature = c.features.find((f) => f.name === unit);
  const owned = c.topics.filter((t) => t.owner === unit || t.binding?.feature === unit || widget?.topics.some((e) => e.topic === t.name));
  if (widget === undefined && feature === undefined && owned.length === 0) {
    throw new StartupError(`unknown unit "${unit}"; units: ${[...c.widgets.map((w) => w.name), ...c.features.map((f) => f.name)].join(', ')}`);
  }
  const lines: string[] = [];
  if (widget !== undefined) lines.push(`widget   ${widget.folder}`);
  if (feature !== undefined) {
    lines.push(`feature  ${feature.folder}  (${feature.private ? 'private' : 'analysis'})`);
    if (feature.analysisFolder !== undefined) lines.push(`analysis ${feature.analysisFolder}`);
    for (const calc of feature.calculators) lines.push(`calc     ${calc.id}  reads ${calc.reads.join(', ')}  ${calc.cadence}`);
    for (const job of feature.jobs) lines.push(`job      ${job}`);
    for (const key of feature.config) lines.push(`config   ${key}`);
  }
  for (const t of owned) lines.push(...topicLines(c, t));
  return lines;
}

/** `pitwall where <unit>` / `pitwall where --topic <name>`: prints the folders, files and links from the catalogue, one per line. */
export async function run(positionals: string[], values: WhereValues, io: CliIo): Promise<number> {
  const [unit] = positionals;
  const catalogue = readCatalogue(values.catalogue ?? DEFAULT_CATALOGUE_FILE);
  const name = values.topic;
  let lines: string[];
  if (name !== undefined) {
    const topic = catalogue.topics.find((t) => t.name === name);
    if (topic === undefined) throw new StartupError(`unknown topic "${name}"`);
    lines = topicLines(catalogue, topic);
  } else if (unit !== undefined) {
    lines = unitLines(catalogue, unit);
  } else {
    throw new UsageError('where needs a unit or --topic <name>');
  }
  for (const line of lines) io.out(line);
  return 0;
}
