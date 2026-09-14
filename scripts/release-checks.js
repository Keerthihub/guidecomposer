"use strict";

/*
 * Release consistency checks shared by scripts/build.js and the test suite.
 * Each check returns a list of problems; an empty list means the check passed.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const BUNDLE_ID = "com.mullion.panel";
const EXTENSION_ID = "com.mullion.panel.main";

// Files and folders that make up the shipped extension.
const PRODUCTION_ENTRIES = ["CSXS", "client", "host", "shared", "icons"];

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
    return {
        bundle: attr(manifest, "ExtensionBundleVersion"),
        extension: extensionTag ? extensionTag[1] : null,
        host: host ? host[1] : null
    };
}

function checkVersions(root = ROOT) {
    const problems = [];
    const pkg = JSON.parse(read(root, "package.json"));
    const v = versions(root);
    if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) {
        problems.push(`package.json version "${pkg.version}" is not MAJOR.MINOR.PATCH`);
    }
    for (const [where, value] of [["manifest ExtensionBundleVersion", v.bundle], ["manifest Extension Version", v.extension], ["host/index.jsx M.VERSION", v.host]]) {
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
        problems.push("manifest enables Node.js in the panel; Mullion does not need it");
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
    for (const rel of deps ? [...deps[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : []) {
        if (!fs.existsSync(path.join(root, rel))) {
            problems.push(`host boot dependency ${rel} is missing`);
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

module.exports = {
    ROOT,
    BUNDLE_ID,
    PRODUCTION_ENTRIES,
    versions,
    checkVersions,
    checkManifest,
    checkPackageContents,
    listFiles
};
