// The calculator config (spec 7.3): the features' declared defaults, overridden by `<PITWALL_DATA_DIR>/config.json`,
// and the copy each recording keeps next to it as `<recording>.config.json`, so a replay raises the same alarms.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConfigKey, ConfigValue } from '@pitwall/engine';
import type { Feature } from './features/feature.ts';
import type { Logger } from './log.ts';
import { StartupError } from './startup-error.ts';

/** Section key → field → value. The effective config holds every declared key with all its fields. */
export type FeatureConfig = Record<string, Record<string, ConfigValue>>;

type Declared = ReadonlyMap<string, ConfigKey<Record<string, ConfigValue>>>;

/** The sections the features declare, by key. A key declared twice (in one feature or two) is a `StartupError`. */
function declaredBy(features: readonly Feature[]): Declared {
  const declared = new Map<string, ConfigKey<Record<string, ConfigValue>>>();
  for (const feature of features) {
    for (const section of feature.config ?? []) {
      if (declared.has(section.key)) throw new StartupError(`config key "${section.key}" is declared more than once (feature ${feature.name})`);
      declared.set(section.key, section);
    }
  }
  return declared;
}

/** The defaults of every declared key, with `config` over them. Keys the features do not declare are dropped. */
export function effectiveConfig(features: readonly Feature[], config: FeatureConfig = {}): FeatureConfig {
  const effective: FeatureConfig = {};
  for (const [key, section] of declaredBy(features)) effective[key] = { ...section.defaults, ...config[key] };
  return effective;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The file's text, or `undefined` when there is no such file. */
function readOptional(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new StartupError(`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * The overrides in `text` (the content of `path`). Structure that is not an object of objects, or not JSON, is always a
 * `StartupError`. A key, field or value that does not fit the declarations goes to `reject`, which throws (strict) or
 * logs (lenient); the entry is then left out and the default stays.
 */
function parseOverrides(path: string, text: string, declared: Declared, reject: (message: string) => void): FeatureConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new StartupError(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed)) throw new StartupError(`${path} must be an object of the form { "<key>": { "<name>": value } }`);
  const overrides: FeatureConfig = {};
  for (const [key, section] of Object.entries(parsed)) {
    const known = declared.get(key);
    if (known === undefined) {
      reject(`${path}: unknown config key "${key}"; known keys: ${[...declared.keys()].join(', ') || 'none'}`);
      continue;
    }
    if (!isRecord(section)) throw new StartupError(`${path}: config key "${key}" must be an object of field values`);
    const fields: Record<string, ConfigValue> = {};
    for (const [name, value] of Object.entries(section)) {
      if (!Object.hasOwn(known.defaults, name)) {
        reject(`${path}: unknown field "${name}" in config key "${key}"; known fields: ${Object.keys(known.defaults).join(', ')}`);
        continue;
      }
      const expected = typeof known.defaults[name];
      if (typeof value !== expected) {
        reject(`${path}: config key "${key}", field "${name}" must be a ${expected}, got ${JSON.stringify(value)}`);
        continue;
      }
      fields[name] = value as ConfigValue;
    }
    overrides[key] = fields;
  }
  return overrides;
}

/** The file at `path` over the defaults; `undefined` when `path` does not exist. */
function readConfigFile(path: string, features: readonly Feature[], reject: (message: string) => void): FeatureConfig | undefined {
  const declared = declaredBy(features);
  const text = readOptional(path);
  return text === undefined ? undefined : effectiveConfig(features, parseOverrides(path, text, declared, reject));
}

const fail = (message: string): never => {
  throw new StartupError(message);
};

/**
 * The effective config of this run: the declared defaults with `<dataDirRoot>/config.json` over them (no file: the
 * defaults). Throws `StartupError` for an unreadable or malformed file, an unknown key or field, a value of the wrong
 * type, or a key declared twice.
 *
 * The result is fixed for the bridge run. Changing it while running (from the UI) is later work: it would need a new
 * config in the scheduler input and a new sidecar for the session.
 */
export function loadFeatureConfig(dataDirRoot: string, features: readonly Feature[]): FeatureConfig {
  return readConfigFile(join(dataDirRoot, 'config.json'), features, fail) ?? effectiveConfig(features);
}

/** Where a recording keeps the config it ran with. */
export const sessionConfigPath = (recordingPath: string): string => `${recordingPath}.config.json`;

/**
 * The config to process a recording with: the one stored next to it if there is one, else `effective`. A sidecar is a
 * historical record, so it is read leniently: a key, field or value that the features no longer declare (or declare
 * with another type) is dropped with one `log.warn` and the feature default stays. Only an unreadable file, invalid
 * JSON or a top level or section that is not an object throws `StartupError`.
 */
export function recordingConfig(recordingPath: string, features: readonly Feature[], effective: FeatureConfig, log?: Logger): FeatureConfig {
  const reject = (message: string): void => log?.warn({ recordingPath }, message);
  return readConfigFile(sessionConfigPath(recordingPath), features, reject) ?? effective;
}
