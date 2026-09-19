"use strict";

/*
 * Runs scripts/qa/indesign/qa.jsx — the script you run in a real InDesign —
 * against the strict fake InDesign DOM.
 *
 * This cannot prove how InDesign behaves; only InDesign can do that. What it
 * proves is that the script itself is sound: it executes end to end, every call
 * it makes exists, and every check it makes passes against the behaviour the
 * adapter is written to. So when it finally runs in InDesign, a failure means
 * InDesign differs from the model — which is exactly the news worth having.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createInDesignHost } = require("./helpers/fake-indesign.js");

const ROOT = path.resolve(__dirname, "..");

function runQaScript() {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "mullion-indesign-qa-"));
    const host = createInDesignHost();
    host.openDocument({});
    host.sandbox.__mullionQA = { root: ROOT, out };
    host.sandbox.$.evalFile(path.join(ROOT, "scripts/qa/indesign/qa.jsx"));
    const file = path.join(out, "indesign-qa.json");
    const results = JSON.parse(fs.readFileSync(file, "utf8")).results;
    fs.rmSync(out, { recursive: true, force: true });
    return results;
}

test("the InDesign QA script runs end to end and every check passes against the model", () => {
    const results = runQaScript();
    const failed = results.filter((r) => !r.pass);
    assert.equal(failed.length, 0, failed.map((r) => `${r.name} — ${r.detail}`).join("\n"));
    assert.ok(results.length >= 30, `expected a thorough script, got ${results.length} checks`);
});

test("the QA script covers the places InDesign differs from Illustrator", () => {
    const names = runQaScript().map((r) => r.name).join(" | ");
    for (const subject of [
        "cursor in text",          // InDesign raises on properties an object lacks
        "dashed",                  // stroke styles are named in the interface language
        "guides",                  // guides cannot be grouped, so each is its own grid
        "inserting a page",        // page numbers shift under existing grids
        "facing-pages",            // left and right mean inside and outside
        "baseline grid",           // measured from the page or from the margin
        "master page",             // master items are not page grids
        "grouped with the user's", // ownership at depth
        "edited grid",             // the user's changes are not ours to delete
        "stranded preview",        // recovery after a crash
        "failed draw",             // rollback
        "200-page"                 // the scan cost that only shows up at length
    ]) {
        assert.ok(names.includes(subject), `the InDesign QA script should cover: ${subject}`);
    }
});

test("every check the script reports is either a pass or a failure with a reason", () => {
    for (const result of runQaScript()) {
        assert.equal(typeof result.name, "string");
        assert.equal(typeof result.pass, "boolean");
        assert.ok(result.detail.length > 0, `${result.name} reports nothing`);
    }
});
