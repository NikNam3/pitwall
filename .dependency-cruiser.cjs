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
