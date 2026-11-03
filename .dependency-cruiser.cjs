/** Forbids `from` to depend on any workspace folder other than itself and the `allowed` packages. */
function layer(name, from, allowed) {
  const permitted = [from, ...allowed.map((pkg) => `packages/${pkg}`)].join('|');
  return {
    name,
    severity: 'error',
    from: { path: `^${from}/` },
    to: { path: '^(packages|apps)/', pathNot: `^(${permitted})/` },
  };
}

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    layer('protocol-is-leaf', 'packages/protocol', []),
    layer('domain-is-leaf', 'packages/domain', []),
    layer('contracts-only-domain', 'packages/contracts', ['domain']),
    layer('engine-only-protocol-domain', 'packages/engine', ['protocol', 'domain']),
    layer('analysis-only-engine-domain', 'packages/analysis', ['engine', 'domain']),
    {
      name: 'ui-only-contracts-domain',
      comment: 'The UI imports contracts and domain only; its tests may also build engine state (car-sources.test.ts).',
      severity: 'error',
      from: { path: '^apps/ui/', pathNot: '^apps/ui/test/' },
      to: { path: '^(packages|apps)/', pathNot: '^(apps/ui|packages/contracts|packages/domain)/' },
    },
    {
      name: 'ui-tests-only-contracts-domain-engine-state',
      severity: 'error',
      from: { path: '^apps/ui/test/' },
      to: { path: '^(packages|apps)/', pathNot: '^(apps/ui|packages/contracts|packages/domain|packages/engine/src/(state|step/state-update/initial\\.ts))/?' },
    },
    {
      name: 'ui-widgets-isolated',
      comment: 'A widget imports only kit, theme, emphasis (and contracts/domain) and its own folder.',
      severity: 'error',
      from: { path: '^apps/ui/src/widgets/([^/]+)/' },
      to: { path: '^apps/ui/src/', pathNot: '^apps/ui/src/(kit|theme|emphasis|widgets/$1)/' },
    },
    {
      name: 'ui-kit-no-shell',
      comment: 'The kit imports only theme, emphasis (and contracts/domain): never shell, connection, widgets or gallery.',
      severity: 'error',
      from: { path: '^apps/ui/src/kit/' },
      to: { path: '^apps/ui/src/', pathNot: '^apps/ui/src/(kit|theme|emphasis)/' },
    },
    {
      name: 'ui-kit-grid-not-values',
      comment: 'kit/values builds on kit/grid (TextCell fits its cell, the pair builds cell parts); the grid never imports kit/values, so the two depend one way (review 6, R6-4).',
      severity: 'error',
      from: { path: '^apps/ui/src/kit/grid/' },
      to: { path: '^apps/ui/src/kit/values/' },
    },
    {
      name: 'ui-connection-only-contracts-domain',
      severity: 'error',
      from: { path: '^apps/ui/src/connection/' },
      to: { path: '^apps/ui/src/', pathNot: '^apps/ui/src/connection/' },
    },
    {
      name: 'ui-widget-index-only-shell',
      comment: 'Only the shell and the gallery import the generated widget index (one discovery mechanism).',
      severity: 'error',
      from: { pathNot: '^apps/ui/src/(shell|gallery)/' },
      to: { path: '^apps/ui/src/widgets/index\\.generated\\.ts$' },
    },
    {
      name: 'ui-gallery-files-only-gallery',
      comment: 'Only the gallery imports the widgets\' gallery.ts files.',
      severity: 'error',
      from: { pathNot: '^apps/ui/(src|test)/gallery/|/gallery\\.ts$' },
      to: { path: '^apps/ui/src/widgets/[^/]+/gallery\\.ts$' },
    },
    {
      name: 'ui-dockview-only-docking',
      comment: 'Only shell/docking imports dockview-core.',
      severity: 'error',
      from: { path: '^apps/ui/', pathNot: '^apps/ui/src/shell/docking/' },
      to: { path: 'dockview-core' },
    },
    {
      name: 'desktop-imports-nothing',
      comment: 'The Electron app imports nothing from the workspace.',
      severity: 'error',
      from: { path: '^apps/desktop/' },
      to: { path: '^(packages|apps)/|^@pitwall/', pathNot: '^apps/desktop/' },
    },
    {
      name: 'no-cross-package-relative-import',
      comment: "Production code imports other packages by name. Tests may reach other packages' test builders.",
      severity: 'error',
      from: { path: '^(packages|apps)/([^/]+)/src/' },
      to: { dependencyTypes: ['local'], path: '^(packages|apps)/', pathNot: '^$1/$2/' },
    },
    {
      name: 'log-only-writers-and-projection',
      comment:
        'C28: readers see the projection, never the log. Only the projection, the runner, step (it hands the recorders their LogWriter), the storage writer and the log tests import log/log.ts.',
      severity: 'error',
      from: {
        pathNot: '^packages/engine/src/(log/projection\\.ts|runner/|step/step\\.ts$)|^apps/bridge/src/storage/|^packages/engine/test/log/',
      },
      to: { path: '^packages/engine/src/log/log\\.ts$' },
    },
    {
      name: 'protocol-only-in-the-adapter',
      comment:
        'C6: in the engine, protocol types are imported only by frame assembly (frame/), step 0 and step 1 (step/state-update/, signals/) and the machine (situations/); the situation tracker (history/situations/) holds step 0 and the machine\'s slot until Tasks 7 and 9 move them.',
      severity: 'error',
      from: { path: '^packages/engine/src/', pathNot: '^packages/engine/src/(frame|step/state-update|signals|situations|history/situations)/' },
      to: { path: '^packages/protocol/' },
    },
    {
      name: 'readers-never-reach-the-game',
      comment:
        'C6: the recorders, the log and projection, the scheduler and calculator types, the analyses, the bridge\'s storage, hub, features and publishing, and the UI see only domain and contracts types: they never reach a protocol type or the frame, directly or through another module (readers import the engine as `@pitwall/engine/readers`). A packet value a recorder needs becomes a value in step 1 first. Tests stay out.',
      severity: 'error',
      from: {
        path: '^packages/engine/src/(recorders|log|calc)/|^packages/engine/src/readers\\.ts$|^packages/analysis/src/|^apps/bridge/src/(storage|hub|features)/|^apps/bridge/src/pipeline/(topic-publisher|session-storage)\\.ts$|^apps/ui/src/',
      },
      to: { path: '^packages/protocol/|^packages/engine/src/frame/frame\\.ts$', reachable: true },
    },
    {
      name: 'signals-only-for-the-machine',
      comment:
        'C13: the signals module is read only by the machine (situations/); step 1 (step/state-update/) writes it, step.ts hands it over and the engine state holds it. The signals tests read it too.',
      severity: 'error',
      from: {
        pathNot: '^packages/engine/src/(signals|situations|step/state-update)/|^packages/engine/src/(step/step|state/engine-state)\\.ts$|^packages/engine/test/',
      },
      to: { path: '^packages/engine/src/signals/' },
    },
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    {
      name: 'not-to-unresolvable',
      comment: "Also catches a workspace import missing from package.json, through pnpm's strict linking.",
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-undeclared-dependency',
      severity: 'error',
      from: { path: '^(packages|apps)/[^/]+/src/', pathNot: '\\.test\\.ts$' },
      to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(\\.stryker-tmp|reports)/|^apps/[^/]+/dist(-e2e)?/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'default'],
      extensions: ['.ts', '.js'],
    },
  },
};
