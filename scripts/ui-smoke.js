#!/usr/bin/env node
/*
 * Panel smoke test in headless Chrome, using the browser mock host.
 *
 *   node scripts/ui-smoke.js [--screenshots <dir>]
 *
 * Fails on any uncaught exception or console error, and checks the main
 * interactions: validation, unit conversion, preview, generate, clear,
 * presets, persistence, and the no-document state. It also covers the states
 * that are hard to reach by hand and easy to break: the smallest panel the
 * manifest allows (240 × 320), a host that answers too slowly, storage that
 * refuses to write, focus when a field is hidden, and an extension updated
 * underneath the panel. Uses the Chrome DevTools Protocol over Node's built-in
 * WebSocket, so it needs no npm packages.
 * Set CHROME_PATH if Chrome is not in the default macOS location.
 */
"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PAGE = require("node:url").pathToFileURL(path.join(ROOT, "client", "index.html")).href;
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9300 + Math.floor(Math.random() * 500);

const shotsIndex = process.argv.indexOf("--screenshots");
const SHOTS = shotsIndex !== -1 ? path.resolve(process.argv[shotsIndex + 1]) : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
    if (!fs.existsSync(CHROME)) {
        console.error("Chrome not found. Set CHROME_PATH.");
        process.exit(2);
    }
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "mullion-ui-"));
    const chrome = spawn(CHROME, [
        "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
        "--no-first-run", "--no-default-browser-check", "--allow-file-access-from-files",
        // Linux CI runners restrict the user namespaces Chrome's sandbox needs.
        ...(process.platform === "linux" ? ["--no-sandbox"] : []),
        "about:blank"
    ], { stdio: "ignore" });

    let ws;
    const failures = [];
    const pageErrors = [];
    try {
        let target;
        for (let i = 0; i < 50 && !target; i++) {
            await sleep(100);
            try {
                const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
                target = list.find((t) => t.type === "page");
            } catch (e) {
                // Chrome is still starting.
            }
        }
        if (!target) throw new Error("Could not connect to headless Chrome");

        ws = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
        let nextId = 1;
        const pending = new Map();
        const listeners = [];
        ws.onmessage = (msg) => {
            const data = JSON.parse(msg.data);
            if (data.id && pending.has(data.id)) {
                const { resolve, reject } = pending.get(data.id);
                pending.delete(data.id);
                data.error ? reject(new Error(data.error.message)) : resolve(data.result);
            } else if (data.method) {
                listeners.forEach((fn) => fn(data));
            }
        };
        const send = (method, params = {}) => new Promise((resolve, reject) => {
            const id = nextId++;
            pending.set(id, { resolve, reject });
            ws.send(JSON.stringify({ id, method, params }));
        });
        listeners.push((event) => {
            if (event.method === "Runtime.exceptionThrown") {
                pageErrors.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
            }
            if (event.method === "Runtime.consoleAPICalled" && event.params.type === "error") {
                pageErrors.push(event.params.args.map((a) => a.value ?? a.description).join(" "));
            }
            if (event.method === "Log.entryAdded" && event.params.entry.level === "error") {
                pageErrors.push(event.params.entry.text + " " + (event.params.entry.url || ""));
            }
        });

        await send("Page.enable");
        await send("Runtime.enable");
        await send("Log.enable");
        await send("Emulation.setDeviceMetricsOverride", { width: 320, height: 1180, deviceScaleFactor: 2, mobile: false });

        const evaluate = async (expression) => {
            const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
            if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
            return r.result.value;
        };
        const load = async (query) => {
            await send("Page.navigate", { url: PAGE + query });
            await sleep(700);
        };
        const check = (cond, label) => {
            console.log((cond ? "PASS " : "FAIL ") + label);
            if (!cond) failures.push(label);
        };
        const shoot = async (name) => {
            if (!SHOTS) return;
            fs.mkdirSync(SHOTS, { recursive: true });
            const { data } = await send("Page.captureScreenshot", { format: "png" });
            fs.writeFileSync(path.join(SHOTS, name + ".png"), Buffer.from(data, "base64"));
        };

        // Helpers injected into the page.
        const setField = (name, value) => `(() => {
            const el = document.getElementById("settings").elements.namedItem(${JSON.stringify(name)});
            if (el instanceof RadioNodeList) {
                const radio = Array.from(el).find((r) => r.value === ${JSON.stringify(String(value))});
                radio.checked = true;
                radio.dispatchEvent(new Event("change", { bubbles: true }));
            } else if (el.type === "checkbox") {
                el.checked = ${JSON.stringify(value)};
                el.dispatchEvent(new Event("change", { bubbles: true }));
            } else {
                el.value = ${JSON.stringify(String(value))};
                el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
            }
        })()`;
        const text = (id) => `document.getElementById(${JSON.stringify(id)}).textContent`;
        const value = (name) => `document.getElementById("settings").elements.namedItem(${JSON.stringify(name)}).value`;
        const click = (id) => `document.getElementById(${JSON.stringify(id)}).click()`;
        const mode = (name) => `document.querySelector('input[name="panel-mode"][value=${JSON.stringify(name)}]').click()`;
        const shown = (selector) => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return Boolean(el) && el.getClientRects().length > 0; })()`;

        // ------------------------------------------ Chromium 88 (Illustrator 2022) compatibility
        // The panel has to run in CEP 11's Chromium 88, which has none of these.
        // Comments name these features, so they are stripped before looking.
        const css = fs.readFileSync(path.join(ROOT, "client", "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
        check(!/:has\(/.test(css) && !/color-mix\(/.test(css) && !/@container/.test(css), "no :has(), color-mix() or container queries in the stylesheet");
        const supportsBlock = (css.match(/@supports \(accent-color[^{]*\{[\s\S]*?\n\}/) || [""])[0];
        const accentUses = (css.match(/accent-color/g) || []).length;
        const guardedUses = (supportsBlock.match(/accent-color/g) || []).length;
        check(accentUses === guardedUses, "every accent-color is inside an @supports guard (" + guardedUses + " of " + accentUses + ")");
        check(/\.mode input:checked:focus-visible/.test(css), "the selected mode tab has a focus ring of its own, not accent on accent");

        // The panel compares its own version with the one the host reports, so a
        // stale PANEL_VERSION would offer a reload on every launch.
        const pkgVersion = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
        const panelVersion = (fs.readFileSync(path.join(ROOT, "client", "app.js"), "utf8").match(/PANEL_VERSION = "([^"]+)"/) || [])[1];
        check(panelVersion === pkgVersion, "the panel's version matches package.json (" + panelVersion + " vs " + pkgVersion + ")");

        // ---------------------------------------------------------------- default state
        await load("?theme=dark");
        await evaluate("localStorage.clear()");
        await load("?theme=dark");
        check(await evaluate(text("artboard-name")) === "Artboard 1", "mock document artboard name shown");
        check(await evaluate(text("artboard-size")) === "612 × 792 pt", "artboard size readout");
        check(await evaluate(text("grid-metrics")) === "Columns 34 pt wide", "column width readout matches core (34 pt)");
        check(await evaluate(text("grid-count")) === "26 lines", "line count readout");
        check(await evaluate(`document.querySelectorAll("#schematic line").length`) === 26, "schematic draws 26 lines");
        check(await evaluate(`document.getElementById("generate").disabled`) === false, "Generate enabled");
        check(await evaluate(text("appearance-summary")) === "Lines, 0.5 pt, 100%", "appearance summary");
        check(await evaluate(`document.getElementById("toggle-visible").disabled`) === true, "show/hide disabled before any grid exists");
        check(await evaluate(`document.getElementById("panel").dataset.panelMode`) === "grid", "panel opens in Grid mode");
        // Preview is on when the panel opens: the drawing on the artboard is the
        // explanation, so nobody has to know what Generate means first.
        check(await evaluate(`document.getElementById("preview-toggle").checked`) === true, "preview is on when the panel opens");
        // On, but idle: opening the panel must not put anything into a document
        // the user has not touched.
        await sleep(450);
        check(await evaluate(text("status")) === "", "nothing is drawn until the user asks for something");
        check(await evaluate(`window.__mullionTest.groupCount()`) === 0, "and the document is untouched");
        await evaluate(setField("columns", "11"));
        await sleep(450);
        check(/Previewing on Artboard 1/.test(await evaluate(text("status"))), "the first change draws it, with no further asking: " + await evaluate(text("status")));
        await evaluate(setField("columns", "12"));
        await evaluate(`(() => { const t = document.getElementById("preview-toggle"); t.checked = false; t.dispatchEvent(new Event("change")); })()`);
        await sleep(300);
        await load("?theme=dark");
        check(await evaluate(`document.getElementById("preview-toggle").checked`) === false, "turning preview off is remembered");
        await evaluate(`(() => { const t = document.getElementById("preview-toggle"); t.checked = true; t.dispatchEvent(new Event("change")); })()`);
        await sleep(300);
        check(await evaluate(shown("#controls")) && !(await evaluate(shown("#library"))) && !(await evaluate(shown("#construct-card"))), "Grid mode shows only grid settings");
        check(await evaluate(`Array.from(document.querySelectorAll('input[name="type"]')).map(i => i.closest("label").textContent.trim()).join("|")`) === "Columns|Modular|Baseline|Compose|Pattern", "grid types as icon buttons");
        await shoot("dark-columns");

        // ---------------------------------------------------------------- validation
        await evaluate(setField("columns", "0"));
        check(/whole number from 1 to 100/.test(await evaluate(text("err-columns"))), "inline error for zero columns");
        check(await evaluate(`document.querySelector('[name="columns"]').getAttribute("aria-invalid")`) === "true", "aria-invalid set on columns");
        check(await evaluate(`document.getElementById("generate").disabled`) === true, "Generate disabled while invalid");
        check(await evaluate(`document.querySelectorAll("#schematic line").length`) === 0, "schematic hides lines while invalid");
        await evaluate(setField("columns", "12"));
        await evaluate(setField("columnGutter", "60"));
        check(/Columns don't fit/.test(await evaluate(text("err-columnGutter"))), "gutter overflow error");
        await shoot("dark-error");
        await evaluate(setField("columnGutter", "12"));
        check(await evaluate(text("err-columnGutter")) === "", "error clears when fixed");

        // Clicking into a number field selects what is in it, so typing replaces
        // the number. Without this, and without the editing shortcuts the panel
        // claims from the host, "12" becomes "128" and the field feels stuck.
        await evaluate(`(() => { const el = document.querySelector('#settings [name=columns]'); el.value = "12"; el.dispatchEvent(new Event("input", { bubbles: true })); el.blur(); })()`);
        await evaluate(`document.querySelector('#settings [name=columns]').focus()`);
        await sleep(100);
        check(await evaluate(`(() => { const el = document.querySelector('#settings [name=columns]'); return el.selectionStart === 0 && el.selectionEnd === String(el.value).length; })()`) === true ||
            await evaluate(`(() => { const el = document.querySelector('#settings [name=columns]'); try { return el.selectionStart === null; } catch (e) { return true; } })()`),
            "clicking into a number field selects what is in it");
        await evaluate(`(() => { const el = document.querySelector('#settings [name=columnRatios]'); el.focus(); })()`);
        await sleep(100);
        check(await evaluate(`(() => { const el = document.querySelector('#settings [name=columnRatios]'); return el.selectionStart === el.selectionEnd; })()`) === true,
            "a field you type a list into keeps the caret where you put it");

        // The three output choices say what they do to the document.
        check(/non-printing layer/.test(await evaluate(text("output-note"))), "Lines explains itself: " + await evaluate(text("output-note")));
        await evaluate(setField("output", "guides"));
        await sleep(150);
        check(/snaps? to them and they never print/.test(await evaluate(text("output-note"))), "Guides explains itself: " + await evaluate(text("output-note")));
        await evaluate(setField("output", "lines"));

        // ---------------------------------------------------------------- steppers
        const press = (selector) => `(() => {
            const b = document.querySelector(${JSON.stringify(selector)});
            b.dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true }));
            b.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
        })()`;
        await evaluate(press('.stepper__button[data-field="columns"][data-step="1"]'));
        check(await evaluate(value("columns")) === "13", "+ button adds a column");
        await evaluate(press('.stepper__button[data-field="columns"][data-step="-1"]'));
        await evaluate(press('.stepper__button[data-field="columns"][data-step="-1"]'));
        check(await evaluate(value("columns")) === "11", "- button removes columns");
        await evaluate(`document.querySelector('.stepper__button[data-field="columns"][data-step="1"]').dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true }))`);
        await sleep(700);
        await evaluate(`document.querySelector('.stepper__button[data-field="columns"][data-step="1"]').dispatchEvent(new PointerEvent("pointerup", { bubbles: true }))`);
        const held = Number(await evaluate(value("columns")));
        check(held >= 13, "holding + repeats (reached " + held + ")");
        await sleep(200);
        check(Number(await evaluate(value("columns"))) === held, "repeat stops on release");
        await evaluate(setField("columns", "12"));

        // ---------------------------------------------------------------- linked margins
        await evaluate(setField("marginTop", "48"));
        check(await evaluate(value("marginLeft")) === "48", "linked margins follow the edited side");
        await evaluate(click("margin-link"));
        await evaluate(setField("marginLeft", "20"));
        check(await evaluate(value("marginTop")) === "48" && await evaluate(value("marginLeft")) === "20", "unlinked margins are independent");
        await evaluate(click("margin-link"));
        check(await evaluate(value("marginLeft")) === "48", "relinking copies the top margin to all sides");
        await evaluate(setField("marginTop", "36"));

        // ---------------------------------------------------------------- units
        await evaluate(setField("units", "mm"));
        check(await evaluate(value("marginTop")) === "12.7", "36 pt margin converts to 12.7 mm");
        check(await evaluate(`document.querySelector("[data-unit]").textContent`) === "mm", "unit labels update");
        check(await evaluate(text("grid-metrics")) === "Columns 11.99 mm wide", "readout in mm");
        await evaluate(setField("units", "pt"));
        check(await evaluate(value("marginTop")) === "36", "converting back restores 36 pt");
        await evaluate(setField("units", "in"));
        check(await evaluate(value("columnGutter")) === "0.167", "12 pt gutter shows as 0.167 in");
        await evaluate(setField("units", "mm"));
        await evaluate(setField("units", "pt"));
        check(await evaluate(value("columnGutter")) === "12", "pt -> in -> mm -> pt round trip is lossless");
        check(await evaluate(text("grid-metrics")) === "Columns 34 pt wide", "grid unchanged after unit round trip");

        // ---------------------------------------------------------------- types
        await evaluate(setField("type", "modular"));
        check(await evaluate(`document.querySelector('[name="rows"]').closest(".pair").hidden`) === false, "rows visible for modular");
        await evaluate(setField("columns", "6"));
        { const m = await evaluate(text("grid-metrics")); check(m === "Modules 80 × 79.5 pt", "modular readout 80 x 79.5 pt (got: " + m + ")"); }
        check(await evaluate(`document.querySelectorAll("#schematic rect.schematic__track").length`) === 48, "schematic shades 48 modules");
        await shoot("dark-modular");

        // ---------------------------------------------------------------- boxes
        await evaluate(setField("output", "boxes"));
        check(await evaluate(`document.querySelectorAll("#schematic rect.schematic__box").length`) === 48, "boxes output draws 48 module boxes");
        check(await evaluate(text("grid-count")) === "48 boxes", "box count wording");
        check(await evaluate(text("appearance-summary")) === "Boxes, 0.5 pt, 100%", "summary shows boxes");
        await shoot("dark-boxes");
        await evaluate(setField("type", "baseline"));
        check(await evaluate(value("output")) === "lines", "switching to baseline turns boxes back into lines");
        check(/Switched output to lines/.test(await evaluate(text("status"))), "explains the output switch");
        check(await evaluate(`document.querySelector('input[name="output"][value="boxes"]').closest("label").hidden`) === true, "Boxes option hidden for baseline");
        check(await evaluate(text("grid-metrics")) === "61 baselines", "baseline readout");
        check(await evaluate(`document.querySelector('[name="columns"]').closest(".pair").hidden`) === true, "column fields hidden for baseline");
        await evaluate(setField("output", "guides"));
        check(await evaluate(`document.querySelector(".stroke").hidden`) === true, "stroke fields hidden for guides");
        check(await evaluate(text("grid-count")) === "61 guides", "guide count wording");
        await evaluate(setField("output", "lines"));

        // ---------------------------------------------------------------- composition
        await evaluate(setField("type", "composition"));
        check(await evaluate(`document.querySelector(".guides").hidden`) === false, "composition guides visible");
        check(await evaluate(`document.querySelector(".guides").getBoundingClientRect().width > 200 && document.querySelector(".guides .check span").getBoundingClientRect().right <= document.documentElement.clientWidth`) === true, "composition checkboxes laid out full width");
        check(await evaluate(`document.querySelector('[name="extendToEdges"]').closest("label").hidden`) === true, "extend option hidden for composition");
        check(await evaluate(text("grid-metrics")) === "Thirds", "thirds on by default");
        check(await evaluate(text("grid-count")) === "8 lines", "frame + thirds = 8 lines");
        check(await evaluate(`document.querySelector("[data-for-spiral]").hidden`) === true, "spiral focus hidden until spiral is on");
        await evaluate(setField("compSpiral", true));
        await evaluate(setField("compDiagonals", true));
        check(await evaluate(`document.querySelector("[data-for-spiral]").hidden`) === false, "spiral focus shown");
        check(await evaluate(`document.querySelectorAll("#schematic path.schematic__curve").length`) === 1, "schematic draws the spiral curve");
        check(await evaluate(text("grid-metrics")) === "Thirds, Diagonals, Spiral", "guide names listed");
        await shoot("dark-composition");
        await evaluate(setField("compThirds", false));
        await evaluate(setField("compSpiral", false));
        await evaluate(setField("compDiagonals", false));
        check(/at least one composition guide/.test(await evaluate(text("err-composition"))), "needs at least one guide");
        check(await evaluate(`document.getElementById("generate").disabled`) === true, "Generate disabled with no guides");
        await evaluate(setField("compThirds", true));
        await evaluate(setField("type", "columns"));
        await evaluate(setField("columns", "12"));

        // ---------------------------------------------------------------- color
        await evaluate(setField("strokeColor", "#1a8"));
        await evaluate(`document.querySelector('[name="strokeColor"]').dispatchEvent(new Event("change", { bubbles: true }))`);
        check(await evaluate(value("strokeColor")) === "#11AA88", "short hex expands to #11AA88");
        check(await evaluate(`document.querySelector("#schematic line").getAttribute("stroke")`) === "#11AA88", "schematic uses the stroke color");
        await evaluate(setField("strokeColor", "#E0457B"));

        // ---------------------------------------------------------------- patterns
        await evaluate(setField("type", "pattern"));
        check(await evaluate(`document.querySelector('[name="pattern"]').closest(".pair").hidden`) === false, "pattern fields visible");
        check(await evaluate(text("pattern-size-label")) === "Cell size", "size label for square");
        check(await evaluate(text("grid-metrics")) === "Square grid, 24 pt", "square readout");
        const counts = {};
        for (const name of ["square", "dots", "isometric", "hexagon", "diagonal", "radial"]) {
            await evaluate(setField("pattern", name));
            counts[name] = await evaluate(`({ lines: document.querySelectorAll("#schematic line").length, polys: document.querySelectorAll("#schematic polygon").length, dots: document.querySelectorAll("#schematic circle").length, curves: document.querySelectorAll("#schematic path").length, count: document.getElementById("grid-count").textContent })`);
            await shoot("dark-pattern-" + name);
        }
        check(counts.square.lines === 55, "square draws 55 lines (" + counts.square.lines + ")");
        check(counts.dots.dots === 713 && counts.dots.count === "713 dots", "dots draw 713 circles (" + counts.dots.count + ")");
        check(counts.isometric.lines === 113, "isometric draws 113 lines (" + counts.isometric.lines + ")");
        check(counts.hexagon.polys === 228 && counts.hexagon.count === "228 hexagons", "hexagons draw 228 polygons (" + counts.hexagon.count + ")");
        check(counts.diagonal.lines === 108, "diagonal draws 108 lines (" + counts.diagonal.lines + ")");
        check(counts.radial.curves === 6 && counts.radial.lines === 16, "radial draws 6 rings and 12 spokes plus frame");
        check(await evaluate(`document.querySelector('[name="rings"]').closest(".field").hidden`) === false && await evaluate(`document.querySelector('[name="patternSize"]').closest(".field").hidden`) === true, "radial shows rings and spokes, hides size");
        await evaluate(setField("pattern", "dots"));
        check(await evaluate(`document.querySelector('input[name="output"][value="guides"]').closest("label").hidden`) === true, "Guides hidden for dots");
        check(await evaluate(`document.querySelector(".line-style").hidden`) === true, "line style hidden for dots");
        check(await evaluate(`document.querySelector('[name="dotSize"]').closest(".field").hidden`) === false, "dot size shown for dots");
        await evaluate(setField("pattern", "isometric"));
        await evaluate(setField("output", "guides"));
        await evaluate(setField("pattern", "dots"));
        check(await evaluate(value("output")) === "lines" && /can't be guides/.test(await evaluate(text("status"))), "switching to dots moves guides to lines");
        await evaluate(setField("pattern", "hexagon"));
        await evaluate(setField("patternSize", "400"));
        check(/don't fit between the margins/.test(await evaluate(text("err-pattern"))), "oversized hexagons explained inline");
        await evaluate(setField("patternSize", "24"));
        await evaluate(setField("pattern", "square"));

        // ---------------------------------------------------------------- line styles
        await evaluate(setField("type", "modular"));
        await evaluate(setField("columns", "6"));
        await evaluate(setField("lineStyle", "dashed"));
        check(await evaluate(`document.getElementById("schematic").classList.contains("schematic--dashed")`) === true, "dashed drawing");
        check(await evaluate(text("appearance-summary")) === "Lines, 0.5 pt, 100%, dashed", "summary mentions dashed");
        await evaluate(setField("lineStyle", "dotted"));
        check(await evaluate(`document.getElementById("schematic").classList.contains("schematic--dotted")`) === true, "dotted drawing");
        check(await evaluate(`document.querySelector('[data-when="marginColorOn"]').hidden`) === true, "margin color hidden until enabled");
        await evaluate(setField("marginColorOn", true));
        await evaluate(setField("marginColor", "#00AA00"));
        await evaluate(setField("type", "columns"));
        check(await evaluate(`Array.from(document.querySelectorAll("#schematic line")).filter(l => l.getAttribute("stroke") === "#00AA00").length`) === 2, "two margin lines use the margin color");
        await evaluate(setField("shadeGutters", true));
        check(await evaluate(`document.querySelectorAll("#schematic rect.schematic__gutter").length`) === 5, "five gutters shaded for 6 columns");
        await evaluate(setField("gutterOpacity", "150"));
        check(/Gutter opacity must be from 0 to 100/.test(await evaluate(text("err-gutterColor"))), "gutter opacity validated inline");
        await evaluate(setField("gutterOpacity", "15"));
        await shoot("dark-styles");
        await evaluate(setField("type", "baseline"));
        check(await evaluate(`document.querySelector('[data-when="shadeGutters"]').closest(".accent").hidden`) === true, "gutter shading hidden for baseline");
        await evaluate(setField("type", "columns"));
        await evaluate(setField("shadeGutters", false));
        await evaluate(setField("marginColorOn", false));
        await evaluate(setField("lineStyle", "solid"));
        await evaluate(setField("columns", "12"));

        // ---------------------------------------------------------------- artboard targets
        const setTarget = (mode, range) => `(() => {
            const r = document.getElementById("target-range");
            if (${JSON.stringify(range !== undefined)}) { r.value = ${JSON.stringify(range || "")}; }
            const s = document.getElementById("target-mode");
            s.value = ${JSON.stringify(mode)};
            s.dispatchEvent(new Event("change", { bubbles: true }));
        })()`;
        await evaluate(setTarget("all"));
        check(await evaluate(text("grid-count")) === "26 lines × 3", "count shows three artboards");
        await evaluate(setField("columnGutter", "21"));
        check(/^Card: Columns don't fit/.test(await evaluate(text("status"))), "other artboard's error is named: " + await evaluate(text("status")));
        check(await evaluate(`document.getElementById("generate").disabled`) === true, "Generate disabled when any target is invalid");
        await evaluate(setField("columnGutter", "12"));
        check(await evaluate(text("status")) === "", "target error clears when fixed");
        await evaluate(setTarget("range", "1-5"));
        check(await evaluate(`document.getElementById("target-range-row").hidden`) === false, "range field shown");
        check(await evaluate(text("target-range-hint")) === "of 3", "range hint shows artboard count");
        check(/Artboard 5 doesn't exist/.test(await evaluate(text("err-range"))), "range error shown");
        check(await evaluate(`document.getElementById("generate").disabled && document.getElementById("clear").disabled`) === true, "actions disabled for bad range");
        await evaluate(`(() => { const r = document.getElementById("target-range"); r.value = "1, 3"; r.dispatchEvent(new Event("input", { bubbles: true })); })()`);
        check(await evaluate(text("err-range")) === "", "range error clears");
        await shoot("dark-range");
        await evaluate(click("generate"));
        await sleep(300);
        check(/Added a column grid to 2 artboards \(52 shapes\)/.test(await evaluate(text("status"))), "generate on range: " + await evaluate(text("status")));

        // ---------------------------------------------------------------- layer toggles
        check(await evaluate(`document.getElementById("toggle-visible").disabled`) === false, "show/hide enabled once a grid exists");
        check(await evaluate(`document.getElementById("toggle-lock").dataset.engaged`) === "true", "lock shows engaged (grids locked by default)");
        await evaluate(click("toggle-visible"));
        await sleep(200);
        check(await evaluate(text("status")) === "Grids hidden.", "hide grids");
        check(await evaluate(`document.getElementById("toggle-visible").title`) === "Show grids", "button now offers Show grids");
        await evaluate(click("toggle-visible"));
        await sleep(200);
        check(await evaluate(text("status")) === "Grids shown.", "show grids");
        await evaluate(click("toggle-lock"));
        await sleep(200);
        check(await evaluate(text("status")) === "Grids unlocked.", "unlock grids");
        check(await evaluate(`document.getElementById("toggle-lock").dataset.engaged`) === "false", "lock no longer engaged");
        await evaluate(click("toggle-lock"));
        await sleep(200);

        await evaluate(click("clear"));
        await sleep(300);
        check(/Cleared 2 grids from 2 artboards/.test(await evaluate(text("status"))), "clear on range: " + await evaluate(text("status")));
        await evaluate(setTarget("active"));

        // ---------------------------------------------------------------- preview and generate
        await evaluate(`(() => { const t = document.getElementById("preview-toggle"); t.checked = true; t.dispatchEvent(new Event("change")); })()`);
        await sleep(450);
        check(/Previewing on Artboard 1/.test(await evaluate(text("status"))), "preview runs after debounce: " + await evaluate(text("status")));
        await evaluate(setField("columns", "8"));
        await evaluate(setField("columns", "9"));
        await evaluate(setField("columns", "10"));
        await sleep(450);
        check(/Previewing/.test(await evaluate(text("status"))), "rapid edits still end in a preview");
        await evaluate(setField("type", "pattern"));
        await evaluate(setField("pattern", "dots"));
        await evaluate(setField("patternSize", "9"));
        await sleep(450);
        check(/Preview paused: 4,941 shapes/.test(await evaluate(text("status"))) && await evaluate(`document.getElementById("status").dataset.tone`) === "warning", "huge grids pause live preview: " + await evaluate(text("status")));
        await evaluate(setField("patternSize", "24"));
        await evaluate(setField("pattern", "square"));
        await evaluate(setField("type", "columns"));
        await sleep(450);
        check(/Previewing/.test(await evaluate(text("status"))), "preview resumes for smaller grids: " + await evaluate(text("status")));
        await evaluate(click("generate"));
        await sleep(300);
        check(/Added a column grid to Artboard 1 \(22 shapes\)/.test(await evaluate(text("status"))), "generate reports result: " + await evaluate(text("status")));
        check(await evaluate(`document.getElementById("preview-toggle").checked`) === true, "Generate keeps Preview on");
        await sleep(500);
        check(await evaluate(`document.getElementById("preview-toggle").checked`) === true, "preview is still on once Generate has finished");
        check(/Added a column grid to Artboard 1/.test(await evaluate(text("status"))), "the preview resuming after Generate keeps Generate's message: " + await evaluate(text("status")));
        await shoot("dark-generated");
        await evaluate(click("generate"));
        await sleep(300);
        check(/Replaced 1 grid on Artboard 1 with a column grid/.test(await evaluate(text("status"))), "generating again replaces: " + await evaluate(text("status")));
        await evaluate(`(() => { const c = document.getElementById("add-mode"); c.checked = true; c.dispatchEvent(new Event("change", { bubbles: true })); })()`);
        await evaluate(setField("type", "baseline"));
        await evaluate(click("generate"));
        await sleep(300);
        check(/Added a baseline grid to Artboard 1/.test(await evaluate(text("status"))), "add mode combines grids: " + await evaluate(text("status")));
        await evaluate(`(() => { const c = document.getElementById("add-mode"); c.checked = false; c.dispatchEvent(new Event("change", { bubbles: true })); })()`);
        await evaluate(setField("type", "columns"));
        await evaluate(click("clear"));
        await sleep(300);
        check(/Cleared 2 grids from Artboard 1/.test(await evaluate(text("status"))), "clear reports result: " + await evaluate(text("status")));
        check(await evaluate(`document.getElementById("preview-toggle").checked`) === false &&
            /Preview is off/.test(await evaluate(text("status"))), "Clear stops previewing and says so: " + await evaluate(text("status")));

        // ---------------------------------------------------------------- presets and persistence
        await evaluate(click("preset-new"));
        check(await evaluate(`document.getElementById("preset-save-row").hidden`) === false, "save row opens");
        await evaluate(`document.getElementById("preset-name").value = "Magazine 10"`);
        await evaluate(click("preset-save"));
        check(await evaluate(`Array.from(document.getElementById("preset-select").options).map(o => o.value).join("|")`) === "|user:Magazine 10", "preset saved and listed");
        check(await evaluate(`document.getElementById("preset-save-row").hidden`) === true, "save row closes");
        await evaluate(click("reset"));
        check(await evaluate(value("columns")) === "12", "reset restores defaults");
        await evaluate(`(() => { const s = document.getElementById("preset-select"); s.value = "user:Magazine 10"; s.dispatchEvent(new Event("change")); })()`);
        check(await evaluate(value("columns")) === "10", "loading preset restores 10 columns");
        await evaluate(click("stage-toggle"));
        check(await evaluate(`document.querySelector(".stage").classList.contains("stage--collapsed")`) === true, "drawing collapses");
        await sleep(400);
        await load("?theme=dark");
        check(await evaluate(value("columns")) === "10", "settings persist across reloads");
        check(await evaluate(`document.querySelector(".stage").classList.contains("stage--collapsed")`) === true, "collapsed drawing persists");
        await shoot("dark-collapsed");
        await evaluate(click("stage-toggle"));
        await evaluate(`(() => { const s = document.getElementById("preset-select"); s.value = "user:Magazine 10"; s.dispatchEvent(new Event("change")); })()`);
        await evaluate(click("preset-delete"));
        check(await evaluate(`document.getElementById("preset-select").options.length`) === 1, "preset deleted");

        // ---------------------------------------------------------------- layout library
        const chip = (name) => `(() => { const s = document.getElementById("library-filter"); s.value = ${JSON.stringify(name)}; s.dispatchEvent(new Event("change", { bubbles: true })); })()`;
        await evaluate(setField("strokeColor", "#123456"));
        await evaluate(mode("layouts"));
        await sleep(150);
        check(await evaluate(shown("#library")) && !(await evaluate(shown("#settings"))) && !(await evaluate(shown("#controls"))), "Layouts mode replaces the settings area");
        check(await evaluate(`document.getElementById("generate").disabled`) === false, "Generate works straight from Layouts");
        const groups = await evaluate(`Array.from(document.querySelectorAll("#library-filter optgroup")).map(g => g.label).join("|")`);
        check(groups === "Simple grids|Made for a page size|Classic systems|Patterns", "the menu groups layouts in plain language: " + groups);
        const options = await evaluate(`Array.from(document.querySelectorAll("#library-filter option")).map(o => o.textContent).join(" | ")`);
        check(/Made for this page \(\d+\)/.test(options) && /All layouts \(128\)/.test(options), "each choice says how many layouts it holds: " + options);
        check(await evaluate(`document.getElementById("library-filter").value`) === "Suggested", "the library opens on layouts made for this page");
        check(await evaluate(`document.querySelectorAll("#library-chips").length`) === 0, "the old chip row is gone");
        await evaluate(chip("Systems"));
        await sleep(300);
        const systems = await evaluate(`Array.from(document.querySelectorAll("#library-grid .tile .tile__name")).map(t => t.textContent)`);
        check(["Golden spiral", "Harmonic armature", "Dynamic rectangle", "Villard's figure", "Rule of fifths", "Compound grid 3 + 4", "Hierarchical grid", "Manuscript grid"].every((n) => systems.includes(n)), "Systems lists the grid systems (" + systems.join(", ") + ")");
        check(await evaluate(`getComputedStyle(document.querySelector("#library-grid .tile svg line, #library-grid .tile svg path")).stroke`) === await evaluate(`getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() && (() => { const d = document.createElement("div"); d.style.color = getComputedStyle(document.documentElement).getPropertyValue("--accent"); document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; })()`), "tiles draw in the panel accent");
        await shoot("dark-library-systems");
        await evaluate(chip("Suggested"));
        await sleep(200);
        const suggested = await evaluate(`Array.from(document.querySelectorAll("#library-grid .tile")).map(t => t.dataset.layout)`);
        check(suggested.includes("letter-3"), "Letter suggestions include US Letter, 3 columns (" + suggested.join(", ") + ")");
        await sleep(300);
        check(await evaluate(`document.querySelectorAll("#library-grid .tile svg rect.schematic__paper").length`) >= 3, "visible tiles draw live thumbnails");
        await shoot("dark-library-suggested");

        await evaluate(chip("All"));
        check(await evaluate(`document.querySelectorAll("#library-grid .tile").length`) >= 100, "All shows about a hundred layouts");
        await evaluate(chip("Modular"));
        check(await evaluate(`document.querySelectorAll("#library-grid .tile").length`) === 20, "Modular shows 20 layouts");
        await sleep(300);
        await shoot("dark-library-modular");
        await evaluate(`document.querySelector('#library-grid .tile[data-layout="modular-4x6"]').click()`);
        check(await evaluate(value("type")) === "modular" && await evaluate(value("columns")) === "4" && await evaluate(value("rows")) === "6", "clicking a tile applies 4 × 6 modules");
        check(await evaluate(value("marginTop")) === "36.7", "relative margins sized for the 612 pt artboard (" + await evaluate(value("marginTop")) + ")");
        check(/Applied “4 × 6 modules”. Margins are sized for this artboard./.test(await evaluate(text("status"))), "apply message");
        check(await evaluate(`document.querySelector("#status .link-button").textContent`) === "Edit settings", "apply offers Edit settings");
        check(await evaluate(`document.querySelector('#library-grid .tile[data-layout="modular-4x6"]').getAttribute("aria-pressed")`) === "true", "applied tile is marked");
        check(await evaluate(value("strokeColor")) === "#123456", "layouts keep the user's appearance");
        check((await evaluate(text("grid-metrics"))).startsWith("Modules"), "main drawing updates behind the library");

        await evaluate(`(() => { const s = document.getElementById("library-search"); s.value = "canon"; s.dispatchEvent(new Event("input", { bubbles: true })); })()`);
        check(await evaluate(`document.querySelectorAll("#library-grid .tile").length`) === 3, "search finds the 3 Van de Graaf canon layouts");
        await evaluate(`document.querySelector('#library-grid .tile[data-layout="classic-van-de-graaf-right"]').click()`);
        check(await evaluate(value("marginRight")) === "136" && await evaluate(value("marginBottom")) === "176", "canon margins: 2/9 of width (136) and height (176)");
        check(await evaluate(`document.getElementById("margin-link").getAttribute("aria-pressed")`) === "false", "uneven margins unlink the margin fields");
        await evaluate(`(() => { const s = document.getElementById("library-search"); s.value = "zzz"; s.dispatchEvent(new Event("input", { bubbles: true })); })()`);
        check(/No layouts match “zzz”/.test(await evaluate(text("library-hint"))), "empty search result explained");

        await evaluate(`(() => { const s = document.getElementById("library-search"); s.value = ""; s.dispatchEvent(new Event("input", { bubbles: true })); })()`);
        await evaluate(chip("Screen"));
        await evaluate(`document.querySelector('#library-grid .tile[data-layout="web-1440"]').click()`);
        check(await evaluate(value("units")) === "px" && await evaluate(value("marginLeft")) === "120", "fixed web layout keeps px and 120 margins");
        check(/Made for a 1440 × 1024 px artboard./.test(await evaluate(text("status"))), "fixed layout names its artboard");
        await evaluate(`(() => { const s = document.getElementById("library-search"); s.value = "letter, 3"; s.dispatchEvent(new Event("input", { bubbles: true })); })()`);
        await evaluate(`document.querySelector('#library-grid .tile[data-layout="letter-3"]').click()`);
        check(await evaluate(value("units")) === "in" && await evaluate(value("columnGutter")) === "0.25" && await evaluate(value("marginTop")) === "0.75",
            "an inch layout brings its own units and lengths (0.25 in gutter, 0.75 in top margin), got " +
            await evaluate(value("units")) + " " + await evaluate(value("columnGutter")) + " " + await evaluate(value("marginTop")));
        await evaluate(`(() => { const s = document.getElementById("library-search"); s.value = ""; s.dispatchEvent(new Event("input", { bubbles: true })); })()`);
        await evaluate(chip("Patterns"));
        await sleep(500);
        // A 5 mm grid on an A4 page cannot be drawn whole in a 120 px tile: it
        // comes out a solid block, and every fine pattern looks like the next.
        const tileViews = await evaluate(`Array.from(document.querySelectorAll("#library-grid .tile")).slice(0, 8).map((t) => ({
            name: t.querySelector(".tile__name").textContent,
            zoomed: t.querySelector("svg").getAttribute("viewBox") !== "0 0 612 792" && t.querySelector("svg").getAttribute("viewBox") !== "0 0 595.2755905511812 841.8897637795277",
            marks: t.querySelectorAll("svg circle, svg line, svg polygon").length
        }))`);
        check(tileViews.filter((t) => t.zoomed).length >= 4, "dense patterns show a legible piece of the page: " + tileViews.map((t) => t.name + (t.zoomed ? " (piece)" : " (whole page)")).join(", "));
        check(tileViews.every((t) => t.marks <= 600), "and no tile draws more marks than it can show: " + Math.max(...tileViews.map((t) => t.marks)));
        // A tile is an icon of the layout: it must look the same whatever the
        // panel's own appearance settings are.
        await evaluate(mode("grid"));
        await evaluate(setField("type", "columns"));
        await evaluate(setField("output", "boxes"));
        await evaluate(mode("layouts"));
        await evaluate(chip("Columns"));
        await sleep(700);
        const asBoxes = await evaluate(`Array.from(document.querySelectorAll("#library-grid .tile")).slice(0, 4).map((t) => t.querySelectorAll("svg line").length)`);
        check(asBoxes.every((n) => n > 0), "tiles still draw the grid as lines while the panel is set to Boxes: " + asBoxes.join(", "));
        await evaluate(mode("grid"));
        await evaluate(setField("output", "lines"));
        await evaluate(mode("layouts"));
        await evaluate(chip("Patterns"));
        await sleep(600);
        check(/Fits this artboard|Made for /.test(await evaluate(`document.querySelector("#library-grid .tile .tile__meta").textContent`)), "each tile says whether it fits this page: " + await evaluate(`document.querySelector("#library-grid .tile .tile__meta").textContent`));
        await evaluate(`document.querySelector('#library-grid .tile[data-layout="dots-5mm"]').click()`);
        check(await evaluate(value("type")) === "pattern" && await evaluate(value("pattern")) === "dots", "pattern layout applies");
        await sleep(300);
        await shoot("dark-library-patterns");

        await evaluate(`document.getElementById("library-search").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
        check(await evaluate(`document.getElementById("panel").dataset.panelMode`) === "grid" && !(await evaluate(shown("#library"))), "Escape returns to Grid");
        check(await evaluate(`document.activeElement.value`) === "layouts", "focus returns to the Layouts tab");
        check(await evaluate(value("pattern")) === "dots" && await evaluate(shown('[name="patternSize"]')), "Grid mode shows the applied layout's settings");
        await evaluate(mode("layouts"));
        check(await evaluate(`document.getElementById("library-filter").value`) === "Patterns", "the library reopens on the last choice");
        await evaluate(chip("Modular"));
        await evaluate(`document.querySelector('#library-grid .tile[data-layout="modular-4x6"]').click()`);
        await evaluate(`document.querySelector("#status .link-button").click()`);
        check(await evaluate(`document.getElementById("panel").dataset.panelMode`) === "grid", "Edit settings switches to Grid");
        await evaluate(click("reset"));
        await evaluate(setField("strokeColor", "#E0457B"));

        // ---------------------------------------------------------------- new layout controls
        await evaluate(click("reset"));
        await evaluate(setField("columnRatios", "2 1 1"));
        check(await evaluate(text("grid-count")) === "8 lines", "2 1 1 widths draw 3 columns (6 edges + 2 margins)");
        check((await evaluate(text("grid-metrics"))).startsWith("Columns 2 : 1 : 1") || (await evaluate(text("grid-metrics"))).startsWith("Columns"), "readout for unequal columns: " + await evaluate(text("grid-metrics")));
        await evaluate(setField("columnRatios", "2 x"));
        check(/positive numbers separated by spaces/.test(await evaluate(text("err-columnRatios"))), "bad widths explained");
        await evaluate(setField("columnRatios", ""));
        check(await evaluate(`document.querySelector("[data-baseline-fields]").hidden`) === true, "baseline fields hidden until enabled");
        await evaluate(setField("addBaseline", true));
        check(await evaluate(`document.querySelector("[data-baseline-fields]").hidden`) === false, "baseline fields shown with Add a baseline grid");
        check(await evaluate(text("grid-count")) === "85 lines", "12 columns + 12 pt baseline = 85 lines");
        await evaluate(click("leading-from-text"));
        await sleep(250);
        check(await evaluate(value("baselineSpacing")) === "14", "From text sets the baseline to 14 pt");
        check(/Baseline set to 14 pt from the selected text \(Helvetica, 11\/14\)/.test(await evaluate(text("status"))), "leading message");
        await evaluate(setField("addBaseline", false));

        // blocks: drag across modules in the drawing
        await evaluate(setField("type", "modular"));
        await evaluate(setField("columns", "4"));
        await evaluate(setField("rows", "4"));
        // Points are module centers in the drawing's own coordinates (Letter, 36 pt margins, 4 x 4 modules,
        // 12 pt gutters: modules are 129 x 171 pt), mapped to the screen with the SVG's transform.
        const center = (column, row) => [36 + column * 141 + 64.5, 36 + row * 183 + 85.5];
        const dragBlock = (from, to) => `(() => {
            const svg = document.getElementById("schematic");
            const ctm = svg.getScreenCTM();
            const at = ([x, y]) => {
                const p = svg.createSVGPoint();
                p.x = x; p.y = y;
                const s = p.matrixTransform(ctm);
                return { clientX: s.x, clientY: s.y, button: 0, pointerId: 1, bubbles: true };
            };
            svg.dispatchEvent(new PointerEvent("pointerdown", at(${JSON.stringify(from)})));
            svg.dispatchEvent(new PointerEvent("pointermove", at(${JSON.stringify(to)})));
            svg.dispatchEvent(new PointerEvent("pointerup", at(${JSON.stringify(to)})));
        })()`;
        await evaluate(dragBlock(center(0, 0), center(1, 0)));
        check(/Marked a 2 × 1 block/.test(await evaluate(text("status"))), "dragging marks a block: " + await evaluate(text("status")));
        check(await evaluate(`document.querySelectorAll("#schematic rect.schematic__block").length`) === 1, "block drawn");
        check(/1 block marked/.test(await evaluate(text("blocks-summary"))), "block summary");
        await shoot("dark-blocks");
        await evaluate(dragBlock(center(1, 0), center(1, 0)));
        check(await evaluate(`document.querySelectorAll("#schematic rect.schematic__block").length`) === 0, "clicking a block removes it");
        await evaluate(dragBlock(center(2, 2), center(2, 2)));
        await evaluate(click("blocks-clear"));
        check(await evaluate(`document.querySelectorAll("#schematic rect.schematic__block").length`) === 0, "Clear blocks removes all");
        await evaluate(setField("type", "columns"));
        await evaluate(setField("columns", "12"));

        // resize
        await evaluate(`document.querySelector("#align-section").open = true; document.querySelectorAll("details.section")[2].open = true;`);
        await evaluate(`(() => { const s = document.getElementById("format-select"); s.value = "a4"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
        await evaluate(click("format-rotate"));
        check((await evaluate(`document.getElementById("format-select").selectedOptions[0].textContent`)) === "A4 (297 × 210 mm)", "rotate swaps the format label");
        await evaluate(click("format-rotate"));
        await evaluate(click("format-apply"));
        await sleep(300);
        check(/Resized Artboard 1 to A4 \(210 × 297 mm\)/.test(await evaluate(text("status"))), "resize message: " + await evaluate(text("status")));
        check(await evaluate(text("artboard-size")) === "595.276 × 841.89 pt", "readout shows the new size: " + await evaluate(text("artboard-size")));

        // layout made for another size offers a resize
        await evaluate(mode("layouts"));
        await evaluate(`(() => { const s = document.getElementById("library-search"); s.value = "portrait post"; s.dispatchEvent(new Event("input", { bubbles: true })); })()`);
        await evaluate(`document.querySelector('#library-grid .tile[data-layout="portrait-post"]').click()`);
        const offered = await evaluate(`Array.from(document.querySelectorAll("#status .link-button")).map(b => b.textContent).join("|")`);
        check(offered === "Edit settings|Resize artboard to 1080 × 1350 px", "a second offer is added beside the first, not instead of it: " + offered);
        check(!/Edit settings/.test(await evaluate(`document.getElementById("status").firstChild.textContent`)), "the message itself never swallows an action's label: " + await evaluate(`document.getElementById("status").firstChild.textContent`));
        await evaluate(`Array.from(document.querySelectorAll("#status .link-button")).find(b => /^Resize/.test(b.textContent)).click()`);
        await sleep(300);
        check(await evaluate(text("artboard-size")) === "1080 × 1350 px", "one click resizes to the layout's size: " + await evaluate(text("artboard-size")));
        await evaluate(mode("grid"));

        // export / import
        await evaluate(click("reset"));
        await evaluate(click("preset-new"));
        await evaluate(`document.getElementById("preset-name").value = "Shared grid"`);
        await evaluate(click("preset-save"));
        const exported = await evaluate(`window.__mullionTest.presetFileText()`);
        check(JSON.parse(exported).presets[0].name === "Shared grid", "export file contains the preset");
        await evaluate(`window.__mullionTest.importPresetText(${JSON.stringify(exported)})`);
        check(await evaluate(`Array.from(document.getElementById("preset-select").options).map(o => o.textContent).join("|")`) === "Your presets|Shared grid|Shared grid (2)", "import keeps both presets with a numbered name");
        await evaluate(`window.__mullionTest.importPresetText("nonsense")`);
        check(/isn't a presets file/.test(await evaluate(text("status"))), "bad import explained");

        // grids inside selected objects, and aligning them
        await load("?theme=dark&selection");
        check(await evaluate(`localStorage.getItem("mullion.presets.v1").includes("Shared grid")`) === true, "presets survive the reload");
        await evaluate(`(() => { const s = document.getElementById("target-mode"); s.value = "selection"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
        await sleep(250);
        check(await evaluate(text("artboard-name")) === "Object 1 of 2", "readout names the selected objects");
        check(await evaluate(text("artboard-size")) === "200 × 200 pt", "drawing shows the first object's size");
        await evaluate(setField("marginTop", "10"));
        await evaluate(setField("columns", "2"));
        await evaluate(setField("columnGutter", "10"));
        await evaluate(click("generate"));
        await sleep(300);
        check(/Added a column grid to 2 objects/.test(await evaluate(text("status"))), "generate inside objects: " + await evaluate(text("status")));
        await shoot("dark-selection");
        await evaluate(setField("marginTop", "150"));
        check(/less than the object height of 200 pt/.test(await evaluate(text("err-margins"))), "object-sized validation wording");
        await evaluate(setField("marginTop", "10"));
        await evaluate(`(() => { const s = document.getElementById("target-mode"); s.value = "active"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
        await evaluate(`document.querySelector("#align-section").open = true`);
        await evaluate(setField("marginTop", "36"));
        await evaluate(click("align-check"));
        await sleep(250);
        check(/2 of 2 objects are off the grid/.test(await evaluate(text("status"))), "check reports off-grid objects: " + await evaluate(text("status")));
        check(await evaluate(`document.querySelector("#status .link-button").textContent`) === "Snap to grid", "check offers Snap to grid");
        await evaluate(`document.querySelector("#status .link-button").click()`);
        await sleep(250);
        check(/Snapped 2 objects to the grid/.test(await evaluate(text("status"))), "snap: " + await evaluate(text("status")));
        await evaluate(click("align-check"));
        await sleep(250);
        check(/All 2 objects sit on the grid/.test(await evaluate(text("status"))), "re-check after snapping");
        await evaluate(`(() => { const s = document.getElementById("target-mode"); s.value = "selection"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
        check(await evaluate(`document.getElementById("format-apply").disabled`) === true, "resize is off while targeting objects");

        // ---------------------------------------------------------------- construct
        await evaluate(mode("construct"));
        await sleep(300);
        check(await evaluate(shown("#construct-card")) && !(await evaluate(shown("#controls"))) && !(await evaluate(shown('[name="columns"]'))), "Construct mode shows construction settings only");
        check(await evaluate(`document.getElementById("construct-card").dataset.state`) === "ready", "construct card sees the selected artwork");
        check(await evaluate(text("construct-title")) === "Artwork selected", "construct title: " + await evaluate(text("construct-title")));
        check(await evaluate(`document.querySelectorAll("#schematic path.schematic__artwork").length`) === 3, "drawing shows the selected artwork");
        check(await evaluate(`document.querySelectorAll("#schematic path.schematic__curve").length`) === 1, "the round part gets a circle");
        const conStrokes = await evaluate(`Array.from(new Set(Array.from(document.querySelectorAll("#schematic line, #schematic path.schematic__curve")).map(l => l.getAttribute("stroke")))).sort().join("|")`);
        check(conStrokes === "#2F7CF6|#8C93A1|#E0457B", "bounds, key lines, and circles use their own colors: " + conStrokes);
        check(/key lines, 1 circle/.test(await evaluate(text("grid-metrics"))), "construct readout: " + await evaluate(text("grid-metrics")));
        await shoot("dark-construct");
        await evaluate(setField("conCircleColor", "#00AA00"));
        check(await evaluate(`document.querySelector("#schematic path.schematic__curve").getAttribute("stroke")`) === "#00AA00", "circle color applies");
        await evaluate(setField("conCircleColor", "zz"));
        check(await evaluate(text("err-construction")) !== "" && await evaluate(`document.getElementById("generate").disabled`) === true, "bad construction color explained: " + await evaluate(text("err-construction")));
        await evaluate(setField("conCircleColor", "#E0457B"));
        check(!(await evaluate(shown('[name="conPadding"]'))), "padding hidden while lines cross the artboard");
        await evaluate(setField("conExtend", "bounds"));
        check(await evaluate(shown('[name="conPadding"]')), "padding shown for lines around the artwork");
        await evaluate(setField("conCenter", true));
        await evaluate(setField("conDiagonals", true));
        await evaluate(click("generate"));
        await sleep(300);
        check(/Drew construction lines for the selected artwork/.test(await evaluate(text("status"))), "generate construction: " + await evaluate(text("status")));
        check(await evaluate(`document.getElementById("status").dataset.tone`) === "ok", "success message styled as success");
        await evaluate(click("generate"));
        await sleep(300);
        check(/Redrew the construction lines/.test(await evaluate(text("status"))), "generating again replaces construction lines");
        await evaluate(click("clear"));
        await sleep(300);
        check(/Cleared construction lines from Artboard 1/.test(await evaluate(text("status"))), "clear construction: " + await evaluate(text("status")));
        await evaluate(setField("conExtend", "artboard"));
        await evaluate(setField("conCenter", false));
        await evaluate(setField("conDiagonals", false));
        await sleep(400);
        await load("?theme=dark&selection");
        check(await evaluate(`document.getElementById("panel").dataset.panelMode`) === "construct", "mode persists across reloads");
        await evaluate(mode("grid"));
        await load("?theme=dark");
        await evaluate(mode("construct"));
        await sleep(300);
        check(await evaluate(`document.getElementById("construct-card").dataset.state`) === "empty" && await evaluate(text("construct-title")) === "No artwork selected", "construct explains an empty selection");
        check(await evaluate(`document.getElementById("generate").disabled`) === true, "Generate disabled without artwork");
        await shoot("dark-construct-empty");
        await evaluate(mode("grid"));

        // ---------------------------------------------------------------- systems, quick colors, slider
        await evaluate(click("reset"));
        await evaluate(setField("type", "composition"));
        await evaluate(setField("compThirds", false));
        await evaluate(setField("compArmature", true));
        check(await evaluate(text("grid-metrics")) === "Armature", "armature readout");
        await evaluate(setField("compVillard", true));
        check(await evaluate(text("grid-metrics")) === "Armature, Villard", "Villard readout");
        await evaluate(setField("compArmature", false));
        await evaluate(setField("compVillard", false));
        await evaluate(setField("compThirds", true));
        await evaluate(setField("type", "modular"));
        await evaluate(setField("squareModules", true));
        { const m = await evaluate(text("grid-metrics")); const parts = m.replace("Modules ", "").replace(" pt", "").split(" × "); check(parts.length === 2 && parts[0] === parts[1], "square modules readout: " + m); }
        await evaluate(setField("squareModules", false));
        await evaluate(setField("type", "columns"));
        await evaluate(`document.querySelector('.quick-color[data-color="#2F7CF6"]').click()`);
        check(await evaluate(value("strokeColor")) === "#2F7CF6" && await evaluate(`document.querySelector('.quick-color[data-color="#2F7CF6"]').getAttribute("aria-pressed")`) === "true", "quick color sets the stroke color");
        await evaluate(`(() => { const s = document.getElementById("opacity-slider"); s.value = "40"; s.dispatchEvent(new Event("input", { bubbles: true })); })()`);
        check(await evaluate(value("opacity")) === "40" && await evaluate(text("appearance-summary")) === "Lines, 0.5 pt, 40%", "opacity slider updates the field");
        await evaluate(setField("opacity", "70"));
        check(await evaluate(`document.getElementById("opacity-slider").value`) === "70", "slider follows the field");
        await evaluate(click("reset"));

        // An optional field reads as off when it is off.
        check(await evaluate(value("overlayColumns")) === "" && await evaluate(`document.querySelector('[name=overlayColumns]').placeholder`) === "Off",
            "a second set of columns is blank until you ask for one");
        await evaluate(setField("overlayColumns", "4"));
        await sleep(250);
        check(/overlay|4/.test(await evaluate(text("grid-count"))) || await evaluate(value("overlayColumns")) === "4", "and takes a number when you do");
        await evaluate(setField("overlayColumns", ""));
        await sleep(250);
        check(await evaluate(text("err-overlay")) === "", "clearing it turns it off rather than complaining: " + await evaluate(text("err-overlay")));

        // -------------------------------------------------------------- overlays
        await evaluate(click("reset"));
        await evaluate(setTarget("active"));
        const overlayChip = (type) => `(() => { const i = document.querySelector('#overlay-types input[value=' + ${JSON.stringify(type)} + ']'); i.checked = !i.checked; i.dispatchEvent(new Event("change", { bubbles: true })); })()`;
        const overlayOffered = await evaluate(`Array.from(document.querySelectorAll("#overlay-types input")).map(i => i.value).join("|")`);
        check(overlayOffered === "modular|baseline|composition|pattern", "every type except the one you are drawing can be added on top: " + overlayOffered);

        await evaluate(overlayChip("baseline"));
        await sleep(200);
        check(/column grid \+ baseline grid/.test(await evaluate(text("grid-metrics"))), "the readout names both grids: " + await evaluate(text("grid-metrics")));
        const overlaid = await evaluate(`document.querySelectorAll("#schematic line").length`);
        check(overlaid > 26, "the drawing shows both grids (" + overlaid + " lines, 26 for columns alone)");
        await shoot("dark-overlay");

        await evaluate(click("generate"));
        await sleep(400);
        check(/Added a column grid/.test(await evaluate(text("status"))), "generate draws them together: " + await evaluate(text("status")));
        check(await evaluate(`window.__mullionTest.groupCount()`) === 2, "two grids on the artboard, one per type");
        await evaluate(click("generate"));
        await sleep(400);
        check(/Replaced 2 grids/.test(await evaluate(text("status"))), "generating again replaces the whole stack: " + await evaluate(text("status")));
        await evaluate(click("clear"));
        await sleep(400);

        // Switching the main type to one that is already an overlay drops it.
        await evaluate(overlayChip("pattern"));
        await evaluate(setField("type", "pattern"));
        await sleep(200);
        check(await evaluate(`Array.from(document.querySelectorAll("#overlay-types input")).map(i => i.value).join("|")`) === "columns|modular|baseline|composition", "a grid is never offered as an overlay of itself");
        await evaluate(click("reset"));

        // ------------------------------------------------- settings from the document
        await evaluate(click("reset"));
        await evaluate(`document.querySelectorAll("details.section").forEach((d) => { d.open = true; })`);
        await evaluate(setTarget("active"));
        await evaluate(click("load-document-grid"));
        await sleep(300);
        check(/No GridComposer grid on this artboard/.test(await evaluate(text("status"))), "nothing to read before a grid exists: " + await evaluate(text("status")));
        await evaluate(setField("columns", "5"));
        await evaluate(click("generate"));
        await sleep(300);
        await evaluate(click("reset"));
        check(await evaluate(value("columns")) === "12", "reset returns to the default");
        // With Preview on, the routine "Previewing…" message must not talk over
        // the result of an action the user asked for.
        await evaluate(`(() => { const t = document.getElementById("preview-toggle"); t.checked = true; t.dispatchEvent(new Event("change")); })()`);
        await sleep(450);
        await evaluate(click("load-document-grid"));
        await sleep(700);
        check(await evaluate(value("columns")) === "5" && /Loaded the settings that drew this grid/.test(await evaluate(text("status"))), "a grid hands its settings back, and previewing doesn't talk over it: " + await evaluate(text("status")));
        await evaluate(`(() => { const t = document.getElementById("preview-toggle"); t.checked = false; t.dispatchEvent(new Event("change")); })()`);
        await sleep(300);
        await evaluate(click("clear"));
        await sleep(300);

        // ---------------------------------------------------------------- InDesign vocabulary and page settings
        await load("?theme=dark&host=indesign");
        await evaluate(`(() => { const s = document.getElementById("target-mode"); s.value = "active"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
        check(await evaluate(`Array.from(document.getElementById("target-mode").options).map(o => o.textContent).join("|")`) === "This page|All pages|Chosen pages|Selected objects", "InDesign says pages");
        check(await evaluate(text("artboard-name")) === "Page 1", "InDesign page name in the readout");
        check(await evaluate(`document.querySelector('[data-host-only="indesign"]').hidden`) === false, "page margins control shown in InDesign");
        await evaluate(click("page-margins"));
        await sleep(250);
        check(/Set margins and columns on Page 1|Set margins and columns on 1 page/.test(await evaluate(text("status"))), "page margins message: " + await evaluate(text("status")));
        await load("?theme=dark");
        check(await evaluate(`document.querySelector('[data-host-only="indesign"]').hidden`) === true, "page margins control hidden in Illustrator");

        // ---------------------------------------------------------------- keyboard
        await evaluate(`(() => { const el = document.querySelector('[name="columnGutter"]'); el.value = "12"; el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", shiftKey: true, bubbles: true })); })()`);
        check(await evaluate(value("columnGutter")) === "22", "Shift+ArrowUp steps by 10");
        await evaluate(setField("columnGutter", "12"));

        // ---------------------------------------------------------------- unit-aware steps
        const stepOf = (name) => `document.querySelector('[name=${JSON.stringify(name)}]').step`;
        check(await evaluate(stepOf("columnGutter")) === "1", "lengths step by 1 pt in points");
        await evaluate(setField("units", "mm"));
        check(await evaluate(stepOf("columnGutter")) === "0.5" && await evaluate(stepOf("marginTop")) === "0.5", "lengths step by 0.5 mm in millimeters");
        await evaluate(setField("units", "in"));
        check(await evaluate(stepOf("columnGutter")) === "0.05" && await evaluate(stepOf("patternSize")) === "0.05", "lengths step by 0.05 in in inches, not a whole inch");
        const inchGutter = Number(await evaluate(value("columnGutter")));
        await evaluate(`(() => { const el = document.querySelector('[name="columnGutter"]'); el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", shiftKey: true, bubbles: true })); })()`);
        check(Math.abs(Number(await evaluate(value("columnGutter"))) - (inchGutter + 0.5)) < 0.0005,
            "Shift+ArrowUp moves an inch gutter by 0.5 in (" + inchGutter + " -> " + await evaluate(value("columnGutter")) + ")");
        check(await evaluate(stepOf("strokeWidth")) === "0.25" && await evaluate(stepOf("dotSize")) === "0.5", "fields measured in points keep their own steps");
        await evaluate(setField("units", "pt"));
        await evaluate(click("reset"));

        // ------------------------------------------- errors say why Generate is off, and are announced
        await evaluate(setField("columns", "0"));
        check(/whole number from 1 to 100/.test(await evaluate(text("status"))) && await evaluate(`document.getElementById("status").dataset.tone`) === "error",
            "an inline error that disables Generate is summarized in the status line: " + await evaluate(text("status")));
        check(await evaluate(`document.getElementById("generate").disabled`) === true &&
            await evaluate(`document.getElementById("generate").title`) === "Adjust the highlighted settings first.",
            "Generate is off while that error stands, and says why");
        await evaluate(setField("columnGutter", "-5"));
        check(/gutter must be a number/.test(await evaluate(text("field-errors"))),
            "further inline errors reach a live region: " + await evaluate(text("field-errors")));
        await evaluate(setField("columnGutter", "12"));
        await evaluate(setField("columns", "12"));
        check(await evaluate(text("status")) === "" && await evaluate(text("field-errors")) === "", "both clear when the settings are valid again");
        check(/^Drawing of .*Artboard 1\.$/.test(await evaluate(text("schematic-title"))), "the drawing's title describes what it shows: " + await evaluate(text("schematic-title")));
        check(await evaluate(text("blocks-summary")) === "Drag across the drawing to mark content blocks." &&
            /mouse, trackpad or pen/.test(await evaluate(`document.getElementById("blocks-summary").title`)),
            "the blocks note is short on screen, and says it needs a pointer to anyone who asks: " + await evaluate(text("blocks-summary")));
        check(await evaluate(`getComputedStyle(document.getElementById("status"), "::before").color`) === "rgb(27, 27, 27)" ||
            await evaluate(`(() => { const s = document.getElementById("status"); s.dataset.tone = "ok"; const c = getComputedStyle(s, "::before").color; delete s.dataset.tone; return c; })()`) === "rgb(27, 27, 27)",
            "the tone badge draws its glyph in dark ink, not white on mid-tone");

        // -------------------------------------- a drag interrupted by a settings change records nothing
        await evaluate(setField("type", "modular"));
        await evaluate(setField("columns", "4"));
        await evaluate(setField("rows", "4"));
        const dragInterrupted = (from, to) => `(() => {
            const svg = document.getElementById("schematic");
            const ctm = svg.getScreenCTM();
            const at = ([x, y]) => {
                const p = svg.createSVGPoint();
                p.x = x; p.y = y;
                const s = p.matrixTransform(ctm);
                return { clientX: s.x, clientY: s.y, button: 0, pointerId: 1, bubbles: true };
            };
            svg.dispatchEvent(new PointerEvent("pointerdown", at(${JSON.stringify(from)})));
            // Anything that rebuilds the grid mid-drag: an edit here, a background status refresh in Illustrator.
            const el = document.getElementById("settings").elements.namedItem("columnGutter");
            el.value = "14";
            el.dispatchEvent(new Event("input", { bubbles: true }));
            svg.dispatchEvent(new PointerEvent("pointermove", at(${JSON.stringify(to)})));
            svg.dispatchEvent(new PointerEvent("pointermove", at(${JSON.stringify(to)})));
            svg.dispatchEvent(new PointerEvent("pointerup", at(${JSON.stringify(to)})));
        })()`;
        await evaluate(dragInterrupted(center(0, 0), center(1, 1)));
        check(!/Marked a/.test(await evaluate(text("status"))), "a drag whose grid changed under it marks nothing: " + await evaluate(text("status")));
        check(await evaluate(`document.querySelectorAll("#schematic rect.schematic__block").length`) === 0, "no block is drawn from the abandoned drag");
        check(await evaluate(`document.querySelectorAll("#schematic rect.schematic__draft").length`) === 0, "the draft rectangle is taken off the drawing");
        check(/Drag across the drawing/.test(await evaluate(text("blocks-summary"))), "no block was recorded");
        await evaluate(setField("columnGutter", "12"));
        await evaluate(click("reset"));

        // ---------------------------------------------------------------- storage write failures
        await evaluate(`(() => { window.__realSet = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new Error("QuotaExceededError"); }; })()`);
        await evaluate(setField("columnGutter", "13"));
        await sleep(450);
        check(/Panel storage is unavailable/.test(await evaluate(text("status"))), "a settings save that fails is reported: " + await evaluate(text("status")));
        await evaluate(click("preset-new"));
        await evaluate(`document.getElementById("preset-name").value = "Nowhere"`);
        await evaluate(click("preset-save"));
        check(/Couldn't save the preset/.test(await evaluate(text("status"))), "a preset save that fails is reported: " + await evaluate(text("status")));
        check(await evaluate(`document.getElementById("preset-save-row").hidden`) === false, "the save row stays open so the preset isn't silently lost");
        await evaluate(click("preset-cancel"));
        await evaluate(`window.__mullionTest.importPresetText(window.__mullionTest.presetFileText())`);
        check(/Panel storage is unavailable|no presets to import/.test(await evaluate(text("status"))), "an import that can't be stored is reported: " + await evaluate(text("status")));
        await evaluate(`Storage.prototype.setItem = window.__realSet`);

        // ---------------------------------------------------------------- preset file guards
        const presetFile = (version, count) => JSON.stringify({
            format: "mullion-presets",
            version,
            presets: Array.from({ length: count }, (_, i) => ({ name: "Imported " + i, settings: { columns: 5 } }))
        });
        const presetsBefore = await evaluate(`document.getElementById("preset-select").options.length`);
        await evaluate(`window.__mullionTest.importPresetText(${JSON.stringify(presetFile(2, 1))})`);
        check(/version 2/.test(await evaluate(text("status"))) && /version 1/.test(await evaluate(text("status"))),
            "a presets file from an unknown version is refused by version: " + await evaluate(text("status")));
        check(await evaluate(`document.getElementById("preset-select").options.length`) === presetsBefore, "nothing was imported from it");
        await evaluate(`window.__mullionTest.importPresetText("x".repeat(600 * 1024))`);
        check(/too large to import/.test(await evaluate(text("status"))), "an oversized presets file is refused: " + await evaluate(text("status")));
        await evaluate(`window.__mullionTest.importPresetText(${JSON.stringify(presetFile(1, 250))})`);
        check(/Imported 200 presets\./.test(await evaluate(text("status"))) && /The file held 250/.test(await evaluate(text("status"))),
            "import stops at 200 presets and says so: " + await evaluate(text("status")));
        check(await evaluate(`document.getElementById("preset-select").options.length`) === presetsBefore + 200, "200 presets were added, not 250");
        await evaluate(`localStorage.removeItem("mullion.presets.v1")`);

        // ---------------------------------------------------------------- undo
        await load("?theme=dark");
        await evaluate(click("preset-new"));
        await evaluate(`document.getElementById("preset-name").value = "Undo me"`);
        await evaluate(click("preset-save"));
        await evaluate(click("preset-delete"));
        check(/Deleted preset “Undo me”/.test(await evaluate(text("status"))) &&
            await evaluate(`document.querySelector("#status .link-button").textContent`) === "Undo", "deleting a preset offers Undo");
        await evaluate(`document.querySelector("#status .link-button").click()`);
        check(await evaluate(`Array.from(document.getElementById("preset-select").options).map(o => o.value).join("|")`) === "|user:Undo me" &&
            /Restored preset/.test(await evaluate(text("status"))), "Undo brings the preset back: " + await evaluate(text("status")));
        await evaluate(setField("columns", "7"));
        await evaluate(click("reset"));
        check(await evaluate(value("columns")) === "12" && await evaluate(`document.querySelector("#status .link-button").textContent`) === "Undo", "Reset settings offers Undo");
        await evaluate(`document.querySelector("#status .link-button").click()`);
        check(await evaluate(value("columns")) === "7" && /Put your settings back/.test(await evaluate(text("status"))), "Undo restores the settings Reset threw away");
        await evaluate(click("reset"));

        // ---------------------------------------------------------------- focus never lands on the body
        await evaluate(setField("type", "modular"));
        await evaluate(`document.querySelector('[name="rows"]').focus()`);
        await evaluate(setField("type", "columns"));
        check(await evaluate(`document.activeElement.tagName`) !== "BODY" && await evaluate(`document.activeElement.name`) === "panel-mode",
            "hiding the field that has focus moves focus to the mode tab, not the body");
        await evaluate(mode("layouts"));
        await sleep(200);
        check(await evaluate(`document.activeElement.id`) === "library-search", "entering Layouts focuses its first control");
        await evaluate(mode("grid"));
        await sleep(150);
        check(await evaluate(`document.activeElement.id`) !== "library-search" && await evaluate(`document.activeElement.name`) === "type",
            "leaving Layouts moves focus off the hidden search box and into Grid's first control");

        // ---------------------------------------------------------------- the gallery is one tab stop
        await evaluate(mode("layouts"));
        await sleep(350);
        const tabStops = await evaluate(`document.querySelectorAll('#library-grid .tile:not([tabindex="-1"])').length`);
        check(tabStops === 1 && await evaluate(`document.querySelectorAll("#library-grid .tile").length`) > 10,
            "the whole tile grid is a single tab stop (" + tabStops + " of " + await evaluate(`document.querySelectorAll("#library-grid .tile").length`) + ")");
        await evaluate(`document.querySelector('#library-grid .tile[tabindex="0"]').focus()`);
        const firstTile = await evaluate(`document.activeElement.dataset.layout`);
        await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))`);
        check(await evaluate(`document.activeElement.classList.contains("tile")`) === true &&
            await evaluate(`document.activeElement.dataset.layout`) !== firstTile, "arrow keys move between tiles");
        await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))`);
        check(await evaluate(`document.querySelectorAll('#library-grid .tile[tabindex="0"]').length`) === 1 &&
            await evaluate(`document.activeElement.getAttribute("tabindex")`) === "0", "only the tile arrow keys landed on stays in the tab order");

        // ------------------------------------------ the gallery repaints in place when the artboard changes
        await evaluate(chip("Modular"));
        await sleep(250);
        await evaluate(`(() => {
            const grid = document.getElementById("library-grid");
            grid.querySelectorAll(".tile").forEach((tile, i) => { tile.dataset.probe = String(i); });
            grid.scrollTop = 30;
            document.querySelector('#library-grid .tile[data-layout="modular-4x6"]').focus();
        })()`);
        const tileCount = await evaluate(`document.querySelectorAll("#library-grid .tile").length`);
        await evaluate(`(() => { const s = document.getElementById("format-select"); s.value = "a4"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
        await evaluate(click("format-apply"));
        await sleep(400);
        check(await evaluate(`document.querySelectorAll("#library-grid .tile[data-probe]").length`) === tileCount,
            "a changed artboard repaints the tiles rather than rebuilding them");
        check(await evaluate(`document.getElementById("library-grid").scrollTop`) === 30 &&
            await evaluate(`document.activeElement.dataset.layout`) === "modular-4x6", "the scroll position and the focused tile survive the repaint");
        check(await evaluate(`document.querySelectorAll("#library-grid .tile svg rect.schematic__paper").length`) >= 3, "the repainted tiles still have thumbnails");
        await evaluate(mode("grid"));

        // ---------------------------------------------- a slow host: working state and the in-flight guard
        await load("?theme=dark");
        await evaluate(`window.__mullionTest.setHostTimeout(300)`);
        await evaluate(`window.__mullionTest.stall(1600)`);
        await evaluate(click("generate"));
        await sleep(450);
        check(await evaluate(`document.getElementById("panel").dataset.working`) === "true" &&
            await evaluate(`document.getElementById("progress").hidden`) === false, "a call that isn't answered quickly shows a working state");
        await sleep(250);
        check(/didn't respond to generate/.test(await evaluate(text("status"))), "an abandoned call says so: " + await evaluate(text("status")));
        check(await evaluate(`document.getElementById("generate").disabled`) === true, "Generate stays unavailable while the host is still running it");
        await evaluate(`(() => { const b = document.getElementById("generate"); b.disabled = false; b.click(); })()`);
        await sleep(200);
        check(/still working on the last request/.test(await evaluate(text("status"))),
            "a second Generate is refused rather than applied twice: " + await evaluate(text("status")));
        await sleep(1400);
        check(/ready again/.test(await evaluate(text("status"))), "the panel recovers when the host finally answers: " + await evaluate(text("status")));
        check(await evaluate(`document.getElementById("generate").disabled`) === false &&
            await evaluate(`document.getElementById("progress").hidden`) === true, "Generate and the working state return to normal");

        // ---------------------------------------------------------------- version and diagnostics
        await load("?theme=dark");
        check(await evaluate(text("panel-version")) === "0.1.0", "the More section shows the panel's version");
        await evaluate(`window.__mullionTest.importPresetText("nonsense")`);
        const diagnostics = await evaluate(`window.__mullionTest.diagnosticsText()`);
        check(/GridComposer panel 0\.1\.0/.test(diagnostics) && /Host: ILST/.test(diagnostics) && /OS: /.test(diagnostics) &&
            /Document: Mock document/.test(diagnostics) && /Mode: grid/.test(diagnostics) && /Grid: columns/.test(diagnostics) &&
            /Last error: That file isn't a presets file\./.test(diagnostics),
            "diagnostics carry panel version, host, OS, document, mode, settings and the last error");
        await evaluate(click("copy-diagnostics"));
        await sleep(250);
        check(/diagnostics/i.test(await evaluate(text("status"))), "Copy diagnostics says what happened: " + await evaluate(text("status")));

        // ------------------------------------------------- an installed update is named, and it sticks
        await load("?theme=dark&hostversion=0.2.0");
        check(/GridComposer 0\.2\.0 is installed; this panel is still running 0\.1\.0\./.test(await evaluate(text("status"))) &&
            await evaluate(`document.querySelector("#status .link-button").textContent`) === "Reload panel",
            "the update prompt names the version: " + await evaluate(text("status")));
        check(await evaluate(text("panel-version")) === "0.1.0 (installed: 0.2.0)", "the More section shows both versions");
        await evaluate(`window.dispatchEvent(new Event("focus"))`);
        await sleep(300);
        await evaluate(`window.dispatchEvent(new Event("focus"))`);
        await sleep(300);
        check(/GridComposer 0\.2\.0 is installed/.test(await evaluate(text("status"))) &&
            Boolean(await evaluate(`document.querySelector("#status .link-button")`)), "the update prompt survives background refreshes");
        await evaluate(click("toggle-lock"));
        await sleep(250);
        check(!/0\.2\.0/.test(await evaluate(text("status"))), "a message of its own covers the prompt: " + await evaluate(text("status")));
        await evaluate(mode("construct"));
        await sleep(300);
        check(/GridComposer 0\.2\.0 is installed/.test(await evaluate(text("status"))), "and the prompt comes back when the status line clears");
        await evaluate(mode("grid"));

        // ------------------------------------- the no-document message is set on the transition only
        await load("?theme=dark&nodoc");
        check(/Open or create a document/.test(await evaluate(text("status"))), "the no-document message is said when the document goes away");
        await evaluate(click("reset"));
        check(await evaluate(`document.querySelector("#status .link-button").textContent`) === "Undo", "an action is offered with no document open");
        await evaluate(`window.dispatchEvent(new Event("focus"))`);
        await sleep(300);
        await evaluate(`window.dispatchEvent(new Event("focus"))`);
        await sleep(300);
        check(/Settings reset to defaults/.test(await evaluate(text("status"))) &&
            await evaluate(`document.querySelector("#status .link-button") && document.querySelector("#status .link-button").textContent`) === "Undo",
            "background refreshes no longer re-say it over the message and its action: " + await evaluate(text("status")));

        // ------------------------------------- stored settings and presets keep their unit meaning
        await load("?theme=dark");
        await evaluate(`localStorage.setItem("mullion.settings.v1", JSON.stringify({ units: "in" }))`);
        await evaluate(`localStorage.setItem("mullion.presets.v1", JSON.stringify([{ name: "Inches", settings: { units: "in", columns: 5 } }]))`);
        // The panel saves its settings as it closes; stop that so the stored
        // object under test is the one the next load reads.
        await evaluate(`Storage.prototype.setItem = function () {}`);
        await load("?theme=dark");
        check(await evaluate(value("units")) === "in" && await evaluate(value("marginTop")) === "0.5" && await evaluate(value("columnGutter")) === "0.167",
            "stored settings that name inches convert the point defaults (36 pt -> 0.5 in), instead of reading them as 36 in");
        check(await evaluate(`document.getElementById("generate").disabled`) === false && await evaluate(text("status")) === "",
            "so the panel opens with a grid it can draw");
        await evaluate(setField("units", "pt"));
        await evaluate(`(() => { const s = document.getElementById("preset-select"); s.value = "user:Inches"; s.dispatchEvent(new Event("change")); })()`);
        check(await evaluate(value("units")) === "in" && await evaluate(value("marginTop")) === "0.5" && await evaluate(value("columns")) === "5",
            "a preset that names inches without lengths converts them the same way");
        await evaluate(`localStorage.clear()`);

        // ---------------------------------------------- the drawing is repainted when it gets its size back
        await load("?theme=dark");
        await evaluate(setField("type", "pattern"));
        await evaluate(setField("pattern", "dots"));
        const dotRadius = `Number(document.querySelector("#schematic circle").getAttribute("r"))`;
        const openRadius = await evaluate(dotRadius);
        await evaluate(click("stage-toggle"));
        await evaluate(setField("dotSize", "2"));
        const collapsedRadius = await evaluate(dotRadius);
        await evaluate(click("stage-toggle"));
        await sleep(150);
        const reopenedRadius = await evaluate(dotRadius);
        check(collapsedRadius === 5, "a drawing painted while collapsed falls back to the 5 pt dot radius (" + collapsedRadius + ")");
        check(reopenedRadius < 5 && Math.abs(reopenedRadius - openRadius) < 0.01,
            "expanding the drawing paints it again at the size it really has (" + reopenedRadius + " vs " + openRadius + ")");
        await send("Emulation.setDeviceMetricsOverride", { width: 320, height: 600, deviceScaleFactor: 2, mobile: false });
        await sleep(400);
        check(await evaluate(dotRadius) !== reopenedRadius, "resizing the panel paints the drawing again (" + await evaluate(dotRadius) + ")");
        await send("Emulation.setDeviceMetricsOverride", { width: 320, height: 1180, deviceScaleFactor: 2, mobile: false });
        await sleep(300);

        // ---------------------------------------------------------------- no document, themes, narrow
        await load("?theme=light&nodoc");
        check(await evaluate(text("artboard-name")) === "No document open", "no-document readout");
        check(/Open or create a document/.test(await evaluate(text("status"))), "no-document guidance");
        check(await evaluate(`document.getElementById("generate").disabled && document.getElementById("clear").disabled && document.getElementById("preview-toggle").disabled && document.getElementById("toggle-lock").disabled`) === true, "actions disabled without a document");
        check(await evaluate(`document.getElementById("generate").title`) === "Open or create a document to add a grid.", "and Generate says why it is disabled");
        await shoot("light-nodoc");
        await load("?theme=light");
        await shoot("light-columns");
        await load("?theme=mediumlight");
        await evaluate(setField("type", "modular"));
        await shoot("mediumlight-modular");
        await load("?theme=mediumdark");
        await evaluate(setField("type", "composition"));
        await evaluate(setField("compSpiral", true));
        await shoot("mediumdark-composition");
        await load("?theme=light");
        await evaluate(mode("layouts"));
        await sleep(400);
        await shoot("light-library");
        await evaluate(mode("grid"));
        await send("Emulation.setDeviceMetricsOverride", { width: 240, height: 700, deviceScaleFactor: 2, mobile: false });
        await load("?theme=dark");
        await evaluate(setField("type", "columns"));
        check(await evaluate(`document.documentElement.scrollWidth <= 240 && document.getElementById("settings").scrollWidth <= 240`) === true, "no horizontal overflow at 240 px");
        await shoot("dark-narrow-240");
        await send("Emulation.setDeviceMetricsOverride", { width: 320, height: 640, deviceScaleFactor: 2, mobile: false });
        await load("?theme=dark");
        await shoot("dark-320x640");

        // ------------------------------------- the smallest panel the manifest allows: 240 × 320
        // Every control has to be reachable there, so nothing may be clipped and
        // the settings must scroll under a fixed action bar.
        const fits = `(() => {
            const vw = document.documentElement.clientWidth;
            const vh = document.documentElement.clientHeight;
            const box = (id) => document.getElementById(id).getBoundingClientRect();
            const inside = (b) => b.height > 0 && b.width > 0 && b.top >= -0.5 && b.left >= -0.5 && b.bottom <= vh + 0.5 && b.right <= vw + 0.5;
            const work = document.getElementById("workspace");
            return {
                generate: inside(box("generate")),
                status: inside(box("status")),
                clear: inside(box("clear")),
                settingsHeight: work.clientHeight,
                settingsScrolls: work.scrollHeight > work.clientHeight,
                collapsed: document.querySelector(".stage").classList.contains("stage--collapsed"),
                actionsOnScreen: document.querySelector(".actions").getBoundingClientRect().bottom <= vh + 0.5 &&
                    document.querySelector(".panel").getBoundingClientRect().bottom <= vh + 0.5
            };
        })()`;
        const reachable = `(() => {
            const vh = document.documentElement.clientHeight;
            const vw = document.documentElement.clientWidth;
            document.querySelectorAll("details.section").forEach((d) => { d.open = true; });
            const work = document.getElementById("workspace");
            work.scrollTop = work.scrollHeight;
            const b = document.getElementById("copy-diagnostics").getBoundingClientRect();
            return b.height > 0 && b.top >= -0.5 && b.bottom <= vh + 0.5 && b.right <= vw + 0.5;
        })()`;
        for (const size of [[240, 320], [320, 360]]) {
            await send("Emulation.setDeviceMetricsOverride", { width: size[0], height: size[1], deviceScaleFactor: 2, mobile: false });
            await load("?theme=dark");
            // A message of some kind, so the status line is on screen to measure.
            await evaluate(setField("columns", "0"));
            const at = size[0] + " × " + size[1];
            const state = await evaluate(fits);
            check(state.generate && state.clear, "Generate and Clear are inside the panel at " + at);
            check(state.status, "the status line is inside the panel at " + at);
            check(state.collapsed, "the drawing collapses by itself at " + at);
            check(state.actionsOnScreen, "the action bar isn't clipped off the bottom at " + at);
            check(state.settingsHeight >= 44 && state.settingsScrolls,
                "the settings area is usable and scrolls at " + at + " (" + state.settingsHeight + " px)");
            await evaluate(setField("columns", "12"));
            await shoot("dark-" + size[0] + "x" + size[1]);
            check(await evaluate(reachable), "scrolling reaches the last control in More at " + at);
        }
        await send("Emulation.setDeviceMetricsOverride", { width: 320, height: 1180, deviceScaleFactor: 2, mobile: false });
        await load("?theme=dark");
        check(await evaluate(`document.querySelector(".stage").classList.contains("stage--collapsed")`) === false,
            "a tall panel gets the drawing back");
    } finally {
        if (ws) ws.close();
        chrome.kill();
        await sleep(200);
        fs.rmSync(profile, { recursive: true, force: true });
    }

    const relevantErrors = pageErrors.filter(Boolean);
    relevantErrors.forEach((e) => console.log("PAGE ERROR " + e));
    if (relevantErrors.length) failures.push(`${relevantErrors.length} page error(s)`);
    console.log(failures.length ? `\n${failures.length} UI check(s) failed` : "\nAll UI checks passed");
    process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
