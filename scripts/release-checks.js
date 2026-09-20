"use strict";

/*
 * Release consistency checks shared by scripts/build.js and the test suite.
 * Each check returns a list of problems; an empty list means the check passed.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const BUNDLE_ID = "com.keerthi.guidecomposer";
const EXTENSION_ID = "com.keerthi.guidecomposer.main";

// Files and folders that make up the shipped extension.
const PRODUCTION_ENTRIES = ["CSXS", "client", "host", "shared", "icons"];

// The host adapter each declared application boots into. A host the manifest
// does not declare cannot show the panel, so its adapter is dead weight in the
// package — and, to anyone who unzips the .zxp, a claim of support we have not
// made. Both the manifest check and the build read the list from here, so
// declaring a host is the only thing needed to start shipping its adapter.
const HOST_ADAPTERS = { ILST: "host/illustrator-adapter.jsx", IDSN: "host/indesign-adapter.jsx" };

function declaredHosts(root) {
    const manifest = read(root || ROOT, "CSXS/manifest.xml");
    return [...manifest.matchAll(/<Host Name="([A-Z]+)"/g)].map((m) => m[1]);
}

function unusedAdapters(root) {
    const shipped = declaredHosts(root).map((h) => HOST_ADAPTERS[h]).filter(Boolean);
    return Object.values(HOST_ADAPTERS).filter((file) => shipped.indexOf(file) === -1);
}

// Development-only files that must never reach a signed package.
const FORBIDDEN_IN_PACKAGE = [".debug", "tests", "scripts", "node_modules", "package.json", "package-lock.json", ".git", ".gitignore"];

function read(root, file) {
    return fs.readFileSync(path.join(root, file), "utf8");
}

function attr(xml, name) {
    const match = xml.match(new RegExp("\\b" + name + '="([^"]*)"'));
    return match ? match[1] : null;
}

function versions(root) {
    const manifest = read(root, "CSXS/manifest.xml");
    const extensionTag = manifest.match(/<Extension Id="[^"]+" Version="([^"]+)"\s*\/>/);
    const host = read(root, "host/index.jsx").match(/M\.VERSION = "([^"]+)"/);
    // The panel's own copy: this is the number a user reads in More, and the
    // one Copy diagnostics puts in a bug report. It was the only version site
    // nothing checked, so a release could ship a panel reporting the last one.
    const panel = read(root, "client/app.js").match(/PANEL_VERSION = "([^"]+)"/);
    return {
        bundle: attr(manifest, "ExtensionBundleVersion"),
        extension: extensionTag ? extensionTag[1] : null,
        host: host ? host[1] : null,
        panel: panel ? panel[1] : null
    };
}

function checkVersions(root = ROOT) {
    const problems = [];
    const pkg = JSON.parse(read(root, "package.json"));
    const v = versions(root);
    if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) {
        problems.push(`package.json version "${pkg.version}" is not MAJOR.MINOR.PATCH`);
    }
    for (const [where, value] of [["manifest ExtensionBundleVersion", v.bundle], ["manifest Extension Version", v.extension], ["host/index.jsx M.VERSION", v.host], ["client/app.js PANEL_VERSION", v.panel]]) {
        if (value !== pkg.version) {
            problems.push(`${where} is "${value}" but package.json is "${pkg.version}"`);
        }
    }
    const changelog = read(root, "CHANGELOG.md");
    const firstRelease = changelog.match(/^## \[?(\d+\.\d+\.\d+)\]?/m);
    if (!firstRelease || firstRelease[1] !== pkg.version) {
        problems.push(`CHANGELOG.md's newest entry is "${firstRelease ? firstRelease[1] : "missing"}" but package.json is "${pkg.version}"`);
    }
    return problems;
}

// Validates manifest structure and that every path it references exists under root.
function checkManifest(root = ROOT) {
    const problems = [];
    const manifest = read(root, "CSXS/manifest.xml");
    if (attr(manifest, "ExtensionBundleId") !== BUNDLE_ID) {
        problems.push(`ExtensionBundleId must be ${BUNDLE_ID}`);
    }
    const ids = [...manifest.matchAll(/<Extension Id="([^"]+)"/g)].map((m) => m[1]);
    if (ids.length !== 2 || ids.some((id) => id !== EXTENSION_ID)) {
        problems.push(`ExtensionList and DispatchInfoList must both declare ${EXTENSION_ID}`);
    }
    if (!/<Host Name="ILST" Version="\[\d+\.\d+,\d+\.\d+\]"\/>/.test(manifest)) {
        problems.push("manifest must declare the ILST host with a version range");
    }
    if (!/<RequiredRuntime Name="CSXS" Version="\d+\.\d+"\/>/.test(manifest)) {
        problems.push("manifest must declare a CSXS RequiredRuntime");
    }
    if (/--enable-nodejs|--mixed-context/.test(manifest)) {
        problems.push("manifest enables Node.js in the panel; GuideComposer does not need it");
    }
    const referenced = [...manifest.matchAll(/>\.\/([^<]+)</g)].map((m) => m[1]);
    if (referenced.length === 0) {
        problems.push("manifest references no files");
    }
    for (const rel of referenced) {
        if (!fs.existsSync(path.join(root, rel))) {
            problems.push(`manifest references missing file ./${rel}`);
        }
    }
    // Every file the host boot loader evaluates must exist too.
    const deps = read(root, "host/index.jsx").match(/DEPENDENCIES = \[([\s\S]*?)\]/);
    const hosts = declaredHosts(root);
    for (const rel of deps ? [...deps[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : []) {
        // "@adapter" is chosen at boot from the host application; each declared host needs its adapter.
        const files = rel === "@adapter" ? hosts.map((h) => HOST_ADAPTERS[h]).filter(Boolean) : [rel];
        for (const file of files) {
            if (!fs.existsSync(path.join(root, file))) {
                problems.push(`host boot dependency ${file} is missing`);
            }
        }
    }
    // Every script the panel loads must exist.
    const html = read(root, "client/index.html");
    for (const src of [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+)"/g)].map((m) => m[1])) {
        if (!/^https?:/.test(src) && !fs.existsSync(path.join(root, "client", src))) {
            problems.push(`client/index.html references missing ${src}`);
        }
        if (/^https?:/.test(src)) {
            problems.push(`client/index.html loads a remote resource (${src}); ship it locally`);
        }
    }
    return problems;
}

/*
 * Returns the CHANGELOG.md section for a version, without its heading:
 * everything between "## [1.2.3] - ..." and the next "## " heading.
 * Returns "" when there is no such section.
 */
