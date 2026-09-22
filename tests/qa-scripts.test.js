"use strict";

/*
 * Guards the QA scripts that run inside Illustrator and InDesign.
 *
 * These scripts run against whatever the user has open. One of them once closed
 * a document it had not created, losing unsaved work, because a change was
 * applied to four files out of five and nobody checked the fifth. This test is
 * that check.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const QA = path.join(ROOT, "scripts/qa");

function qaScripts() {
    const files = [];
    for (const dir of ["illustrator", "indesign"]) {
        const full = path.join(QA, dir);
        for (const name of fs.readdirSync(full)) {
            if (name.endsWith(".jsx")) {
                files.push({ name: path.join(dir, name), source: fs.readFileSync(path.join(full, name), "utf8") });
            }
        }
    }
    assert.ok(files.length >= 6, "expected the QA scripts to be found");
    return files;
}

test("no QA script can close a document it did not create", () => {
    for (const { name, source } of qaScripts()) {
        // The only permitted way to close anything is the guarded helper.
        assert.doesNotMatch(source, /while\s*\(\s*app\.documents\.length\s*\)/,
            `${name} closes documents in a loop over everything open`);
        assert.doesNotMatch(source, /app\.documents\[\s*0\s*\]\.close/,
            `${name} closes the frontmost document, which may be the user's`);
        assert.match(source, /function closeOurDocuments\s*\(/, `${name} is missing the guarded close helper`);
        assert.match(source, /if \(!isTheirs\(doc\)\)/, `${name} does not check whose document it is before closing`);
    }
});

test("every QA script records what it left behind", () => {
    for (const { name, source } of qaScripts()) {
        assert.match(source, /every document this test opened was closed/,
            `${name} should report whether it cleaned up after itself`);
    }
});

test("no QA script saves a document", () => {
    for (const { name, source } of qaScripts()) {
        // saveAs into a temp file is fine; save() would overwrite the user's file.
        assert.doesNotMatch(source, /\.save\s*\(\s*\)/, `${name} calls save() on a document`);
        assert.doesNotMatch(source, /SaveOptions\.(YES|SAVECHANGES)/, `${name} may save changes on close`);
    }
});

/*
 * The live panel QA is JavaScript rather than ExtendScript, and drives
 * Illustrator from outside instead of running inside it. It carries exactly the
 * same danger — it runs against whatever the user has open — so it is held to
 * the same rule, by its own shape rather than by the .jsx helpers above.
 */
test("the live panel QA closes only the document it created", () => {
    const source = fs.readFileSync(path.join(QA, "panel/live-panel-qa.js"), "utf8");

    assert.doesNotMatch(source, /while\s*\(\s*app\.documents\.length\s*\)/,
        "closes documents in a loop over everything open");
    assert.doesNotMatch(source, /app\.documents\[\s*0\s*\]\.close/,
        "closes the frontmost document, which may be the user's");
    assert.doesNotMatch(source, /SaveOptions\.(YES|SAVECHANGES)/, "may save changes on close");

    // It must record what was open before, and close by that recorded name.
    assert.match(source, /const before = openDocumentNames\(\)/, "does not record what was already open");
    assert.match(source, /before\.indexOf\(scratch\) === -1/, "does not check the document is its own before closing");
    assert.match(source, /app\.documents\[i\]\.name === ' \+ JSON\.stringify\(scratch\)/,
        "does not close by the name of the document it created");
    assert.match(source, /every document this test opened was closed/,
        "should report whether it cleaned up after itself");
});
