"use strict";

/*
 * Keeps the launch documentation honest about itself.
 *
 * docs/LAUNCH-CHECKLIST.md claims that every [PLACEHOLDER] in the repository is
 * listed in its table, which is what makes filling them a single pass rather
 * than a hunt. That claim drifted the first time the business model changed:
 * the licence stopped being a paid EULA, five tokens disappeared from the files
 * and stayed in the table, and one new token appeared in no table at all. A
 * table that is only mostly right is worse than none, because you stop checking.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const CHECKLIST = "docs/LAUNCH-CHECKLIST.md";

function trackedDocs() {
    return execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
        .trim()
        .split("\n")
        .filter((f) => /\.(md|yml)$/.test(f) || f === "LICENSE" || f === "NOTICE");
}

function read(file) {
    return fs.readFileSync(path.join(ROOT, file), "utf8");
}

// A [PLACEHOLDER] is an all-caps token in brackets. Markdown links such as
// [LICENSE](LICENSE) look identical up to the bracket, so they are excluded by
// the "not followed by (" rule rather than by listing them.
function placeholdersIn(text) {
    return [...text.matchAll(/\[([A-Z_]{3,})\](?!\()/g)].map((m) => m[1]).filter((t) => t !== "PLACEHOLDER");
}

function tableTokens() {
    return [...read(CHECKLIST).matchAll(/^\| `\[([A-Z_]+)\]`(?: \/ `\[([A-Z_]+)\]`)? \|/gm)]
        .flatMap((m) => [m[1], m[2]])
        .filter(Boolean);
}

test("every placeholder in the repository is listed in the launch checklist's table", () => {
    const listed = new Set(tableTokens());
    const missing = new Map();
    for (const file of trackedDocs()) {
        if (file === CHECKLIST) {
            continue; // The table itself names every token by definition.
        }
        for (const token of placeholdersIn(read(file))) {
            if (!listed.has(token)) {
                missing.set(token, (missing.get(token) || []).concat(file));
            }
        }
    }
    assert.deepEqual(
        [...missing].map(([t, files]) => `${t} (in ${files.join(", ")})`),
        [],
        "these placeholders are in the repository but not in the table, so filling the table would not finish them"
    );
});

test("the launch checklist lists no placeholder that has been removed from the repository", () => {
    const present = new Set();
    for (const file of trackedDocs()) {
        if (file !== CHECKLIST) {
            placeholdersIn(read(file)).forEach((t) => present.add(t));
        }
    }
    const stale = tableTokens().filter((t) => !present.has(t));
    assert.deepEqual(stale, [], "these rows describe placeholders that no longer exist anywhere");
});

test("the table says which files each placeholder is in, and is right about it", () => {
    const rows = [...read(CHECKLIST).matchAll(/^\| `\[([A-Z_]+)\]`[^|]*\|[^|]*\|([^|]*)\|/gm)];
    assert.ok(rows.length >= 15, `expected a full table, found ${rows.length} rows`);
    for (const [, token, filesCell] of rows) {
        const claimed = [...filesCell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
        assert.ok(claimed.length > 0, `${token} names no file`);
        for (const file of claimed) {
            assert.ok(fs.existsSync(path.join(ROOT, file)), `${token} names ${file}, which does not exist`);
            assert.ok(
                placeholdersIn(read(file)).includes(token),
                `the table says [${token}] is in ${file}, but it is not`
            );
        }
    }
});

/*
 * The licence is the one document whose wording must not be improvised. MIT is
 * standard and widely litigated precisely because everyone's copy says the same
 * thing; an edited copy is a bespoke licence with none of that behind it.
 */
test("the MIT licence text is unmodified", () => {
    const license = read("LICENSE");
    assert.match(license, /^MIT License\n\nCopyright \(c\) \d{4} .+\n/);
    for (const clause of [
        "Permission is hereby granted, free of charge, to any person obtaining a copy",
        "The above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.",
        'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR'
    ]) {
        assert.ok(license.includes(clause), `the MIT text is altered or missing: ${clause.slice(0, 40)}…`);
    }
});

test("the documentation does not describe the extension as something people buy", () => {
    // The extension is free and open source. A single sentence left over from
    // the paid model in a file a user reads is a promise of the wrong product.
    const forUsers = ["README.md", "LICENSE", "TERMS.md", "docs/COMPATIBILITY.md", "docs/TROUBLESHOOTING.md", "docs/UPDATING.md"];
    for (const file of forUsers) {
        const text = read(file);
        for (const phrase of ["proprietary, paid", "paid, proprietary", "not open-source software", "the purchase price"]) {
            assert.ok(!text.includes(phrase), `${file} still describes a paid product: "${phrase}"`);
        }
    }
});
