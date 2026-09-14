#!/usr/bin/env node
/*
 * Panel smoke test in headless Chrome, using the browser mock host.
 *
 *   node scripts/ui-smoke.js [--screenshots <dir>]
 *
 * Fails on any uncaught exception or console error, and checks the main
 * interactions: validation, unit conversion, preview, generate, clear,
 * presets, persistence, and the no-document state. Uses the Chrome DevTools
 * Protocol over Node's built-in WebSocket, so it needs no npm packages.
 * Set CHROME_PATH if Chrome is not in the default macOS location.
 */
"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PAGE = "file://" + path.join(ROOT, "client", "index.html");
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
        "--no-first-run", "--no-default-browser-check", "--allow-file-access-from-files", "about:blank"
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
        check(/Previewing on Artboard 1/.test(await evaluate(text("status"))), "preview runs after debounce");
        await evaluate(setField("columns", "8"));
        await evaluate(setField("columns", "9"));
        await evaluate(setField("columns", "10"));
        await sleep(450);
        check(/Previewing/.test(await evaluate(text("status"))), "rapid edits still end in a preview");
        await evaluate(click("generate"));
        await sleep(300);
        check(/Added a column grid to Artboard 1 \(22 shapes\)/.test(await evaluate(text("status"))), "generate reports result: " + await evaluate(text("status")));
        check(await evaluate(`document.getElementById("preview-toggle").checked`) === false, "generate turns preview off");
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
        await evaluate(setField("strokeColor", "#123456"));
        await evaluate(click("library-open"));
        await sleep(150);
        check(await evaluate(`document.getElementById("library").hidden === false && document.getElementById("settings").hidden === true && document.getElementById("controls").hidden === true`) === true, "library replaces the settings area");
        check(await evaluate(`document.activeElement.id`) === "library-search", "search is focused");
        const chips = await evaluate(`Array.from(document.querySelectorAll("#library-chips input")).map(i => i.value).join("|")`);
        check(chips === "Suggested|All|Columns|Modular|Asymmetric|Baseline|Classic|Print|Screen|Social|Composition|Patterns", "category chips: " + chips);
        check(await evaluate(`document.querySelector("#library-chips input:checked").value`) === "Suggested", "Suggested chosen for a Letter artboard");
        const suggested = await evaluate(`Array.from(document.querySelectorAll("#library-grid .tile")).map(t => t.dataset.layout)`);
        check(suggested.includes("letter-3"), "Letter suggestions include US Letter, 3 columns (" + suggested.join(", ") + ")");
        await sleep(300);
        check(await evaluate(`document.querySelectorAll("#library-grid .tile svg rect.schematic__paper").length`) >= 3, "visible tiles draw live thumbnails");
        await shoot("dark-library-suggested");

        const chip = (name) => `(() => { const i = Array.from(document.querySelectorAll("#library-chips input")).find(x => x.value === ${JSON.stringify(name)}); i.checked = true; i.dispatchEvent(new Event("change", { bubbles: true })); })()`;
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
        await evaluate(chip("Patterns"));
        await evaluate(`document.querySelector('#library-grid .tile[data-layout="dots-5mm"]').click()`);
        check(await evaluate(value("type")) === "pattern" && await evaluate(value("pattern")) === "dots", "pattern layout applies");
        await sleep(300);
        await shoot("dark-library-patterns");

        await evaluate(`document.getElementById("library-search").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
        check(await evaluate(`document.getElementById("library").hidden`) === true, "Escape closes the library");
        check(await evaluate(`document.activeElement.id`) === "library-open", "focus returns to the Layouts button");
        await evaluate(click("library-open"));
        check(await evaluate(`document.querySelector("#library-chips input:checked").value`) === "Patterns", "library reopens on the last category");
        await evaluate(click("library-close"));
        await evaluate(click("reset"));
        await evaluate(setField("strokeColor", "#E0457B"));

        // ---------------------------------------------------------------- keyboard
        await evaluate(`(() => { const el = document.querySelector('[name="columnGutter"]'); el.value = "12"; el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", shiftKey: true, bubbles: true })); })()`);
        check(await evaluate(value("columnGutter")) === "22", "Shift+ArrowUp steps by 10");
        await evaluate(setField("columnGutter", "12"));

        // ---------------------------------------------------------------- no document, themes, narrow
        await load("?theme=light&nodoc");
        check(await evaluate(text("artboard-name")) === "No document open", "no-document readout");
        check(/Open or create a document/.test(await evaluate(text("status"))), "no-document guidance");
        check(await evaluate(`document.getElementById("generate").disabled && document.getElementById("clear").disabled && document.getElementById("preview-toggle").disabled && document.getElementById("toggle-lock").disabled`) === true, "actions disabled without a document");
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
        await evaluate(click("library-open"));
        await sleep(400);
        await shoot("light-library");
        await send("Emulation.setDeviceMetricsOverride", { width: 240, height: 700, deviceScaleFactor: 2, mobile: false });
        await load("?theme=dark");
        await evaluate(setField("type", "columns"));
        check(await evaluate(`document.documentElement.scrollWidth <= 240 && document.getElementById("settings").scrollWidth <= 240`) === true, "no horizontal overflow at 240 px");
        await shoot("dark-narrow-240");
        await send("Emulation.setDeviceMetricsOverride", { width: 320, height: 640, deviceScaleFactor: 2, mobile: false });
        await load("?theme=dark");
        await shoot("dark-320x640");
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
