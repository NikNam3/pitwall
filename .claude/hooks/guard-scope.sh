#!/usr/bin/env bash
# PreToolUse: keep a worker inside PITWALL_WORKER_SCOPE (colon-separated repo-relative folders) plus the paths of
# PITWALL_WORKER_UNIT. Either one turns the guard on; the unit alone allows only the unit's paths.
HOOK_FAILS_CLOSED=1
LIB="$(dirname "${BASH_SOURCE[0]}")/lib.sh"
[ -r "$LIB" ] || exit 2 # fail closed if the shared helpers are missing
source "$LIB"

[ -n "${PITWALL_WORKER_SCOPE:-}${PITWALL_WORKER_UNIT:-}" ] && [ -n "$REL" ] || exit 0

# The unit name goes into paths and a regex below: kebab-case only (scripts/units.ts).
if [ -n "${PITWALL_WORKER_UNIT:-}" ] && ! [[ "$PITWALL_WORKER_UNIT" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  block "PITWALL_WORKER_UNIT \"$PITWALL_WORKER_UNIT\" is not a kebab-case unit name (a-z, 0-9, single hyphens)"
fi

case "$REL" in
  ..|../*) block "$TARGET is outside the repository" ;;
esac

# Files named after PITWALL_WORKER_UNIT (spec 3.3); granted on top of PITWALL_WORKER_SCOPE.
# The topic prefix is the camelCase form of the kebab-case unit name (scripts/units.ts: topicPrefix).
UNIT_TOPIC_FILE=""
UNIT_DIRS=()
if [ -n "${PITWALL_WORKER_UNIT:-}" ]; then
  unit="$PITWALL_WORKER_UNIT"
  prefix="$(node -e 'process.stdout.write(process.argv[1].replace(/-([a-z0-9])/g, (_m, c) => c.toUpperCase()))' "$unit")"
  UNIT_DIRS=(
    "apps/ui/src/widgets/$unit"
    "apps/bridge/src/features/$unit"
    "apps/bridge/test/features/$unit"
    "packages/analysis/src/$unit"
    "packages/analysis/test/$unit"
  )
  # A single file `<prefix>.<name>.ts` directly in the topics folder.
  UNIT_TOPIC_RE="^packages/contracts/src/topics/${prefix}\\.[^/]+\\.ts$"
  if [[ "$REL" =~ $UNIT_TOPIC_RE ]]; then UNIT_TOPIC_FILE=1; fi
fi

# A scope entry delegates a supervisor-owned path (C78) when it names that file or a folder lying inside an owned area
# (packages/domain/test); a broader entry (packages, packages/domain) delegates nothing.
delegated() {
  local e
  for e in "${entries[@]}"; do
    e="${e%/}"
    case "$e" in
      packages/domain/?*|packages/contracts/?*|packages/engine/src/state/?*)
        if [ "$REL" = "$e" ] || [[ "$REL" == "$e"/* ]]; then return 0; fi ;;
    esac
  done
  return 1
}

IFS=':' read -ra entries <<< "${PITWALL_WORKER_SCOPE:-}"

if [ -z "$UNIT_TOPIC_FILE" ]; then
  case "$REL" in
    package.json|*/package.json|pnpm-lock.yaml|pnpm-workspace.yaml)
      block "$REL is supervisor-owned. Do not edit it; list the change under 'Requested changes to supervisor-owned files' in your report." ;;
    packages/domain/*|packages/contracts/*|packages/engine/src/state/*)
      delegated || block "$REL is supervisor-owned. Do not edit it; list the change under 'Requested changes to supervisor-owned files' in your report." ;;
  esac
else
  exit 0
fi

for dir in "${UNIT_DIRS[@]}"; do
  if [[ "$REL" == "$dir"/* ]]; then exit 0; fi
done

for entry in "${entries[@]}"; do
  entry="${entry%/}"
  if [ "$REL" = "$entry" ] || [[ "$REL" == "$entry"/* ]]; then
    exit 0
  fi
done

block "$REL is outside your task scope (${PITWALL_WORKER_SCOPE:-unit ${PITWALL_WORKER_UNIT:-}}). Request the change in your report instead."
