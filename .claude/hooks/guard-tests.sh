#!/usr/bin/env bash
# PreToolUse: in the implement phase, test files are read-only.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

[ "${PITWALL_PHASE:-}" = "implement" ] && [ -n "$REL" ] || exit 0

case "$REL" in
  *.test.ts|test/*|*/test/*|test-support/*)
    block "$REL is a test file and PITWALL_PHASE=implement. Make the tests pass without changing them; if a test is wrong, say so in your report." ;;
esac
