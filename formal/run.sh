#!/usr/bin/env bash
# Model-check every TLA+ spec with TLC and check every Lean proof; regenerate the conformance vectors.
#   TLA2TOOLS=/path/to/tla2tools.jar LEAN=/path/to/lean formal/run.sh
set -euo pipefail
cd "$(dirname "$0")"
JAR="${TLA2TOOLS:-tla2tools.jar}"
LEAN="${LEAN:-lean}"
fail=0
for spec in tla/*.tla; do
  name=$(basename "$spec" .tla)
  printf '%-12s ' "$name"
  out=$(cd tla && java -XX:+UseParallelGC -cp "$JAR" tlc2.TLC -workers auto -deadlock "$name.tla" 2>&1 || true)
  if grep -q "Model checking completed. No error has been found." <<<"$out"; then
    echo "OK  $(grep -oE '[0-9]+ distinct states found' <<<"$out" | tail -1)"
  else
    echo "FAIL"; echo "$out" | grep -E "Error|violated" | head -5; fail=1
  fi
  rm -rf tla/*_TTrace_* tla/states 2>/dev/null || true
done
printf '%-12s ' "Lean"
if lean_out=$("$LEAN" lean/Hogwarts.lean 2>&1); then
  echo "OK  (all theorems checked)"
  grep '^VECTORS ' <<<"$lean_out" | sed 's/^VECTORS //' | python3 -c "import json,sys; json.dump(json.load(sys.stdin), open('vectors.json','w'), indent=0)"
else
  echo "FAIL"; echo "$lean_out" | head -20; fail=1
fi
exit $fail
