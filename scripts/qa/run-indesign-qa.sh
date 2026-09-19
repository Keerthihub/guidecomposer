#!/bin/bash
#
# Runs Mullion's live QA in a real InDesign and prints the results.
#
#   scripts/qa/run-indesign-qa.sh [output directory]
#
# InDesign must be running with no unsaved work you care about: the script
# creates its own documents and closes them, but a failure mid-test can leave
# one open. Exits non-zero if any check fails.
#
# macOS only: it drives InDesign with AppleScript. On Windows, run
# scripts/qa/indesign/qa.jsx from InDesign's Scripts panel after setting
# $.global.__mullionQA = { root: "...", out: "..." } in a line above it.
set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-$(mktemp -d "${TMPDIR:-/tmp}/mullion-indesign-qa.XXXXXX")}"
mkdir -p "$OUT"

if ! pgrep -f "Adobe InDesign" > /dev/null; then
    echo "InDesign is not running. Start it, then run this again."
    exit 2
fi

echo "Running Mullion live QA in InDesign"
echo "  extension: $ROOT"
echo "  results:   $OUT"
echo

# The QA script reads its paths from a global, so they never pass through
# AppleScript string quoting.
BOOTSTRAP="$OUT/bootstrap.jsx"
cat > "$BOOTSTRAP" <<JSX
\$.global.__mullionQA = { root: "$ROOT", out: "$OUT" };
\$.evalFile(new File("$ROOT/scripts/qa/indesign/qa.jsx"));
JSX

rm -f "$OUT/indesign-qa.json"
osascript - "$BOOTSTRAP" > /dev/null 2>&1 <<'APPLESCRIPT'
on run argv
    set bootstrap to item 1 of argv
    tell application id "com.adobe.InDesign"
        do script (POSIX file bootstrap) language javascript
    end tell
end run
APPLESCRIPT

# AppleScript gives up after two minutes; the script keeps running in InDesign.
for _ in $(seq 1 180); do
    [ -f "$OUT/indesign-qa.json" ] && break
    sleep 5
done

if [ ! -f "$OUT/indesign-qa.json" ]; then
    echo "No results. InDesign may be showing a dialog, or the script failed before it could write."
    echo "Run scripts/qa/indesign/qa.jsx from InDesign's Scripts panel to see the error."
    exit 1
fi

node - "$OUT/indesign-qa.json" <<'NODE'
const fs = require("node:fs");
const results = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).results;
const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"} ${r.name} — ${r.detail}`);
console.log(`\n${results.length} checks, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
NODE
