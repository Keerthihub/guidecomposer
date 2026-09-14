"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const checks = require("../scripts/release-checks.js");
const { build } = require("../scripts/build.js");

test("versions agree across package.json, manifest, host, and changelog", () => {
    assert.deepEqual(checks.checkVersions(), []);
});

test("manifest is well formed and every referenced file exists", () => {
    assert.deepEqual(checks.checkManifest(), []);
});

test("manifest targets Illustrator 2022+ panels without Node.js", () => {
    const manifest = fs.readFileSync(path.join(checks.ROOT, "CSXS/manifest.xml"), "utf8");
    assert.match(manifest, /<Host Name="ILST" Version="\[26\.0,99\.9\]"\/>/);
    assert.match(manifest, /<RequiredRuntime Name="CSXS" Version="11\.0"\/>/);
    assert.match(manifest, /<Type>Panel<\/Type>/);
    assert.doesNotMatch(manifest, /enable-nodejs/);
});

test(".debug targets the same extension id as the manifest", () => {
    const debug = fs.readFileSync(path.join(checks.ROOT, ".debug"), "utf8");
    assert.match(debug, /<Extension Id="com\.mullion\.panel\.main">/);
    assert.match(debug, /<Host Name="ILST" Port="\d+"\/>/);
});

test("build output contains only production files", () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "mullion-build-"));
    try {
        const result = build(out);
        assert.deepEqual(result.problems, []);
        assert.equal(result.ok, true);
        const files = result.files.map((f) => f.split(path.sep).join("/"));
        for (const required of [
            "CSXS/manifest.xml", "client/index.html", "client/app.js", "client/styles.css",
            "client/vendor/CSInterface.js", "host/index.jsx", "host/illustrator-adapter.jsx",
            "host/vendor/json2.js", "shared/grid-core.js", "icons/icon-normal.png"
        ]) {
            assert.ok(files.includes(required), `missing ${required}`);
        }
        assert.ok(!files.some((f) => f.startsWith("tests/") || f === ".debug" || f.startsWith("scripts/")));
    } finally {
        fs.rmSync(out, { recursive: true, force: true });
    }
});

test("package content check rejects development and signing files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mullion-bad-"));
    try {
        fs.mkdirSync(path.join(dir, "client"));
        fs.writeFileSync(path.join(dir, ".debug"), "");
        fs.writeFileSync(path.join(dir, "client", "cert.p12"), "");
        const problems = checks.checkPackageContents(dir);
        assert.ok(problems.some((p) => p.includes(".debug")));
        assert.ok(problems.some((p) => p.includes("cert.p12")));
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("panel loads no remote resources", () => {
    const html = fs.readFileSync(path.join(checks.ROOT, "client/index.html"), "utf8");
    assert.doesNotMatch(html, /(src|href)="https?:/);
    const css = fs.readFileSync(path.join(checks.ROOT, "client/styles.css"), "utf8");
    assert.doesNotMatch(css, /url\(\s*["']?https?:/);
});

test("gitignore keeps certificates, passwords, and packages out of the repository", () => {
    const ignore = fs.readFileSync(path.join(checks.ROOT, ".gitignore"), "utf8");
    for (const pattern of ["*.p12", "*.pfx", "dist/", "*.zxp", ".env"]) {
        assert.ok(ignore.split("\n").includes(pattern), `.gitignore should include ${pattern}`);
    }
});
