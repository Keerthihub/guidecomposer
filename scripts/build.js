#!/usr/bin/env node
/*
 * Builds the production extension folder that ZXPSignCmd signs.
 *
 *   node scripts/build.js            -> dist/mullion/
 *   node scripts/build.js --out DIR  -> DIR/
 *
 * Copies only the shipped folders, then re-runs the release checks against
 * the output so a package can never contain .debug, tests, or signing files.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const checks = require("./release-checks.js");

function build(outDir) {
    const problems = [...checks.checkVersions(checks.ROOT), ...checks.checkManifest(checks.ROOT)];
    if (problems.length) {
        return { ok: false, problems };
    }

    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    for (const entry of checks.PRODUCTION_ENTRIES) {
        fs.cpSync(path.join(checks.ROOT, entry), path.join(outDir, entry), {
            recursive: true,
            filter: (src) => path.basename(src) !== ".DS_Store"
        });
    }

    const outputProblems = [...checks.checkManifest(outDir), ...checks.checkPackageContents(outDir)];
    return { ok: outputProblems.length === 0, problems: outputProblems, files: checks.listFiles(outDir) };
}

if (require.main === module) {
    const outIndex = process.argv.indexOf("--out");
    const outDir = outIndex !== -1 ? path.resolve(process.argv[outIndex + 1]) : path.join(checks.ROOT, "dist", "mullion");
    const result = build(outDir);
    if (!result.ok) {
        console.error("Build failed:");
        result.problems.forEach((p) => console.error("  " + p));
        process.exit(1);
    }
    const version = JSON.parse(fs.readFileSync(path.join(checks.ROOT, "package.json"), "utf8")).version;
    console.log(`Built ${path.relative(process.cwd(), outDir) || outDir} (${result.files.length} files, version ${version})`);
    console.log(`Next: sign it with ZXPSignCmd. See scripts/package.md.`);
}

module.exports = { build };
