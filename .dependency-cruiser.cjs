// Layer rules, checked by `npm run check:architecture`. The reasoning is in
// .context/docs/architecture.md, "Layer rules".
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'A cycle makes load order matter and the layers meaningless.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'domain-imports-nothing',
      severity: 'error',
      comment: 'The domain is pure: no other layer, no npm package, no Node built-in.',
      from: { path: '^src/domain/' },
      to: { pathNot: '^src/domain/' },
    },
    {
      name: 'application-imports-only-domain',
      severity: 'error',
      comment: 'Use cases depend on the domain and on their own ports; Node built-ins (crypto) are allowed, packages and other layers are not.',
      from: { path: '^src/application/' },
      to: {
        pathNot: '^src/(application|domain)/',
        dependencyTypesNot: ['core'],
      },
    },
    {
      name: 'adapters-do-not-import-each-other',
      severity: 'error',
      comment: 'HTTP and persistence meet only in the composition root (src/server.ts).',
      from: { path: '^src/(http|infrastructure)/' },
      to: { path: '^src/(http|infrastructure)/', pathNot: '^src/$1/' },
    },
    {
      name: 'src-does-not-import-tests',
      severity: 'error',
      from: { path: '^src/' },
      to: { path: '^test/' },
    },
    {
      name: 'no-dev-dependencies-in-src',
      severity: 'error',
      comment: 'Production code must not need a devDependency at run time.',
      from: { path: '^src/' },
      to: { dependencyTypes: ['npm-dev'], dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-orphans',
      severity: 'error',
      comment: 'A module nothing imports is dead code (entry points excepted).',
      from: {
        orphan: true,
        pathNot: ['^src/server\\.ts$', '^src/infrastructure/migrate\\.ts$', '\\.d\\.ts$'],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.js', '.mjs'],
    },
  },
};
