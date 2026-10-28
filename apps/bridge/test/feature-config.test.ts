// The bridge side of the calculator config: `<PITWALL_DATA_DIR>/config.json` over the features' defaults, validated,
// and the copy each recording keeps next to it (`<recording>.config.json`).
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { defineConfig } from '@pitwall/engine';
import { defineFeature, type Feature } from '../src/features/feature.ts';
import { loadFeatureConfig, recordingConfig, sessionConfigPath } from '../src/feature-config.ts';
import { createLogger } from '../src/log.ts';
import { StartupError } from '../src/startup-error.ts';

const tyres = defineConfig('tyres.wear', { warnAt: 70, label: 'wear', strict: false });
const fuel = defineConfig('fuel.margin', { laps: 1.5 });
const features: Feature[] = [
  defineFeature({ name: 'tyres', calculators: [], topics: [], config: [tyres] }),
  defineFeature({ name: 'fuel', calculators: [], topics: [], config: [fuel] }),
  defineFeature({ name: 'plain', calculators: [], topics: [] }),
];
const DEFAULTS = { 'tyres.wear': { warnAt: 70, label: 'wear', strict: false }, 'fuel.margin': { laps: 1.5 } };

const tmp = () => mkdtempSync(join(tmpdir(), 'feature-config-'));
/** A data directory root whose `config.json` holds `json` (raw text), or none. */
const rootWith = (json?: string): string => {
  const root = tmp();
  if (json !== undefined) writeFileSync(join(root, 'config.json'), json);
  return root;
};
const load = (overrides?: unknown, list: readonly Feature[] = features) =>
  loadFeatureConfig(rootWith(overrides === undefined ? undefined : JSON.stringify(overrides)), list);

/** The `StartupError` the loader throws, to read its message. */
const failure = (run: () => unknown): StartupError => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(StartupError);
    return error as StartupError;
  }
  throw new Error('expected a StartupError');
};

describe('loadFeatureConfig', () => {
  it('a missing config.json means the defaults of every declared key, and only those', () => {
    expect(load()).toEqual(DEFAULTS);
  });
  it('without declared config the effective config is empty', () => {
    expect(load(undefined, [features[2]!])).toEqual({});
    expect(load({}, [])).toEqual({});
  });
  it('an empty config.json means the defaults', () => {
    expect(load({})).toEqual(DEFAULTS);
  });
  it('overrides are merged over the defaults, field by field', () => {
    expect(load({ 'tyres.wear': { warnAt: 55 } })).toEqual({ 'tyres.wear': { warnAt: 55, label: 'wear', strict: false }, 'fuel.margin': { laps: 1.5 } });
    expect(load({ 'tyres.wear': { label: 'grip', strict: true }, 'fuel.margin': { laps: 0 } })).toEqual({
      'tyres.wear': { warnAt: 70, label: 'grip', strict: true },
      'fuel.margin': { laps: 0 },
    });
  });
  it('an empty section changes nothing', () => {
    expect(load({ 'tyres.wear': {} })).toEqual(DEFAULTS);
  });
  it('what it returns is what a ConfigKey reads back', () => {
    const effective = load({ 'tyres.wear': { warnAt: 55 } });
    expect(tyres.read({ config: effective } as never)).toEqual({ warnAt: 55, label: 'wear', strict: false });
  });

  describe('validation', () => {
    it('an unknown key is a StartupError naming the key', () => {
      const error = failure(() => load({ 'tyres.wear': {}, 'brakes.wear': { warnAt: 1 } }));
      expect(error.message).toContain('brakes.wear');
      expect(error.message).toContain('config.json');
    });
    it('a key that no feature declares is unknown even when it is well formed', () => {
      expect(failure(() => load({ 'tyres.wear': { warnAt: 1 } }, [features[1]!])).message).toContain('tyres.wear');
    });
    it('an unknown field is a StartupError naming the key and the field', () => {
      const error = failure(() => load({ 'tyres.wear': { warnAt: 55, warnBy: 3 } }));
      expect(error.message).toContain('tyres.wear');
      expect(error.message).toContain('warnBy');
    });
    it.each([
      ['a string for a number', { 'tyres.wear': { warnAt: '55' } }, 'warnAt'],
      ['a number for a string', { 'tyres.wear': { label: 7 } }, 'label'],
      ['a number for a boolean', { 'tyres.wear': { strict: 1 } }, 'strict'],
      ['a boolean for a number', { 'fuel.margin': { laps: true } }, 'laps'],
      ['null for a number', { 'fuel.margin': { laps: null } }, 'laps'],
      ['an object for a number', { 'fuel.margin': { laps: { value: 2 } } }, 'laps'],
    ])('a value of the wrong type (%s) is a StartupError naming the key and the field', (_what, overrides, field) => {
      const error = failure(() => load(overrides));
      expect(error.message).toContain(Object.keys(overrides)[0]!);
      expect(error.message).toContain(field);
    });
    it.each([
      ['not JSON', '{ "tyres.wear": '],
      ['an array', '[]'],
      ['null', 'null'],
      ['a number', '3'],
      ['a section that is not an object', '{ "tyres.wear": 5 }'],
      ['a section that is null', '{ "tyres.wear": null }'],
      ['a section that is an array', '{ "tyres.wear": [] }'],
    ])('a config.json that is %s is a StartupError', (_what, raw) => {
      expect(failure(() => loadFeatureConfig(rootWith(raw), features)).message).toContain('config.json');
    });
    it('an unreadable config.json (a directory) is a StartupError', () => {
      const root = tmp();
      mkdirSync(join(root, 'config.json'));
      expect(() => loadFeatureConfig(root, features)).toThrow(StartupError);
    });
  });

  describe('declared keys', () => {
    it('the same key in two features is a StartupError naming the key', () => {
      const twice = [
        features[0]!,
        defineFeature({ name: 'tyres-again', calculators: [], topics: [], config: [defineConfig('tyres.wear', { other: 1 })] }),
      ];
      expect(failure(() => load(undefined, twice)).message).toContain('tyres.wear');
    });
    it('the same key twice in one feature is a StartupError too', () => {
      const twice = [defineFeature({ name: 'tyres', calculators: [], topics: [], config: [tyres, tyres] })];
      expect(failure(() => load(undefined, twice)).message).toContain('tyres.wear');
    });
    it('a feature may declare several keys', () => {
      const both = [defineFeature({ name: 'both', calculators: [], topics: [], config: [tyres, fuel] })];
      expect(load(undefined, both)).toEqual(DEFAULTS);
    });
  });
});

