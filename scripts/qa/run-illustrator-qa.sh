#!/bin/bash
#
# Runs GuideComposer's live QA in a real Illustrator and prints the results.
#
#   scripts/qa/run-illustrator-qa.sh [output directory]
#
# Illustrator must be running. Every test creates its own documents and closes
# them; documents you have open are not touched. Exits non-zero if any check
# fails, so a release can depend on it.
#
# macOS only: it drives Illustrator with AppleScript. On Windows, run each
# scripts/qa/illustrator/*.jsx from File > Scripts after setting the same two paths.
set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-$(mktemp -d "${TMPDIR:-/tmp}/mullion-qa.XXXXXX")}"
mkdir -p "$OUT"

if ! pgrep -f "MacOS/Adobe Illustrator" > /dev/null; then
    echo "Illustrator is not running. Start it, then run this again."
    exit 2
fi

echo "Running GuideComposer live QA"
echo "  extension: $ROOT"
echo "  results:   $OUT"
echo

for part in "$ROOT"/scripts/qa/illustrator/*.jsx; do
    name="$(basename "$part" .jsx)"
    rm -f "$OUT/$name.json"
    printf "%-14s " "$name"
    osascript - "$ROOT" "$OUT" "$part" > /dev/null 2>&1 <<'APPLESCRIPT'
on run argv
    set repoRoot to item 1 of argv
    set outDir to item 2 of argv
    set partFile to item 3 of argv
    set setup to "$.global.__mullionQA = { root: \"" & repoRoot & "\", out: \"" & outDir & "\" };"
    tell application id "com.adobe.illustrator"
        do javascript setup
        do javascript ("$.evalFile(\"" & partFile & "\")")
    end tell
end run
APPLESCRIPT
    # AppleScript gives up after two minutes; the script keeps running in Illustrator.
    for _ in $(seq 1 120); do
        [ -f "$OUT/$name.json" ] && break
        sleep 5
    done
    if [ -f "$OUT/$name.json" ]; then
        echo "done"
    else
        echo "NO RESULT (Illustrator may be showing a dialog)"
    fi
done

echo
node - "$OUT" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const dir = process.argv[2];
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
let total = 0;
let failed = 0;
for (const file of files) {
    const results = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")).results;
    const bad = results.filter((r) => !r.pass);
    total += results.length;
    failed += bad.length;
    console.log(`${file.padEnd(20)} ${String(results.length).padStart(3)} checks, ${bad.length} failed`);
    for (const r of bad) console.log(`   FAIL ${r.name} — ${r.detail}`);
}
console.log(`\n${total} checks, ${failed} failed`);
process.exit(failed || !total ? 1 : 0);
NODE
