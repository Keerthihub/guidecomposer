#!/usr/bin/env node
"use strict";

/*
 * Builds the zip you hand to a person.
 *
 *   npm run zip
 *
 * The .zxp alone is not enough to give someone. It cannot be double-clicked,
 * the licence cannot live inside it (the build permits only the extension's own
 * folders), and "install this" is not obvious on either operating system. So
 * the zip carries the package, its checksum, install steps for macOS and
 * Windows, the licence, and the two pages people actually need afterwards.
 *
 * One .zxp serves both operating systems: a CEP extension is HTML, CSS,
 * JavaScript and ExtendScript, with no native code. This script refuses to
 * build if that stops being true.
 *
 * It refuses to build a zip containing an unfilled [PLACEHOLDER] too. Shipping
 * a licence that says [PUBLISHER_NAME] is worse than shipping no licence.
 */

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const VERSION = pkg.version;
const NAME = `guidecomposer-${VERSION}`;

function findSignedPackage() {
    const candidates = [
        path.join(ROOT, `dist/signed-${VERSION}/${NAME}.zxp`),
        path.join(ROOT, `dist/${NAME}.zxp`),
        path.join(ROOT, `dist/signed-beta/${NAME}.zxp`)
    ];
    const found = candidates.find((p) => fs.existsSync(p));
    if (!found) {
        throw new Error(
            `No signed ${NAME}.zxp found. Looked in:\n  ` + candidates.join("\n  ") +
            "\n\nSign one first: gh workflow run \"Signed release\", then download the artefact."
        );
    }
    return found;
}

// A CEP extension is web code. Anything else means it is not one file for both
// operating systems any more, and this zip's instructions would be wrong.
function assertPlatformIndependent(zxp) {
    const listing = execFileSync("unzip", ["-Z1", zxp], { encoding: "utf8" }).trim().split("\n");
    const allowed = /(\.(js|jsx|html|css|xml|png|json|txt|md)$|\/$|^mimetype$)/i;
    const odd = listing.filter((f) => f && !allowed.test(f));
    if (odd.length) {
        throw new Error("The package contains files that may be platform-specific:\n  " + odd.join("\n  "));
    }
    return listing.length;
}

