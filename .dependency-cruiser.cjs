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
    layer('strategy-only-engine-domain', 'packages/strategy', ['engine', 'domain']),
    layer('ui-only-contracts-domain', 'apps/ui', ['contracts', 'domain']),
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
      name: 'ui-connection-only-contracts-domain',
      severity: 'error',
      from: { path: '^apps/ui/src/connection/' },
      to: { path: '^apps/ui/src/', pathNot: '^apps/ui/src/connection/' },
    },
    {
      name: 'ui-widget-index-only-shell',
      comment: 'Only the shell imports the generated widget index.',
      severity: 'error',
      from: { pathNot: '^apps/ui/src/shell/' },
      to: { path: '^apps/ui/src/widgets/index\\.generated\\.ts$' },
    },
    {
      name: 'ui-gallery-files-only-gallery',
      comment: 'Only the gallery imports the widgets\' gallery.ts files.',
      severity: 'error',
      from: { pathNot: '^apps/ui/src/gallery/|/gallery\\.ts$' },
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
    exclude: { path: '(^|/)(\\.stryker-tmp|reports)/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'default'],
      extensions: ['.ts', '.js'],
    },
  },
};
