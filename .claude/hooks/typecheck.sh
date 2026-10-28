#!/usr/bin/env bash
# PostToolUse: typecheck the package that owns the edited .ts file. Exit 2 reports errors to Claude.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

case "$REL" in
  ..|../*) exit 0 ;;
  *.ts) ;;
  *) exit 0 ;;
esac

# Walk up from the file to the nearest tsconfig.json below the repository root.
# Root-level files are covered by `pnpm typecheck`.
root="$(node -e 'process.stdout.write(require("node:path").resolve(process.argv[1]))' "$PROJECT_DIR")"
dir="$root/$REL"
dir="$(dirname "$dir")"
while [ "$dir" != "$root" ] && [ ! -f "$dir/tsconfig.json" ]; do
  dir="$(dirname "$dir")"
done
[ "$dir" != "$root" ] || exit 0

tsc="$(dirname "${BASH_SOURCE[0]}")/../../node_modules/.bin/tsc"
if ! output="$("$tsc" -p "$dir/tsconfig.json" --pretty false 2>&1)"; then
  echo "pitwall hook: typecheck failed in ${dir#"$root"/}" >&2
  echo "$output" >&2
  exit 2
fi
