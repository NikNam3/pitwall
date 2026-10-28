#!/usr/bin/env bash
# PreToolUse: keep a worker inside PITWALL_WORKER_SCOPE (colon-separated repo-relative folders).
HOOK_FAILS_CLOSED=1
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

[ -n "${PITWALL_WORKER_SCOPE:-}" ] && [ -n "$REL" ] || exit 0

case "$REL" in
  ..|../*) block "$TARGET is outside the repository" ;;
esac

case "$REL" in
  package.json|*/package.json|pnpm-lock.yaml|pnpm-workspace.yaml|packages/domain/*|packages/contracts/*|packages/engine/src/state/*)
    block "$REL is supervisor-owned. Do not edit it; list the change under 'Requested changes to supervisor-owned files' in your report." ;;
esac

IFS=':' read -ra entries <<< "$PITWALL_WORKER_SCOPE"
for entry in "${entries[@]}"; do
  entry="${entry%/}"
  if [ "$REL" = "$entry" ] || [[ "$REL" == "$entry"/* ]]; then
    exit 0
  fi
done

block "$REL is outside your task scope ($PITWALL_WORKER_SCOPE). Request the change in your report instead."
