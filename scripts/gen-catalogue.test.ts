import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCatalogue, checkCatalogue, findAnalysisFolders } from './gen-catalogue.ts';

// Contract assumed of gen-catalogue.ts:
//  - `buildCatalogue({ widgets, features, topics, analysis? })`: absolute directories (the widgets folder, the bridge
//    features folder, the contracts topics folder and, optionally, the analysis folder). Defaults are the repo's own.
//  - Fixture files are plain objects without imports (so tsc, eslint and depcruise may read them): a widget
//    register.ts exports `{ decl, component }`, a feature register.ts a feature (`calculators`, `topics` as binding
//    shapes `{ topic, from | fromHistory | fromInsights | fromJob | fromLive | fromSituation }`, `jobs`, `config`), a topic file the topic
//    definition (the topic name is the file name).
//  - Paths in the catalogue are what the directories above give; the tests only compare their tails.
const TREES = join(import.meta.dirname, 'fixtures', 'catalogue');
const tree = (name: string) => ({
  widgets: join(TREES, name, 'widgets'),
  features: join(TREES, name, 'features'),
  topics: join(TREES, name, 'topics'),
  analysis: join(TREES, name, 'analysis'),
});
const check = async (name: string) => checkCatalogue(await buildCatalogue(tree(name)));

describe('buildCatalogue on the clean tree', () => {
  it('has no errors and no warnings', async () => {
    expect(await check('clean')).toEqual({ errors: [], warnings: [] });
  });

  it('lists widgets with their topics, kinds and optional flags', async () => {
    const c = await buildCatalogue(tree('clean'));
    expect(c.widgets.map((w) => w.name)).toEqual(['feed-status', 'undercut-card']);
    const feed = c.widgets.find((w) => w.name === 'feed-status')!;
    expect(feed.folder).toMatch(/widgets\/feed-status$/);
    expect(feed.topics).toEqual([
      { topic: 'feed.status', kind: 'state', optional: false },
      { topic: 'session.info', kind: 'state', optional: true },
    ]);
    const card = c.widgets.find((w) => w.name === 'undercut-card')!;
    expect(card.topics).toContainEqual({ topic: 'laps', kind: 'folded', optional: false });
    expect(card.options).toEqual([]);
    expect(card.sizes).toEqual(['compact']);
  });

  it('lists topics with owner, mode, scope, rate, file, binding and readers', async () => {
    const c = await buildCatalogue(tree('clean'));
    const topic = (name: string) => c.topics.find((t) => t.name === name)!;
    expect(topic('feed.status')).toMatchObject({
      owner: 'core', mode: 'state', scope: 'feed', maxHz: 2,
      binding: { kind: 'calculator', source: 'feed.status', feature: 'feed-status' },
      readers: ['feed-status'],
    });
    expect(topic('feed.status').file).toMatch(/topics\/feed\.status\.ts$/);
    expect(topic('laps')).toMatchObject({ mode: 'append', binding: { kind: 'history', source: 'laps', feature: 'history' } });
    expect(topic('rejoin.projection')).toMatchObject({ owner: 'rejoin', readers: ['undercut-card'] });
    expect(topic('undercutCard.rows').readers).toEqual(['undercut-card']);
  });

  it('lists features: folder, analysis folder, private flag, calculators, config', async () => {
    const c = await buildCatalogue(tree('clean'));
    const feature = (name: string) => c.features.find((f) => f.name === name)!;
    expect(feature('rejoin')).toMatchObject({ private: false, calculators: [
        { id: 'rejoin.projection', reads: ['feed'], cadence: 'frame' },
        // Engine shapes become strings: `{ hz: n }` -> `<n> Hz`, `{ calculator: id }` -> `calculator:<id>`.
        { id: 'rejoin.rate', reads: ['calculator:rejoin.projection', 'feed'], cadence: '10 Hz' },
      ], jobs: [], config: ['rejoin'] });
    expect(feature('rejoin').folder).toMatch(/features\/rejoin$/);
    expect(feature('rejoin').analysisFolder).toMatch(/analysis\/rejoin$/);
    expect(feature('undercut-card').private).toBe(true);
    expect(feature('undercut-card').analysisFolder).toBeUndefined();
    expect(feature('feed-status').private).toBe(true);
    expect(feature('session-info').private).toBe(false);
  });
});

describe('buildCatalogue labels every binding kind (Task 23 ruling 4)', () => {
  it('a bindSituation topic is a situation of its machine, a bindLive topic live, beside history and insights', async () => {
    const c = await buildCatalogue(tree('binding-kinds'));
    const binding = (name: string) => c.topics.find((t) => t.name === name)?.binding;
    expect(binding('situation.clock')).toEqual({ kind: 'situation', source: 'clock', feature: 'situations' });
    expect(binding('car.detail')).toEqual({ kind: 'live', source: 'car.detail', feature: 'car-detail' });
    expect(binding('laps')).toEqual({ kind: 'history', source: 'laps', feature: 'history' });
    expect(binding('insights')).toEqual({ kind: 'insights', source: 'insights', feature: 'insights' });
  });
});

