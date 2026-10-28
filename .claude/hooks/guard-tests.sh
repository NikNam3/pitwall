#!/usr/bin/env bash
# PreToolUse: in the implement phase, test files are read-only.
HOOK_FAILS_CLOSED=1
LIB="$(dirname "${BASH_SOURCE[0]}")/lib.sh"
[ -r "$LIB" ] || exit 2 # fail closed if the shared helpers are missing
source "$LIB"

[ "${PITWALL_PHASE:-}" = "implement" ] && [ -n "$REL" ] || exit 0

case "$REL" in
  *.test.ts|test/*|*/test/*|test-support/*|apps/ui/src/widgets/*/gallery.ts)
    block "$REL is a test file and PITWALL_PHASE=implement. Make the tests pass without changing them; if a test is wrong, say so in your report." ;;
esac