describe('sessionConfigPath', () => {
  it('is the recording path with .config.json appended', () => {
    expect(sessionConfigPath('/data/recordings/2026-10-28_13-05-09_000000000000004d.pwrec.gz')).toBe(
      '/data/recordings/2026-10-28_13-05-09_000000000000004d.pwrec.gz.config.json',
    );
  });
});

describe('recordingConfig', () => {
  const effective = load({ 'tyres.wear': { warnAt: 55 } });
  const recording = (sidecar?: string): string => {
    const path = join(tmp(), 'a.pwrec.gz');
    if (sidecar !== undefined) writeFileSync(sessionConfigPath(path), sidecar);
    return path;
  };

  it('without a sidecar it is the current effective config', () => {
    expect(recordingConfig(recording(), features, effective)).toEqual(effective);
  });
  it('with a sidecar it is the sidecar, not the current config', () => {
    const stored = { 'tyres.wear': { warnAt: 30, label: 'wear', strict: true }, 'fuel.margin': { laps: 2 } };
    expect(recordingConfig(recording(JSON.stringify(stored)), features, effective)).toEqual(stored);
  });
  it('a sidecar from before a field was declared keeps the default of the new field', () => {
    expect(recordingConfig(recording(JSON.stringify({ 'tyres.wear': { warnAt: 30 } })), features, effective)).toEqual({
      'tyres.wear': { warnAt: 30, label: 'wear', strict: false },
      'fuel.margin': { laps: 1.5 },
    });
  });
  describe('a sidecar is a historical record and is read leniently', () => {
    /** The warnings (level 40) `recordingConfig` logs while reading `sidecar`, one parsed JSON line each. */
    const warnings = (sidecar: unknown): { config: unknown; warned: string[] } => {
      const lines: string[] = [];
      const log = createLogger({ level: 'debug', destination: new Writable({ write(chunk, _enc, done) { lines.push(String(chunk)); done(); } }) });
      const config = recordingConfig(recording(JSON.stringify(sidecar)), features, effective, log);
      return { config, warned: lines.map((line) => JSON.parse(line) as { level: number }).filter((l) => l.level === 40).map((l) => JSON.stringify(l)) };
    };

    it('drops a key no feature declares any more, and warns naming it', () => {
      const { config, warned } = warnings({ 'tyres.wear': { warnAt: 30 }, 'brakes.wear': { x: 1 } });
      expect(config).toEqual({ 'tyres.wear': { warnAt: 30, label: 'wear', strict: false }, 'fuel.margin': { laps: 1.5 } });
      expect(warned).toHaveLength(1);
      expect(warned[0]).toContain('brakes.wear');
    });
    it('drops a field the key does not declare any more, and warns naming key and field', () => {
      const { config, warned } = warnings({ 'tyres.wear': { warnAt: 30, oldName: 5 } });
      expect(config).toEqual({ 'tyres.wear': { warnAt: 30, label: 'wear', strict: false }, 'fuel.margin': { laps: 1.5 } });
      expect(warned).toHaveLength(1);
      expect(warned[0]).toContain('tyres.wear');
      expect(warned[0]).toContain('oldName');
    });
    it('a value of another type than the default falls back to the default, and warns naming key and field', () => {
      const { config, warned } = warnings({ 'fuel.margin': { laps: 'two' }, 'tyres.wear': { warnAt: 30 } });
      expect(config).toEqual({ 'tyres.wear': { warnAt: 30, label: 'wear', strict: false }, 'fuel.margin': { laps: 1.5 } });
      expect(warned).toHaveLength(1);
      expect(warned[0]).toContain('fuel.margin');
      expect(warned[0]).toContain('laps');
    });
    it('the fallback is the feature default, not the current config.json override', () => {
      const { config } = warnings({ 'tyres.wear': { warnAt: 'high' } });
      expect(config).toMatchObject({ 'tyres.wear': { warnAt: 70 } });
    });
    it('warns once for each dropped or replaced entry, and not at all for a sidecar that fits', () => {
      expect(warnings({ a: {}, b: {}, 'tyres.wear': { x: 1, y: 2, warnAt: true } }).warned).toHaveLength(5);
      expect(warnings({ 'tyres.wear': { warnAt: 30 }, 'fuel.margin': { laps: 2 } }).warned).toEqual([]);
    });
    it('works without a logger', () => {
      expect(recordingConfig(recording(JSON.stringify({ 'brakes.wear': { x: 1 }, 'fuel.margin': { laps: 'two' } })), features, effective)).toEqual(DEFAULTS);
    });
    it('invalid JSON and an unreadable file are still a StartupError', () => {
      expect(() => recordingConfig(recording('{ nope'), features, effective)).toThrow(StartupError);
      const path = join(tmp(), 'a.pwrec.gz');
      mkdirSync(sessionConfigPath(path)); // a directory where the sidecar belongs
      expect(() => recordingConfig(path, features, effective)).toThrow(StartupError);
    });
  });
});
