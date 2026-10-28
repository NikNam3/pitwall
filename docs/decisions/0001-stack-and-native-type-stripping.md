# 0001: TypeScript run by Node type stripping

## Status

Accepted (2026-10-28)

## Context

Pitwall is a TypeScript monorepo whose bridge, scripts and tests should run without a build step. Node 22.18 and later strips types natively. Node refuses to strip types for files under `node_modules`, and pnpm workspace links point into `node_modules`. The TypeScript 7 native compiler has no JS compiler API, which typescript-eslint and dependency-cruiser need. `tsc -b` with `noEmit` project references fails with TS6310.

## Decision

- TypeScript files run directly on Node `>=22.18` through type stripping.
- Only erasable syntax is allowed (`erasableSyntaxOnly`): no `enum`, namespaces or parameter properties; use `as const` objects. Relative imports end in `.ts`.
- Each package exports `./src/index.ts`. Workspace links resolve to real paths, so Node never sees the files under `node_modules`.
- TypeScript is pinned to `~6.0`, not 7.
- Type checking uses `tsc -p tsconfig.json`, not `tsc -b`.
- pnpm 12 is installed into `~/.local` and pinned through `packageManager` in the root `package.json`.

## Consequences

- No build or transpile step; scripts, tests and the bridge start immediately.
- Authors give up enums, namespaces and parameter properties; lint and `tsc` enforce it.
- Moving to TypeScript 7 waits until typescript-eslint and dependency-cruiser support it.
- A single root `tsc -p` call checks the whole workspace; there are no project references.
