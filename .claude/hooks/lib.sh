# Shared helpers for the pitwall Claude Code hooks. Sourced, not executed.
# Reads the hook payload (JSON on stdin) once and derives PROJECT_DIR, TARGET and REL.
set -Eeuo pipefail

# A PreToolUse guard sets HOOK_FAILS_CLOSED=1 before sourcing this file: any unexpected failure
# (malformed payload, node missing) then blocks the tool call instead of letting it through,
# because exit codes other than 2 are non-blocking in Claude Code.
fail_closed() {
  if [ -n "${HOOK_FAILS_CLOSED:-}" ]; then
    trap - ERR
    echo "pitwall hook: could not process the hook payload; blocking the call" >&2
    exit 2
  fi
}
trap fail_closed ERR

PAYLOAD="$(cat)"

# payload_get <dotted.path>: print a string field of the payload, or nothing.
payload_get() {
  printf '%s' "$PAYLOAD" | node -e '
    let value = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
    for (const key of process.argv[1].split(".")) value = value?.[key];
    if (typeof value === "string") process.stdout.write(value);
  ' "$1"
}

# block <message>: refuse the tool call (PreToolUse exit 2); stderr is shown to Claude.
block() {
  echo "pitwall hook: $1" >&2
  exit 2
}

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(payload_get cwd)}"
TARGET="$(payload_get tool_input.file_path)"
[ -n "$TARGET" ] || TARGET="$(payload_get tool_input.notebook_path)"

# REL: the target relative to the repository root; empty when the call has no target.
REL=""
if [ -n "$TARGET" ]; then
  REL="$(node -e '
    const path = require("node:path");
    process.stdout.write(path.relative(process.argv[1], path.resolve(process.argv[1], process.argv[2])));
  ' "$PROJECT_DIR" "$TARGET")"
fi