function changelogSection(version, root = ROOT) {
    const changelog = read(root, "CHANGELOG.md");
    const escaped = version.replace(/\./g, "\\.");
    const heading = new RegExp("^## \\[?" + escaped + "\\]?.*$", "m");
    const start = changelog.match(heading);
    if (!start) {
        return "";
    }
    const after = changelog.slice(start.index + start[0].length);
    const next = after.search(/^## /m);
    return (next === -1 ? after : after.slice(0, next)).trim();
}

/*
 * Checks that a pushed git tag names the version this commit actually builds.
 * Without this, pushing v0.2.0 on a 0.1.0 commit silently produces a package
 * called <name>-0.1.0.zxp under a release called 0.2.0.
 * An empty tag (a manual workflow run) is accepted; the other checks still run.
 */
function checkTag(tag, root = ROOT) {
    const problems = [...checkVersions(root), ...checkManifest(root)];
    const pkg = JSON.parse(read(root, "package.json"));
    if (tag) {
        if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
            problems.push(`tag "${tag}" is not vMAJOR.MINOR.PATCH`);
        } else if (tag.slice(1) !== pkg.version) {
            problems.push(`tag "${tag}" does not match package.json version "${pkg.version}" — retag the commit that carries ${pkg.version}, or bump the version and tag again`);
        }
    }
    if (!changelogSection(pkg.version, root)) {
        problems.push(`CHANGELOG.md has no notes under a "## [${pkg.version}]" heading; release notes are published from it`);
    }
    return problems;
}

function listFiles(dir, base = dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? listFiles(full, base) : [path.relative(base, full)];
    });
}

function checkPackageContents(dir) {
    const problems = [];
    const files = listFiles(dir);
    for (const file of files) {
        const top = file.split(path.sep)[0];
        if (FORBIDDEN_IN_PACKAGE.includes(top) || FORBIDDEN_IN_PACKAGE.includes(file)) {
            problems.push(`development file in package: ${file}`);
        }
        if (/\.(p12|pfx|key|pem|map)$/i.test(file) || path.basename(file) === ".DS_Store") {
            problems.push(`file must not be packaged: ${file}`);
        }
        if (!PRODUCTION_ENTRIES.includes(top)) {
            problems.push(`unexpected top-level entry in package: ${file}`);
        }
    }
    return problems;
}

/*
 * Command line, used by .github/workflows/release.yml:
 *   node scripts/release-checks.js               report version and manifest problems
 *   node scripts/release-checks.js --tag v1.2.3  as above, plus tag/version agreement
 *   node scripts/release-checks.js --notes 1.2.3 print that CHANGELOG section
 */
if (require.main === module) {
    const args = process.argv.slice(2);
    const read_ = (flag) => {
        const i = args.indexOf(flag);
        return i !== -1 ? args[i + 1] : undefined;
    };
    if (args.includes("--notes")) {
        const version = read_("--notes") || JSON.parse(read(ROOT, "package.json")).version;
        const notes = changelogSection(version);
        if (!notes) {
            console.error(`CHANGELOG.md has no section for ${version}.`);
            process.exit(1);
        }
        process.stdout.write(notes + "\n");
    } else {
        const problems = checkTag(args.includes("--tag") ? read_("--tag") || "" : "");
        if (problems.length) {
            console.error("Release checks failed:");
            problems.forEach((p) => console.error("  " + p));
            process.exit(1);
        }
        console.log("Release checks passed.");
    }
}

module.exports = {
    ROOT,
    BUNDLE_ID,
    PRODUCTION_ENTRIES,
    HOST_ADAPTERS,
    declaredHosts,
    unusedAdapters,
    versions,
    checkVersions,
    checkManifest,
    checkPackageContents,
    changelogSection,
    checkTag,
    listFiles
};
