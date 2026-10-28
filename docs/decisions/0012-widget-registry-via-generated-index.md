# 0012: Widget registry via a generated index

## Status

Accepted (2026-10-28). Extends [0005](0005-feature-registry-via-generated-index.md).

## Context

Widgets must register without editing a shared file, so parallel worktrees do not conflict, and the registry must stay visible to `tsc` and dependency-cruiser. Node scripts (the topic and catalogue checks, Task 20) must read every widget's data declaration without loading Svelte or the DOM.

## Decision

- A widget is a folder `apps/ui/src/widgets/<name>/` with two small files and a component:
  - `widget.ts` exports `widget = declareWidget({ name, title, data, options, sizes })`. It imports only `kit/define-widget.ts` and `kit/options.ts`, which import nothing from Svelte or the DOM.
  - `register.ts` default-exports `registerWidget(widget, () => import('./<Name>.svelte'))`.
  - `<Name>.svelte` imports its prop types from `widget.ts`.
- `scripts/gen-widgets.ts` generates `apps/ui/src/widgets/index.generated.ts` (`WIDGETS: RegisteredWidget[]`), gitignored and part of `pnpm gen`. Same rules as `gen-features.ts`: sorted, and a folder with `.ts` files but no `register.ts` throws.
- Why the split: if the declaration lived in `register.ts`, the component would import its types from a file that imports the component (an import cycle). With `widget.ts` the dependency runs one way, and Node can import `widget.ts` without touching a `.svelte` file.
- `declareWidget` runs at import time and throws on a non-kebab-case name, no sizes, or a `minCols` or `minRows` below 1.
- Rejected: a hand-edited list (merge conflicts) and a runtime glob (invisible to `tsc` and dependency-cruiser).

## Consequences

- Adding a widget means adding a folder; no shared file changes.
- A mistake in a declaration fails at import time: in the tests, and in the Node catalogue script of a later task, not in the running app.
- Props of the component are derived from the declaration, so a wrong topic, params or option is a compile error.