function assertNoPlaceholders(files) {
    const bad = [];
    for (const [name, body] of files) {
        const tokens = [...body.matchAll(/\[([A-Z_]{3,})\](?!\()/g)].map((m) => m[1]);
        if (tokens.length) {
            bad.push(`${name}: ${[...new Set(tokens)].join(", ")}`);
        }
    }
    if (bad.length) {
        throw new Error(
            "These files still contain unfilled placeholders, so the zip was not built:\n  " +
            bad.join("\n  ") + "\n\nSee docs/LAUNCH-CHECKLIST.md, step 3."
        );
    }
}

function installSheet(sha) {
    return `GuideComposer ${VERSION}
Professional layout grids for Adobe Illustrator
Free and open source — https://github.com/Keerthihub/guidecomposer

WHAT IS IN THIS ZIP
  ${NAME}.zxp          the plugin
  ${NAME}.zxp.sha256   its checksum, so you can confirm the download is intact
  INSTALL.txt                   this file
  LICENSE.txt                   the MIT licence
  TROUBLESHOOTING.txt           if the panel does not appear, or misbehaves
  UPDATING.txt                  read before updating or reinstalling

ONE FILE, BOTH SYSTEMS
  The same .zxp installs on macOS and on Windows. A CEP extension contains no
  native code, so there is no separate download for each.

BEFORE YOU START
  - Adobe Illustrator 2022 (26.0) or later, already installed and signed in.
  - Quit Illustrator. The installer cannot register a plugin while it is running.

CHECK THE DOWNLOAD (optional, 10 seconds)
  macOS / Terminal:      shasum -a 256 ${NAME}.zxp
  Windows / PowerShell:  Get-FileHash .\\${NAME}.zxp -Algorithm SHA256

  It should be:
  ${sha}

INSTALL — macOS
  Open Terminal, then paste this as one line:

  "/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent" --install "$PWD/${NAME}.zxp"

  Run it from the folder you unzipped into, or replace $PWD with the full path.

INSTALL — Windows
  Open PowerShell, then paste this as one line:

  & "C:\\Program Files\\Common Files\\Adobe\\Adobe Desktop Common\\RemoteComponents\\UPI\\UnifiedPluginInstallerAgent\\UnifiedPluginInstallerAgent.exe" /install "$PWD\\${NAME}.zxp"

OPEN IT
  Start Illustrator, then:  Window > Extensions > GuideComposer
  Some versions call that submenu "Extensions (Legacy)".

FIRST THING TO TRY
  Open a document, then in the panel choose More > Draw test line. A line should
  appear. Clear removes it. If that works, everything works.

IF THE PANEL IS NOT IN THE MENU
  See TROUBLESHOOTING.txt. The usual cause is that Illustrator was running
  during the install — quit it fully and install again.

UNINSTALL
  macOS:    ...UnifiedPluginInstallerAgent --remove GuideComposer
  Windows:  ...UnifiedPluginInstallerAgent.exe /remove GuideComposer

  Export your presets first (More > Export presets). Uninstalling removes them.

SUPPORT
  https://github.com/Keerthihub/guidecomposer/issues
  Every issue is read. This is a free project, so no reply is promised by any
  particular date. Include More > Copy diagnostics and you will get a better one.

WHAT IT NEVER DOES
  No network connections. No account. No licence key. No data collected.
  It never touches artwork it did not create.
`;
}

function main() {
    const zxp = findSignedPackage();
    const shaFile = zxp + ".sha256";
    if (!fs.existsSync(shaFile)) {
        throw new Error(`Found ${path.basename(zxp)} but no .sha256 beside it.`);
    }
    const sha = fs.readFileSync(shaFile, "utf8").trim().split(/\s+/)[0];

    const actual = execFileSync("shasum", ["-a", "256", zxp], { encoding: "utf8" }).trim().split(/\s+/)[0];
    if (actual !== sha) {
        throw new Error(`${path.basename(zxp)} does not match its checksum. Do not ship it.`);
    }

    const fileCount = assertPlatformIndependent(zxp);

    const text = [
        ["LICENSE.txt", fs.readFileSync(path.join(ROOT, "LICENSE"), "utf8")],
        ["TROUBLESHOOTING.txt", fs.readFileSync(path.join(ROOT, "docs/TROUBLESHOOTING.md"), "utf8")],
        ["UPDATING.txt", fs.readFileSync(path.join(ROOT, "docs/UPDATING.md"), "utf8")],
        ["INSTALL.txt", installSheet(sha)]
    ];
    assertNoPlaceholders(text);

    const staging = fs.mkdtempSync(path.join(os.tmpdir(), "guidecomposer-zip-"));
    const folder = path.join(staging, NAME);
    fs.mkdirSync(folder);
    fs.copyFileSync(zxp, path.join(folder, `${NAME}.zxp`));
    fs.copyFileSync(shaFile, path.join(folder, `${NAME}.zxp.sha256`));
    for (const [name, body] of text) {
        fs.writeFileSync(path.join(folder, name), body);
    }

    const outDir = path.join(ROOT, "dist");
    fs.mkdirSync(outDir, { recursive: true });
    const out = path.join(outDir, `${NAME}.zip`);
    fs.rmSync(out, { force: true });
    // -X leaves out macOS resource forks, which look like junk on Windows.
    execFileSync("zip", ["-r", "-X", "-q", out, NAME], { cwd: staging });
    fs.rmSync(staging, { recursive: true, force: true });

    const size = (fs.statSync(out).size / 1024).toFixed(0);
    console.log(`Built ${path.relative(process.cwd(), out)} (${size} KB)`);
    console.log(`  from ${path.relative(ROOT, zxp)} — ${fileCount} files, all web code`);
    console.log(`  sha256 ${sha}`);
    console.log("\nContents:");
    execFileSync("unzip", ["-Z1", out], { encoding: "utf8" }).trim().split("\n").forEach((f) => console.log("  " + f));
}

try {
    main();
} catch (e) {
    console.error(e.message);
    process.exit(1);
}