describe('checkCatalogue: errors name the file', () => {
  it('an owner that is neither core nor a unit', async () => {
    const { errors } = await check('owner-unknown');
    expect(errors).toContainEqual(expect.stringMatching(/topics\/ghost\.rows\.ts.*owner "ghost"/));
  });

  it('an owner with only an analysis folder is a unit: contracts come before the feature', async () => {
    const dirs = tree('analysis-owner');
    const { errors } = checkCatalogue(await buildCatalogue(dirs), findAnalysisFolders(dirs.analysis));
    expect(errors).toEqual([]);
    expect(findAnalysisFolders(dirs.analysis)).toEqual(['pace-model']);
    expect(findAnalysisFolders(tree('owner-unknown').analysis)).toEqual([]);
  });

  it('a topic name not prefixed by its owner', async () => {
    const { errors } = await check('prefix');
    expect(errors).toContainEqual(expect.stringMatching(/topics\/wrong\.rows\.ts.*"rejoin"/));
  });

  it('a widget reading another display\'s private topic', async () => {
    const { errors } = await check('foreign-private');
    expect(errors).toContainEqual(expect.stringMatching(/widgets\/beta\/register\.ts.*alpha\.rows/));
    expect(errors.filter((e) => /widgets\/alpha\//.test(e))).toEqual([]);
  });

  it('a private topic its own widget does not read', async () => {
    const { errors } = await check('unread-private');
    expect(errors).toContainEqual(expect.stringMatching(/topics\/alpha\.rows\.ts.*"alpha"/));
  });

  it('a widget reading a topic that nothing binds', async () => {
    const { errors } = await check('unbound');
    expect(errors).toContainEqual(expect.stringMatching(/widgets\/feed-status\/register\.ts.*feed\.status/));
  });

  it('topic() on an append topic', async () => {
    const { errors } = await check('topic-on-append');
    expect(errors).toContainEqual(expect.stringMatching(/widgets\/laps-view\/register\.ts.*laps.*append/));
  });

  it('folded() on a state topic', async () => {
    const { errors } = await check('folded-on-state');
    expect(errors).toContainEqual(expect.stringMatching(/widgets\/feed-status\/register\.ts.*feed\.status.*state/));
  });

  it('a widget name that differs from its folder', async () => {
    const { errors } = await check('name-folder');
    expect(errors).toContainEqual(expect.stringMatching(/widgets\/foo-bar\/register\.ts.*"foobar".*"foo-bar"/));
  });
});

// Simulators (C50, C63; SP4.3a Task 5): an analysis folder whose `index.ts` exports `SIMULATOR`, a marker
// `{ kind: 'simulator', name }` (`defineSimulator`), is a simulator. The catalogue lists them as `simulators`
// (`{ name, folder }`); `checkCatalogue` takes the analysis folders as today. `Catalogue.simulators` is a requested
// supervisor change to the contracts package, so these rows read it through a local type.
type Simulator = { name: string; folder: string };
const simulatorsOf = (c: object): Simulator[] | undefined => (c as { simulators?: Simulator[] }).simulators;
const checkWithUnits = async (name: string) => {
  const dirs = tree(name);
  return checkCatalogue(await buildCatalogue(dirs), findAnalysisFolders(dirs.analysis));
};

describe('buildCatalogue lists simulators by their SIMULATOR marker', () => {
  it('lists each simulator folder with its name and folder, and nothing else', async () => {
    const simulators = simulatorsOf(await buildCatalogue(tree('simulators')));
    expect(simulators?.map((s) => s.name)).toEqual(['lap-model', 'race-forecast']);
    expect(simulators?.find((s) => s.name === 'lap-model')?.folder).toMatch(/analysis\/lap-model$/);
    expect(simulators?.find((s) => s.name === 'race-forecast')?.folder).toMatch(/analysis\/race-forecast$/);
  });

  it('a clean simulator tree has no errors', async () => {
    expect((await checkWithUnits('simulators')).errors).toEqual([]);
  });

  it('a tree without simulators lists none', async () => {
    expect(simulatorsOf(await buildCatalogue(tree('clean')))).toEqual([]);
  });

  it('the repo lists its simulators from their markers', async () => {
    // The repo's analysis folder with empty widget, feature and topic trees: only the markers are read.
    const dirs = { ...tree('simulator-name'), analysis: join(import.meta.dirname, '..', 'packages', 'analysis', 'src') };
    const names = simulatorsOf(await buildCatalogue(dirs))?.map((s) => s.name) ?? [];
    expect(names).toContain('lap-model');
    expect(names).toContain('race-forecast');
    expect(names).not.toContain('degradation');
  });
});

describe('checkCatalogue: a simulator has no feature, no reads, no topic (C50)', () => {
  it('a simulator with a feature folder fails, naming the feature file', async () => {
    const { errors } = await checkWithUnits('simulator-feature');
    expect(errors).toContainEqual(expect.stringMatching(/features\/lap-model\/register\.ts.*simulator/));
  });

  it('a topic owned by a simulator fails, naming the topic file', async () => {
    const { errors } = await checkWithUnits('simulator-topic');
    expect(errors).toContainEqual(expect.stringMatching(/topics\/raceForecast\.rows\.ts.*simulator/));
  });

  it('a simulator declaring reads fails, naming its index file', async () => {
    const { errors } = await checkWithUnits('simulator-reads');
    expect(errors).toContainEqual(expect.stringMatching(/analysis\/lap-model\/index\.ts.*reads/));
  });

  it('a marker whose name differs from its folder fails, naming its index file', async () => {
    const { errors } = await checkWithUnits('simulator-name');
    expect(errors).toContainEqual(expect.stringMatching(/analysis\/lap-model\/index\.ts.*"race-model".*"lap-model"/));
  });
});

describe('checkCatalogue: warnings', () => {
  it('an analysis topic with no reader is a warning, not an error', async () => {
    const { errors, warnings } = await check('unread-analysis');
    expect(errors).toEqual([]);
    expect(warnings).toContainEqual(expect.stringMatching(/topics\/rejoin\.projection\.ts.*no reader/));
  });
});
