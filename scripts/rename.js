#!/usr/bin/env node
/*
 * Renames the product everywhere users can see it.
 *
 *   npm run rename -- --name "Gridwright" --id com.yourstudio.gridwright
 *   npm run rename -- --name "Gridwright" --id com.yourstudio.gridwright --dry-run
 *
 * Changes the extension id (manifest, .debug, install scripts, ownership tag),
 * the product name (panel text, menu, layer name, docs), and package names.
 * Internal code identifiers such as Mullion.api, MullionCore, and storage keys
 * are left alone: users never see them, and renaming them adds risk for nothing.
 *
 * Run it before the first public release. After release, changing the id means
 * Clear no longer recognizes grids made by earlier versions.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const OLD_ID = "com.mullion.panel";
const OLD_NAME = "Mullion";
const OLD_SLUG = "mullion";

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "vendor"]);
const TEXT_EXTENSIONS = new Set([".js", ".jsx", ".json", ".html", ".css", ".md", ".xml", ".sh", ".ps1", ".yml", ""]);
const SKIP_FILES = new Set(["scripts/rename.js", "tests/rename.test.js"]);

function validate(options) {
    const problems = [];
    if (!options.name || !/^[A-Za-z][A-Za-z0-9 &'-]{1,29}$/.test(options.name)) {
        problems.push("--name must be 2 to 30 characters: letters, numbers, spaces, & ' -, starting with a letter.");
    }
    if (!options.id || !/^[a-z][a-z0-9-]*(\.[a-z0-9-]+){1,5}$/.test(options.id)) {
        problems.push("--id must be lowercase reverse-DNS, such as com.yourstudio.gridwright.");
    }
    if (options.id === OLD_ID) {
        problems.push("--id is still the placeholder id.");
    }
    return problems;
}

function slugify(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/*
 * Returns the renamed text. The product name is replaced only where it is a
 * word on its own: not in identifiers (MullionCore), member access (Mullion.api,
 * $.global.Mullion), or `typeof Mullion` checks.
 */
function renameText(text, options) {
    const slug = options.slug || slugify(options.name);
    return text
        .replace(/<!-- placeholder-name-note -->[\s\S]*?<!-- \/placeholder-name-note -->\n?/g, "")
        .split(OLD_ID).join(options.id)
        .replace(/(?<![\w.$])(?<!typeof )Mullion(?![\w(])(?!\.[A-Za-z_$])/g, options.name)
        .replace(/("name":\s*")mullion(")/g, "$1" + slug + "$2")
        .replace(/\bmullion-(?=\$\{?|<version>|0\.|\d)/g, slug + "-")
        .replace(/dist\/mullion\b/g, "dist/" + slug)
        .replace(/dist\\mullion\b/g, "dist\\" + slug);
}

function listFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        if (entry.isDirectory()) {
            return SKIP_DIRS.has(entry.name) ? [] : listFiles(path.join(dir, entry.name));
        }
        if (!entry.isFile()) {
            return []; // Symlinks and other special entries are never renamed.
        }
        const full = path.join(dir, entry.name);
        const ext = path.extname(entry.name);
        return TEXT_EXTENSIONS.has(ext) || entry.name === ".debug" ? [full] : [];
    });
}

function rename(root, options, dryRun) {
    const changed = [];
    for (const file of listFiles(root)) {
        const rel = path.relative(root, file).split(path.sep).join("/");
        if (SKIP_FILES.has(rel)) {
            continue;
        }
        const before = fs.readFileSync(file, "utf8");
        const after = renameText(before, options);
        if (after !== before) {
            changed.push(rel);
            if (!dryRun) {
                fs.writeFileSync(file, after);
            }
        }
    }
    return changed;
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const read = (flag) => {
        const i = args.indexOf(flag);
        return i !== -1 ? args[i + 1] : undefined;
    };
    const options = { name: read("--name"), id: read("--id") };
    const dryRun = args.includes("--dry-run");
    const problems = validate(options);
    if (problems.length) {
        console.error(problems.join("\n"));
        console.error('\nUsage: npm run rename -- --name "Gridwright" --id com.yourstudio.gridwright [--dry-run]');
        process.exit(1);
    }
    const changed = rename(ROOT, options, dryRun);
    console.log(`${dryRun ? "Would change" : "Changed"} ${changed.length} files:`);
    changed.forEach((f) => console.log("  " + f));
    if (!dryRun) {
        console.log("\nNext: npm run icons (if the icon changes), npm run check, then reinstall the dev extension:");
        console.log("  scripts/install-dev-mac.sh --uninstall && scripts/install-dev-mac.sh");
    }
}

module.exports = { renameText, rename, validate, slugify, OLD_ID };
