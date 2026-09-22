#!/usr/bin/env node
"use strict";

/*
 * Drives the real panel inside a real Illustrator.
 *
 * The project already had two kinds of panel evidence and a gap between them:
 *
 *   npm run test:ui          the whole panel, but in headless Chrome against a
 *                            mock host — not CEP, and not Illustrator
 *   npm run qa:illustrator   the host code in a real Illustrator, but never the
 *                            panel that calls it
 *
 * So nothing checked the one thing a user actually does: open the panel inside
 * Illustrator and press a button. That gap is how a refactor could ship having
 * only ever run in headless Chrome — index.html went from loading two panel
 * scripts to nine, and if one of those fails to load in CEP's embedded
 * Chromium, the panel is simply blank and every headless test still passes.
 *
 * This connects to the panel's CEP debugging port and drives it the way a
 * person would: set a control, press Generate, read the status line back.
 *
 * SAFETY: it creates its own document, works only in that, and closes only
 * that. It records the documents that were open before it started and never
 * touches them. tests/qa-scripts.test.js enforces this.
 *
 *   npm run qa:panel
 *
 * Requires: Illustrator running, the panel open (Window > Extensions >
 * GuideComposer), and the development extension installed so that .debug
 * applies. It cannot open the panel itself — CEP offers no way to, and doing it
 * by clicking the menu needs macOS accessibility permission.
 */

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PORT = Number(process.env.GUIDECOMPOSER_DEBUG_PORT || 8088);
const PANEL_TITLE = "GuideComposer";
const results = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function record(name, pass, detail) {
    results.push({ name, pass, detail });
    console.log((pass ? "PASS " : "FAIL ") + name + (detail ? " — " + detail : ""));
}

// ---------------------------------------------------------------- Illustrator

function illustrator(js) {
    const script = `tell application id "com.adobe.illustrator" to do javascript ${JSON.stringify(js)}`;
    return execFileSync("osascript", ["-e", script], { encoding: "utf8", timeout: 120000 }).trim();
}

function openDocumentNames() {
    return illustrator('var n = []; for (var i = 0; i < app.documents.length; i++) { n.push(app.documents[i].name); } n.join("\\n");')
        .split("\n")
        .filter(Boolean);
}

// ------------------------------------------------------------------- the page

async function connect() {
    let listing;
    try {
        listing = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    } catch (e) {
        throw new Error(
            `Nothing is listening on port ${PORT}.\n` +
            "Open Illustrator, then Window > Extensions > GuideComposer, and run this again.\n" +
            "The port comes from .debug, so the development extension must be installed."
        );
    }
    const target = listing.find((t) => t.title === PANEL_TITLE);
    if (!target) {
        throw new Error(`The panel is not open. Targets seen: ${listing.map((t) => t.title).join(", ") || "none"}`);
    }

    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        socket.onopen = resolve;
        socket.onerror = () => reject(new Error("could not attach to the panel"));
    });

    let nextId = 0;
    const pending = new Map();
    const pageErrors = [];
    socket.onmessage = (message) => {
        const data = JSON.parse(message.data);
        if (data.id && pending.has(data.id)) {
            pending.get(data.id)(data);
            pending.delete(data.id);
        } else if (data.method === "Runtime.exceptionThrown") {
            pageErrors.push(JSON.stringify(data.params).slice(0, 300));
        }
    };
    const send = (method, params = {}) =>
        new Promise((resolve) => {
            const id = ++nextId;
            pending.set(id, resolve);
            socket.send(JSON.stringify({ id, method, params }));
        });

    await send("Runtime.enable");

    const evaluate = async (expression) => {
        const reply = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
        if (reply.result && reply.result.exceptionDetails) {
            throw new Error(JSON.stringify(reply.result.exceptionDetails).slice(0, 400));
        }
        return reply.result && reply.result.result ? reply.result.result.value : undefined;
    };

    return { evaluate, pageErrors, close: () => socket.close() };
}

// ------------------------------------------------------------------ the checks

