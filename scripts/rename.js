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
 * It renames FROM whatever the tree currently says it is, read from
 * CSXS/manifest.xml and package.json rather than hardcoded, so it can be run
 * again when you change your mind. An earlier version only knew how to rename
 * from the original placeholder, which made the second rename a silent no-op
 * and the CI rename rehearsal a test of nothing.
 *
 * Run it before the first public release. After release, changing the id means
 * Clear no longer recognizes grids made by earlier versions.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PLACEHOLDER_ID = "com.mullion.panel";

/*
 * What the tree calls itself today: the extension id and product name from the
 * manifest, and the package slug from package.json. These three are the only
 * strings the rename replaces, so reading them back is what makes a second
 * rename work.
 */
function currentIdentity(root) {
    const manifest = fs.readFileSync(path.join(root || ROOT, "CSXS/manifest.xml"), "utf8");
    const pkg = JSON.parse(fs.readFileSync(path.join(root || ROOT, "package.json"), "utf8"));
    const id = manifest.match(/ExtensionBundleId="([^"]+)"/);
    const name = manifest.match(/ExtensionBundleName="([^"]+)"/);
    if (!id || !name) {
        throw new Error("CSXS/manifest.xml has no ExtensionBundleId/ExtensionBundleName to rename from");
    }
    return { id: id[1], name: name[1], slug: pkg.name };
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "vendor"]);
const TEXT_EXTENSIONS = new Set([".js", ".jsx", ".json", ".html", ".css", ".md", ".xml", ".sh", ".ps1", ".yml", ""]);
const SKIP_FILES = new Set(["scripts/rename.js", "tests/rename.test.js"]);

function validate(options, from) {
    const problems = [];
    if (!options.name || !/^[A-Za-z][A-Za-z0-9 &'-]{1,29}$/.test(options.name)) {
        problems.push("--name must be 2 to 30 characters: letters, numbers, spaces, & ' -, starting with a letter.");
    }
    if (!options.id || !/^[a-z][a-z0-9-]*(\.[a-z0-9-]+){1,5}$/.test(options.id)) {
        problems.push("--id must be lowercase reverse-DNS, such as com.yourstudio.gridwright.");
    }
    if (options.id === PLACEHOLDER_ID) {
        problems.push("--id is still the placeholder id.");
    }
    if (from && options.id === from.id && options.name === from.name) {
        problems.push("--name and --id are what the project is already called; nothing to do.");
    }
    return problems;
}

function slugify(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/*
 * Returns the renamed text, renaming from `from` (what the project is called
 * now) to `options` (what it should be called). The product name is replaced
 * only where it is a word on its own: not in identifiers (MullionCore), member
 * access (Mullion.api, $.global.Mullion), or `typeof Mullion` checks — which is
 * why renaming the visible name never disturbs the internal ones.
 */
function renameText(text, options, from) {
    from = from || { id: PLACEHOLDER_ID, name: "Mullion", slug: "mullion" };
    const slug = options.slug || slugify(options.name);
    const name = escapeRegExp(from.name);
    const oldSlug = escapeRegExp(from.slug);
    return text
        .replace(/<!-- placeholder-name-note -->[\s\S]*?<!-- \/placeholder-name-note -->\n?/g, "")
        .split(from.id).join(options.id)
        .replace(new RegExp("(?<![\\w.$])(?<!typeof )" + name + "(?![\\w(])(?!\\.[A-Za-z_$])", "g"), options.name)
        .replace(new RegExp('("name":\\s*")' + oldSlug + '(")', "g"), "$1" + slug + "$2")
        .replace(new RegExp("\\b" + oldSlug + "-(?=\\$\\{?|<version>|0\\.|\\d)", "g"), slug + "-")
        .replace(new RegExp("dist/" + oldSlug + "\\b", "g"), "dist/" + slug)
        .replace(new RegExp("dist\\\\" + oldSlug + "\\b", "g"), "dist\\" + slug);
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

function rename(root, options, dryRun, from) {
    from = from || currentIdentity(root);
    const changed = [];
    for (const file of listFiles(root)) {
        const rel = path.relative(root, file).split(path.sep).join("/");
        if (SKIP_FILES.has(rel)) {
            continue;
        }
        const before = fs.readFileSync(file, "utf8");
        const after = renameText(before, options, from);
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
    const from = currentIdentity(ROOT);
    const problems = validate(options, from);
    if (problems.length) {
        console.error(problems.join("\n"));
        console.error('\nUsage: npm run rename -- --name "Gridwright" --id com.yourstudio.gridwright [--dry-run]');
        process.exit(1);
    }
    console.log(`Renaming ${from.name} (${from.id}) to ${options.name} (${options.id})`);
    const changed = rename(ROOT, options, dryRun, from);
    console.log(`${dryRun ? "Would change" : "Changed"} ${changed.length} files:`);
    changed.forEach((f) => console.log("  " + f));
    if (!dryRun) {
        console.log("\nNext: npm run icons (if the icon changes), npm run check, then reinstall the dev extension:");
        console.log("  scripts/install-dev-mac.sh --uninstall && scripts/install-dev-mac.sh");
    }
}

module.exports = { renameText, rename, validate, slugify, currentIdentity, PLACEHOLDER_ID };