async function run(panel) {
    const { evaluate } = panel;

    const setField = (name, value) => evaluate(
        `(() => { const el = document.getElementById("settings").elements.namedItem(${JSON.stringify(name)});
          if (el instanceof RadioNodeList) { const r = Array.from(el).find((x) => x.value === ${JSON.stringify(String(value))}); r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); }
          else if (el.type === "checkbox") { el.checked = ${JSON.stringify(value)}; el.dispatchEvent(new Event("change", { bubbles: true })); }
          else { el.value = ${JSON.stringify(String(value))}; el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); } })()`
    );
    const click = (id) => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
    const status = () => evaluate(`document.getElementById("status").textContent`);
    const mode = (name) => evaluate(`document.querySelector('input[name="panel-mode"][value=${JSON.stringify(name)}]').click()`);
    const settle = async () => {
        for (let i = 0; i < 80; i++) {
            if (!(await evaluate(`document.getElementById("generate").disabled`))) {
                return;
            }
            await sleep(250);
        }
    };

    // Every module has to be there. This is the check that would have caught a
    // panel that loads in headless Chrome but not in CEP.
    const loaded = await evaluate(`(() => {
        const ui = window.MullionUI || {};
        const want = ["constants", "createQueue", "applyTheme", "createCepBridge", "hostError",
                      "configureStorage", "storage", "loadPresets", "writePresets",
                      "configureFields", "showErrors", "svgNode", "paintGrid"];
        return { missing: want.filter((k) => !(k in ui)),
                 version: (ui.constants || {}).PANEL_VERSION,
                 core: typeof window.MullionCore === "object",
                 layouts: (window.MullionLayouts || {}).LAYOUTS ? window.MullionLayouts.LAYOUTS.length : 0 };
    })()`);
    record("every panel module loads inside CEP", loaded.missing.length === 0 && loaded.core && loaded.layouts > 0,
        `version ${loaded.version}, ${loaded.layouts} layouts` + (loaded.missing.length ? `, missing: ${loaded.missing.join(", ")}` : ""));

    await mode("grid");
    await sleep(400);

    for (const type of ["columns", "modular", "baseline", "composition", "pattern"]) {
        await setField("type", type);
        await sleep(400);
        await settle();
        await click("generate");
        await sleep(900);
        await settle();
        const said = await status();
        record(`generate ${type}`, /shapes?\)/.test(said) && !/couldn't|error|isn't/i.test(said), said.slice(0, 90));
        await click("clear");
        await sleep(700);
        await settle();
    }

    // A second grid type drawn over the first, in one action.
    await setField("type", "columns");
    const overlaid = await evaluate(`(() => { const b = document.querySelector('#overlay-types input[value="baseline"]');
        if (!b) { return false; } b.checked = true; b.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
    if (overlaid) {
        await sleep(400);
        await settle();
        await click("generate");
        await sleep(1100);
        await settle();
        record("an overlay grid generates", /shapes?\)/.test(await status()), (await status()).slice(0, 90));
        await evaluate(`(() => { const b = document.querySelector('#overlay-types input[value="baseline"]');
            if (b) { b.checked = false; b.dispatchEvent(new Event("change", { bubbles: true })); } })()`);
        await click("clear");
        await sleep(700);
        await settle();
    }

    /*
     * Gallery tiles are painted as they scroll into view, so checking only the
     * tiles visible at rest reports most of them blank and looks like the bug
     * where tiles really were empty. Scroll the gallery, then judge.
     */
    await mode("layouts");
    await sleep(1400);
    const tiles = await evaluate(`(async () => {
        const grid = document.getElementById("library-grid");
        for (let i = 0; i < 12; i++) { grid.scrollTop += 200; grid.dispatchEvent(new Event("scroll", { bubbles: true })); await new Promise((r) => setTimeout(r, 250)); }
        await new Promise((r) => setTimeout(r, 1200));
        const marks = Array.from(document.querySelectorAll(".tile")).map((t) => t.querySelectorAll("svg *").length);
        return { count: marks.length, blank: marks.filter((m) => m < 3).length, least: Math.min(...marks) };
    })()`);
    record("every gallery tile draws a grid once scrolled to", tiles.count > 0 && tiles.blank === 0,
        `${tiles.count} tiles, ${tiles.blank} blank, fewest marks ${tiles.least}`);

    await mode("grid");
    await sleep(400);

    /*
     * The preset backup. CEP names an extension's storage after the host
     * application's VERSION as well as its id, so updating Illustrator hands
     * the panel an empty store and the user's presets are gone. The panel
     * mirrors them to a file outside that store; this proves the file is really
     * written, by the real cep.fs, at the real path.
     */
    const backup = path.join(os.homedir(), "Library/Application Support/GuideComposer/presets-backup.json");
    const name = "QA preset " + Date.now();
    await setField("columns", 7);
    await sleep(300);
    await click("preset-new");
    await sleep(300);
    await evaluate(`(() => { const el = document.getElementById("preset-name");
        el.value = ${JSON.stringify(name)}; el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await click("preset-save");
    await sleep(900);

    let saved = null;
    try {
        saved = JSON.parse(fs.readFileSync(backup, "utf8"));
    } catch (e) {
        saved = null;
    }
    record("a saved preset is mirrored to a file outside CEP's storage",
        Boolean(saved && saved.presets.some((p) => p.name === name && p.settings.columns === 7)),
        saved ? `${saved.presets.length} preset(s) in ${path.basename(backup)}` : "no backup file was written");

    // Put the panel back as it was found.
    await evaluate(`(async () => {
        const select = document.getElementById("preset-select");
        const option = Array.from(select.options).find((o) => o.textContent === ${JSON.stringify(name)});
        if (!option) { return; }
        select.value = option.value; select.dispatchEvent(new Event("change", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 400));
        document.getElementById("preset-delete").click();
        await new Promise((r) => setTimeout(r, 700));
    })()`);
}

// ----------------------------------------------------------------------- main

(async () => {
    console.log("Running GuideComposer live panel QA");
    console.log(`  panel port: ${PORT}`);

    const panel = await connect();

    /*
     * Everything below happens in a document this script creates. The names
     * open beforehand are recorded so that only the new one is ever closed:
     * this script runs against whatever the user has open, and a QA script in
     * this project once closed a document it had not created.
     */
    const before = openDocumentNames();
    console.log(`  documents already open: ${before.length ? before.join(", ") : "none"}`);
    const scratch = illustrator('var d = app.documents.add(DocumentColorSpace.RGB, 612, 792); d.name;');
    console.log(`  working in: ${scratch}\n`);

    let failure = null;
    try {
        await run(panel);
    } catch (e) {
        failure = e;
    } finally {
        if (before.indexOf(scratch) === -1) {
            /*
             * Closing a document often makes Illustrator answer slowly enough
             * that AppleScript reports a timeout (-1712) even though the close
             * went through. Trusting the exception printed "could not close" on
             * a run that had closed it, which is a frightening message about
             * nothing. Ask Illustrator what is open instead of guessing.
             */
            try {
                illustrator(
                    'for (var i = app.documents.length - 1; i >= 0; i--) {' +
                    ' if (app.documents[i].name === ' + JSON.stringify(scratch) + ') {' +
                    ' app.documents[i].close(SaveOptions.DONOTSAVECHANGES); } } "closed";'
                );
            } catch (e2) {
                // Might be a timeout, might be a real failure. The check below decides.
            }
            let stillOpen = true;
            for (let i = 0; i < 10 && stillOpen; i++) {
                await sleep(1000);
                try {
                    stillOpen = openDocumentNames().indexOf(scratch) !== -1;
                } catch (e3) {
                    stillOpen = true; // Illustrator is busy; ask again.
                }
            }
            if (stillOpen) {
                console.error(`\nCould not close ${scratch}. Close it yourself, without saving.`);
            }
        }
    }

    const after = openDocumentNames();
    record("every document this test opened was closed, and no other was",
        after.length === before.length && before.every((n) => after.indexOf(n) !== -1),
        `open before=${before.length}, open now=${after.length}`);

    if (panel.pageErrors.length) {
        panel.pageErrors.forEach((e) => console.log("PAGE ERROR " + e));
        record("the panel threw nothing while being driven", false, `${panel.pageErrors.length} error(s)`);
    } else {
        record("the panel threw nothing while being driven", true, "no page errors");
    }

    panel.close();

    if (failure) {
        console.error("\nDriver error: " + failure.message);
    }
    const failed = results.filter((r) => !r.pass).length;
    console.log(`\n${results.length} checks, ${failed} failed`);
    process.exit(failed || failure ? 1 : 0);
})().catch((e) => {
    console.error(e.message);
    process.exit(1);
});
