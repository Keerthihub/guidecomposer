/*
 * Mullion panel controller.
 *
 * Runs in CEP's embedded Chromium (88+, Illustrator 2022 and later). Opened in
 * an ordinary browser it switches to a mock host so the UI can be developed
 * without Illustrator: add ?theme=light|mediumlight|mediumdark|dark and
 * ?nodoc to the URL to try other states.
 *
 * Data flow
 *   controls -> readSettings()/readTarget() -> MullionCore.buildGrid() per target artboard
 *            -> drawing, readout, and inline errors
 *            -> (preview on) debounced, serialized host preview
 *   buttons  -> queue -> bridge.call(method, payload) -> host JSON response
 */
(function () {
    "use strict";

    const core = window.MullionCore;
    const layouts = window.MullionLayouts || {
        CATEGORIES: [], LAYOUTS: [], find: () => null, resolveLayout: () => ({}),
        suggestLayouts: () => [], describeArtboard: () => "", describeShort: () => ""
    };

    const STORAGE_SETTINGS = "mullion.settings.v1";
    const STORAGE_PRESETS = "mullion.presets.v1";
    const STORAGE_UI = "mullion.ui.v1";

    const PREVIEW_DELAY_MS = 200;
    const STATUS_THROTTLE_MS = 600;
    const STEP_REPEAT_DELAY_MS = 400;
    const STEP_REPEAT_MS = 70;
    const FALLBACK_RECT = [0, 792, 612, 0]; // US Letter, shown when no document is open
    const MAX_SCHEMATIC_CELLS = 2500;
    const THUMBNAIL_MAX_MARKS = 500; // Dots and hexagons beyond this are thinned in tile thumbnails.

    const formats = window.MullionFormats || { GROUPS: [], FORMATS: [], find: () => null, toPoints: () => ({}), label: () => "" };

    const HOST_METHODS = ["status", "preview", "clearPreview", "generate", "clear", "setGridLayer", "resizeArtboards", "alignSelection", "textMetrics", "applyPageMargins", "selectionGeometry", "drawTestLine"];
    const LENGTH_FIELDS = ["columnGutter", "rowGutter", "marginTop", "marginRight", "marginBottom", "marginLeft", "baselineSpacing", "baselineOffset", "patternSize", "conPadding"];
    const MARGIN_FIELDS = ["marginTop", "marginRight", "marginBottom", "marginLeft"];
    const NUMBER_FIELDS = LENGTH_FIELDS.concat(["columns", "rows", "strokeWidth", "opacity", "dotSize", "rings", "spokes", "gutterOpacity", "overlayColumns", "patternAngle"]);
    const BOOLEAN_FIELDS = ["extendToEdges", "lockLayer", "marginColorOn", "shadeGutters", "addBaseline", "squareModules"]
        .concat(core ? core.COMPOSITION_FLAGS : [], core ? core.CONSTRUCTION_FLAGS : []);
    const TEXT_FIELDS = ["columnRatios", "rowRatios"];
    // Host vocabulary: Illustrator has artboards, InDesign has pages.
    const NOUNS = {
        illustrator: { one: "artboard", many: "artboards", title: "Artboard" },
        indesign: { one: "page", many: "pages", title: "Page" }
    };
    const COLOR_FIELDS = ["strokeColor", "marginColor", "gutterColor", "conBoundsColor", "conKeylineColor", "conCircleColor"];
    const CHOICE_FIELDS = ["type", "output", "lineStyle", "conExtend"];
    const SELECT_FIELDS = { units: "pt", spiralFocus: "bottom-right", pattern: "square" };
    const GRID_NAMES = { columns: "column grid", modular: "modular grid", baseline: "baseline grid", composition: "set of composition guides", pattern: "pattern" };
    const PATTERN_NAMES = { square: "Square grid", dots: "Dot grid", isometric: "Isometric grid", hexagon: "Hexagons", diagonal: "Diagonal grid", radial: "Radial grid" };
    const PATTERN_SIZE_LABELS = { square: "Cell size", dots: "Spacing", isometric: "Triangle side", hexagon: "Hexagon side", diagonal: "Diamond size" };
    const GUIDE_NAMES = {
        compThirds: "Thirds", compFifths: "Fifths", compGolden: "Golden sections", compDiagonals: "Diagonals",
        compCenter: "Center", compArmature: "Armature", compDynamic: "Dynamic rectangle", compVillard: "Villard", compSpiral: "Spiral"
    };
    const PANEL_MODES = ["grid", "layouts", "construct"];
    const BOX_TYPES = { columns: true, modular: true };

    // Some errors cover a pair of fields: the message names both sides.
    const ERROR_FIELD_GROUPS = {
        marginLeft: ["marginLeft", "marginRight"],
        marginTop: ["marginTop", "marginBottom"]
    };

    const SUPERSEDED = Object.freeze({ ok: false, superseded: true });

    // ------------------------------------------------------------------ storage

    const storage = {
        get(key) {
            try {
                const raw = window.localStorage.getItem(key);
                return raw ? JSON.parse(raw) : null;
            } catch (e) {
                return null;
            }
        },
        set(key, value) {
            try {
                window.localStorage.setItem(key, JSON.stringify(value));
                return true;
            } catch (e) {
                return false;
            }
        },
        updateUi(changes) {
            const ui = this.get(STORAGE_UI) || {};
            Object.assign(ui, changes);
            this.set(STORAGE_UI, ui);
        }
    };

    // ------------------------------------------------------------------ bridges

    function hostError(message, detail) {
        return { ok: false, error: { code: "HOST_ERROR", message, detail, fields: [] } };
    }

    function parseHostResponse(raw) {
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed.ok === "boolean") {
                return parsed;
            }
        } catch (e) {
            // Fall through to the generic error below.
        }
        return hostError("Illustrator didn't respond as expected. Close any open Illustrator dialogs and try again.", String(raw));
    }

    function createCepBridge() {
        const cs = new CSInterface();
        const encodedRoot = encodeURIComponent(cs.getSystemPath(SystemPath.EXTENSION));
        let booting = null;

        function evalScript(script) {
            return new Promise((resolve) => cs.evalScript(script, resolve));
        }

        // Always reloads host/index.jsx before booting, so an updated extension never
        // runs an older copy still held in the app's script engine.
        // The root path is URI-encoded, so it cannot break out of the string literal.
        function boot() {
            const script =
                '(function (r) { $.evalFile(new File(decodeURIComponent(r) + "/host/index.jsx"));' +
                ' return Mullion.boot(r); }("' + encodedRoot + '"))';
            booting = evalScript(script).then(parseHostResponse);
            return booting;
        }

        function scriptFor(method, payload) {
            const arg = payload === undefined ? "" : '"' + encodeURIComponent(JSON.stringify(payload)) + '"';
            return "Mullion.api." + method + "(" + arg + ")";
        }

        async function call(method, payload) {
            if (HOST_METHODS.indexOf(method) === -1) {
                throw new Error("Unknown host method: " + method);
            }
            const booted = await (booting || boot());
            if (!booted.ok) {
                booting = null; // Try booting again on the next call.
                return booted;
            }
            const raw = await evalScript(scriptFor(method, payload));
            const result = parseHostResponse(raw);
            // Illustrator can reset its script engine (for example after running
            // another extension's script). Every endpoint catches its own errors,
            // so these two signals mean Mullion itself is gone: boot and retry once.
            const engineReset = raw === "EvalScript error." || (result.error && result.error.code === "NOT_READY");
            if (!result.ok && engineReset) {
                const rebooted = await boot();
                if (!rebooted.ok) {
                    return rebooted;
                }
                return parseHostResponse(await evalScript(scriptFor(method, payload)));
            }
            return result;
        }

        // Fire-and-forget, for page unload where promises may never settle.
        function fire(method) {
            if (HOST_METHODS.indexOf(method) !== -1) {
                cs.evalScript(scriptFor(method));
            }
        }

        return {
            kind: "cep",
            call,
            fire,
            on(type, handler) {
                cs.addEventListener(type, handler);
            },
            skin() {
                const env = cs.getHostEnvironment();
                return env ? env.appSkinInfo : null;
            },
            themeEvent: CSInterface.THEME_COLOR_CHANGED_EVENT
        };
    }

    // Browser stand-in for Illustrator, driven by the same grid core.
    function createMockBridge() {
        const params = new URLSearchParams(window.location.search);
        const mockHost = params.get("host") === "indesign" ? "indesign" : "illustrator";
        const boards = mockHost === "indesign"
            ? [
                { index: 0, name: "Page 1", rect: [0, 0, 612, -792] },
                { index: 1, name: "Page 2", rect: [612, 0, 1224, -792] },
                { index: 2, name: "Page 3", rect: [0, -900, 612, -1692] }
            ]
            : [
                { index: 0, name: "Artboard 1", rect: [0, 792, 612, 0] },
                { index: 1, name: "Card", rect: [700, 300, 1000, 0] },
                { index: 2, name: "Poster", rect: [1100, 1224, 1892, 0] }
            ];
        const state = {
            hasDocument: !params.has("nodoc"),
            groups: [], // { kind, artboard }
            layer: null, // { visible, locked }
            selection: params.has("selection") ? [[100, 700, 300, 500], [320, 700, 520, 500]] : []
        };
        const shades = { dark: 50, mediumdark: 83, mediumlight: 184, light: 240 };
        const shade = shades[params.get("theme")] || shades.dark;
        const ok = (data) => ({ ok: true, data });
        const fail = (code, message, fields) => ({ ok: false, error: { code, message, fields: fields || [] } });
        const noDocument = fail("NO_DOCUMENT", "Open or create a document to add a grid.");

        function describeBoard(board) {
            const r = board.rect;
            return { index: board.index, name: board.name, rect: r, width: r[2] - r[0], height: r[1] - r[3] };
        }

        function status() {
            if (!state.hasDocument) {
                return { hasDocument: false, host: mockHost };
            }
            const onActive = state.groups.filter((g) => g.artboard === 0);
            return {
                host: mockHost,
                hasDocument: true,
                documentName: "Mock document",
                selection: { count: state.selection.length, objects: state.selection.map((rect) => ({ rect, artboard: 0 })) },
                colorSpace: "RGB",
                artboardCount: boards.length,
                artboard: describeBoard(boards[0]),
                artboards: boards,
                grids: {
                    preview: onActive.filter((g) => g.kind === "preview").length,
                    generated: onActive.filter((g) => g.kind === "final").length
                },
                gridLayer: state.layer ? { exists: true, visible: state.layer.visible, locked: state.layer.locked } : { exists: false, visible: true, locked: false }
            };
        }

        function targets(target) {
            const mode = (target && target.mode) || "active";
            if (mode === "selection") {
                if (!state.selection.length) {
                    return fail("NO_SELECTION", "Select one or more objects to put a grid inside them.");
                }
                return { ok: true, boards: state.selection.map((rect) => ({ index: 0, name: "Object on " + boards[0].name, rect, areaLabel: "object" })) };
            }
            if (mode === "active") {
                return { ok: true, boards: [boards[0]] };
            }
            if (mode === "all") {
                return { ok: true, boards };
            }
            const parsed = core.parseArtboardRange(target.range, boards.length);
            if (!parsed.ok) {
                return fail("INVALID_TARGET", parsed.error, [{ field: "range", message: parsed.error }]);
            }
            return { ok: true, boards: parsed.indices.map((i) => boards[i]) };
        }

        // A simple mark (a circle between two bars) inside the first selected object.
        function mockArtwork() {
            if (!state.selection.length) {
                return [];
            }
            const [l, t, r, b] = state.selection[0];
            const cx = (l + r) / 2;
            const cy = (t + b) / 2;
            const radius = Math.min(r - l, t - b) * 0.3;
            const k = 0.5522847498307936 * radius;
            const corner = (x, y) => ({ anchor: [x, y], left: [x, y], right: [x, y] });
            return [
                {
                    closed: true,
                    points: [
                        { anchor: [cx, cy + radius], left: [cx - k, cy + radius], right: [cx + k, cy + radius] },
                        { anchor: [cx + radius, cy], left: [cx + radius, cy + k], right: [cx + radius, cy - k] },
                        { anchor: [cx, cy - radius], left: [cx + k, cy - radius], right: [cx - k, cy - radius] },
                        { anchor: [cx - radius, cy], left: [cx - radius, cy - k], right: [cx - radius, cy + k] }
                    ]
                },
                { closed: true, points: [corner(l, cy + radius * 0.35), corner(cx - radius * 1.2, cy + radius * 0.35), corner(cx - radius * 1.2, cy - radius * 0.35), corner(l, cy - radius * 0.35)] },
                { closed: true, points: [corner(cx + radius * 1.2, cy + radius * 0.35), corner(r, cy + radius * 0.35), corner(r, cy - radius * 0.35), corner(cx + radius * 1.2, cy - radius * 0.35)] }
            ];
        }

        function draw(payload, kind) {
            if (!state.hasDocument) {
                return noDocument;
            }
            if (payload.kind === "construction") {
                const paths = mockArtwork();
                if (!paths.length) {
                    return fail("NO_SELECTION", "Select a logo or artwork to draw its construction lines.");
                }
                const built = core.buildConstruction(paths, boards[0].rect, payload.settings || {});
                if (!built.ok) {
                    return fail("INVALID_SETTINGS", built.errors[0].message, built.errors);
                }
                const before = state.groups.length;
                state.groups = state.groups.filter((g) => g.kind !== "preview" && !(kind === "final" && g.construction));
                const replaced = kind === "final" ? before - state.groups.length : 0;
                state.groups.push({ kind, artboard: 0, construction: true });
                state.layer = state.layer || { visible: true, locked: false };
                return ok({ shapes: built.shapeCount, artboards: 1, metrics: built.metrics, replaced, rescued: 0, hidden: 0, status: status() });
            }
            const resolved = targets(payload.target);
            if (!resolved.ok) {
                return resolved;
            }
            let shapes = 0;
            let metrics = null;
            for (const board of resolved.boards) {
                const grid = core.buildGrid(board.rect, payload.settings || {}, { areaLabel: board.areaLabel });
                if (!grid.ok) {
                    const prefix = resolved.boards.length > 1 ? board.name + ": " : "";
                    return fail("INVALID_SETTINGS", prefix + grid.errors[0].message, grid.errors);
                }
                shapes += grid.shapeCount;
                metrics = metrics || grid.metrics;
            }
            const indices = resolved.boards.map((b) => b.index);
            const replacing = payload.mode !== "add";
            state.groups = state.groups.filter((g) => g.kind !== "preview");
            const before = state.groups.length;
            if (kind === "final" && replacing) {
                state.groups = state.groups.filter((g) => indices.indexOf(g.artboard) === -1);
            }
            const replaced = before - state.groups.length;
            resolved.boards.forEach((b) => state.groups.push({ kind, artboard: b.index }));
            state.layer = state.layer || { visible: true, locked: false };
            state.layer.visible = true;
            if (kind === "final") {
                state.layer.locked = payload.settings.lockLayer === true;
            }
            return ok({ shapes, artboards: resolved.boards.length, metrics, replaced, rescued: 0, hidden: 0, status: status() });
        }

        const handlers = {
            status: () => ok(status()),
            preview: (p) => draw(p, "preview"),
            generate: (p) => draw(p, "final"),
            clearPreview: () => {
                const before = state.groups.length;
                state.groups = state.groups.filter((g) => g.kind !== "preview");
                return ok({ removed: before - state.groups.length, status: status() });
            },
            clear: (p) => {
                if (!state.hasDocument) {
                    return noDocument;
                }
                if (p.kind === "construction") {
                    const before = state.groups.length;
                    state.groups = state.groups.filter((g) => !g.construction);
                    return ok({ removed: before - state.groups.length, rescued: 0, clearedArtboards: 1, targetArtboards: 1, status: status() });
                }
                const resolved = targets(p.target);
                if (!resolved.ok) {
                    return resolved;
                }
                const indices = resolved.boards.map((b) => b.index);
                const removed = state.groups.filter((g) => indices.indexOf(g.artboard) !== -1);
                state.groups = state.groups.filter((g) => indices.indexOf(g.artboard) === -1);
                if (!state.groups.length) {
                    state.layer = null;
                }
                const touched = new Set(removed.map((g) => g.artboard)).size;
                return ok({ removed: removed.length, rescued: 0, clearedArtboards: touched, targetArtboards: indices.length, status: status() });
            },
            setGridLayer: (p) => {
                if (!state.hasDocument) {
                    return noDocument;
                }
                if (!state.layer) {
                    return ok({ changed: false, status: status() });
                }
                if (typeof p.visible === "boolean") {
                    state.layer.visible = p.visible;
                }
                if (typeof p.locked === "boolean") {
                    state.layer.locked = p.locked;
                }
                return ok({ changed: true, status: status() });
            },
            resizeArtboards: (p) => {
                if (!state.hasDocument) {
                    return noDocument;
                }
                const resolved = targets(p.target);
                if (!resolved.ok) {
                    return resolved;
                }
                const width = core.toPoints(Number(p.width), p.units);
                const height = core.toPoints(Number(p.height), p.units);
                resolved.boards.forEach((b) => {
                    b.rect = [b.rect[0], b.rect[1], b.rect[0] + width, b.rect[1] - height];
                });
                return ok({ resized: resolved.boards.length, width, height, status: status() });
            },
            alignSelection: (p) => {
                if (!state.hasDocument) {
                    return noDocument;
                }
                if (!state.selection.length) {
                    return fail("NO_SELECTION", "Select the objects to check against the grid.");
                }
                const grid = core.buildGrid(boards[0].rect, p.settings || {});
                const lines = core.snapLines(grid);
                let offGrid = 0;
                let maxOffset = 0;
                state.selection = state.selection.map((rect) => {
                    const snap = core.snapRect(rect, lines);
                    if (snap.onGrid) {
                        return rect;
                    }
                    offGrid++;
                    maxOffset = Math.max(maxOffset, Math.abs(snap.dx), Math.abs(snap.dy));
                    return p.action === "snap" ? [rect[0] + snap.dx, rect[1] + snap.dy, rect[2] + snap.dx, rect[3] + snap.dy] : rect;
                });
                return ok({ checked: state.selection.length, offGrid, maxOffset, moved: p.action === "snap" ? offGrid : 0, skipped: 0, status: status() });
            },
            applyPageMargins: (p) => {
                if (mockHost !== "indesign") {
                    return fail("UNSUPPORTED", "Page margins and columns are an InDesign feature. In Illustrator, Generate draws the grid.");
                }
                const resolved = targets(p.target);
                if (!resolved.ok) {
                    return resolved;
                }
                const s = p.settings || {};
                return ok({ pages: resolved.boards.length, baseline: s.type === "baseline" || s.addBaseline === true, status: status() });
            },
            selectionGeometry: () => (state.hasDocument
                ? ok({ paths: mockArtwork(), hasText: false, truncated: false, artboard: describeBoard(boards[0]) })
                : noDocument),
            textMetrics: () => {
                if (!state.hasDocument) {
                    return noDocument;
                }
                return ok({ size: 11, leading: 14, autoLeading: false, font: "Helvetica" });
            },
            drawTestLine: () => {
                if (!state.hasDocument) {
                    return noDocument;
                }
                state.groups.push({ kind: "final", artboard: 0 });
                state.layer = state.layer || { visible: true, locked: false };
                return ok({ artboard: describeBoard(boards[0]), line: [[0, 396], [612, 396]] });
            }
        };

        return {
            kind: "mock",
            call(method, payload) {
                return new Promise((resolve) => {
                    window.setTimeout(() => resolve(handlers[method](payload || {})), 60);
                });
            },
            fire() {},
            on() {},
            skin() {
                return {
                    panelBackgroundColor: { color: { red: shade, green: shade, blue: shade } },
                    baseFontFamily: "",
                    baseFontSize: 11
                };
            },
            themeEvent: "mock.theme"
        };
    }

    // -------------------------------------------------------------------- queue

    /*
     * Runs host calls one at a time. Calls marked coalesce replace a pending
     * call of the same method, so a burst of preview requests collapses to the
     * latest settings. Replaced and dropped calls resolve with SUPERSEDED.
     */
    function createQueue(bridge, onBusyChange) {
        const jobs = [];
        let active = null;
        const background = { preview: true, status: true, clearPreview: true, setGridLayer: true, textMetrics: true, selectionGeometry: true };

        function isBusy() {
            return Boolean((active && !background[active.method]) || jobs.some((j) => !background[j.method]));
        }

        function pump() {
            onBusyChange(isBusy());
            if (active || jobs.length === 0) {
                return;
            }
            const job = jobs.shift();
            active = job;
            onBusyChange(isBusy());
            bridge.call(job.method, job.payload)
                .catch((err) => ({ ok: false, error: { code: "PANEL_ERROR", message: String((err && err.message) || err), fields: [] } }))
                .then((result) => {
                    active = null;
                    job.resolve(result);
                    pump();
                });
        }

        return {
            enqueue(method, payload, options) {
                return new Promise((resolve) => {
                    if (options && options.coalesce) {
                        const pending = jobs.find((j) => j.method === method);
                        if (pending) {
                            const replaced = pending.resolve;
                            pending.payload = payload;
                            pending.resolve = resolve;
                            replaced(SUPERSEDED);
                            return;
                        }
                    }
                    jobs.push({ method, payload, resolve });
                    pump();
                });
            },
            drop(method) {
                for (let i = jobs.length - 1; i >= 0; i--) {
                    if (jobs[i].method === method) {
                        jobs[i].resolve(SUPERSEDED);
                        jobs.splice(i, 1);
                    }
                }
                onBusyChange(isBusy());
            }
        };
    }

    // -------------------------------------------------------------------- theme

    function clampChannel(value) {
        return Math.max(0, Math.min(255, Math.round(value)));
    }

    function rgb(r, g, b) {
        return "rgb(" + clampChannel(r) + ", " + clampChannel(g) + ", " + clampChannel(b) + ")";
    }

    function applyTheme(skin) {
        if (!skin || !skin.panelBackgroundColor || !skin.panelBackgroundColor.color) {
            return;
        }
        const c = skin.panelBackgroundColor.color;
        const shift = (d) => rgb(c.red + d, c.green + d, c.blue + d);
        const luminance = (0.2126 * c.red + 0.7152 * c.green + 0.0722 * c.blue) / 255;
        const dark = luminance < 0.5;

        const tokens = dark
            ? {
                "--bg": shift(0),
                "--bg-sunken": shift(-12),
                "--fg": "#ececec",
                "--muted": luminance < 0.25 ? "#a9a9a9" : "#cfcfcf",
                "--rule": "rgba(255, 255, 255, 0.1)",
                "--field": shift(-20),
                "--field-border": shift(22),
                "--field-border-hover": shift(42),
                "--hover": "rgba(255, 255, 255, 0.07)",
                "--pressed": "rgba(255, 255, 255, 0.15)",
                "--accent": luminance < 0.25 ? "#378ef0" : "#5ea2f2",
                "--accent-fg": "#ffffff",
                "--focus": "#6cb2ff",
                "--danger": luminance < 0.25 ? "#ff8a80" : "#ffb3ab",
                "--paper-edge": "rgba(0, 0, 0, 0.45)",
                "--guide": "#22c3e6"
            }
            : {
                "--bg": shift(0),
                "--bg-sunken": shift(-10),
                "--fg": "#1b1b1b",
                "--muted": luminance > 0.85 ? "#5a5a5a" : "#353535",
                "--rule": "rgba(0, 0, 0, 0.12)",
                "--field": luminance > 0.85 ? "#ffffff" : shift(30),
                "--field-border": shift(-48),
                "--field-border-hover": shift(-72),
                "--hover": "rgba(0, 0, 0, 0.05)",
                "--pressed": "rgba(0, 0, 0, 0.12)",
                "--accent": luminance > 0.85 ? "#1473e6" : "#0d5bb8",
                "--accent-fg": "#ffffff",
                "--focus": "#0d66d0",
                "--danger": luminance > 0.85 ? "#c9252d" : "#9e1119",
                "--paper-edge": "rgba(0, 0, 0, 0.3)",
                "--guide": "#0b9ec4"
            };

        const rootStyle = document.documentElement.style;
        Object.keys(tokens).forEach((name) => rootStyle.setProperty(name, tokens[name]));
        if (skin.baseFontFamily) {
            rootStyle.setProperty("--font", '"' + String(skin.baseFontFamily).replace(/"/g, "") + '", system-ui, sans-serif');
        }
        if (skin.baseFontSize) {
            rootStyle.setProperty("--font-size", Math.max(10, Math.min(13, Number(skin.baseFontSize) || 11)) + "px");
        }
        document.documentElement.dataset.theme = dark ? "dark" : "light";
    }

    // ----------------------------------------------------------------- elements

    const $ = (id) => document.getElementById(id);
    const els = {
        panel: $("panel"),
        form: $("settings"),
        stage: document.querySelector(".stage"),
        stageToggle: $("stage-toggle"),
        svg: $("schematic"),
        artboardName: $("artboard-name"),
        artboardSize: $("artboard-size"),
        metrics: $("grid-metrics"),
        count: $("grid-count"),
        targetMode: $("target-mode"),
        targetRangeRow: $("target-range-row"),
        targetRange: $("target-range"),
        targetRangeHint: $("target-range-hint"),
        addMode: $("add-mode"),
        leadingFromText: $("leading-from-text"),
        blocksSummary: $("blocks-summary"),
        blocksClear: $("blocks-clear"),
        alignCheck: $("align-check"),
        alignSelect: $("align-select"),
        alignSnap: $("align-snap"),
        formatSelect: $("format-select"),
        formatRotate: $("format-rotate"),
        formatApply: $("format-apply"),
        presetsExport: $("presets-export"),
        pageMargins: $("page-margins"),
        presetsImport: $("presets-import"),
        toggleVisible: $("toggle-visible"),
        toggleLock: $("toggle-lock"),
        refresh: $("refresh"),
        marginLink: $("margin-link"),
        patternSizeLabel: $("pattern-size-label"),
        appearance: $("appearance"),
        appearanceSummary: $("appearance-summary"),
        controls: $("controls"),
        library: $("library"),
        constructCard: $("construct-card"),
        constructTitle: $("construct-title"),
        constructDetail: $("construct-detail"),
        opacitySlider: $("opacity-slider"),
        librarySearch: $("library-search"),
        libraryChips: $("library-chips"),
        libraryHint: $("library-hint"),
        libraryGrid: $("library-grid"),
        presetSelect: $("preset-select"),
        presetNew: $("preset-new"),
        presetDelete: $("preset-delete"),
        presetRow: $("presets"),
        presetSaveRow: $("preset-save-row"),
        presetName: $("preset-name"),
        presetSave: $("preset-save"),
        presetCancel: $("preset-cancel"),
        reset: $("reset"),
        testLine: $("test-line"),
        previewToggle: $("preview-toggle"),
        clear: $("clear"),
        generate: $("generate"),
        status: $("status")
    };

    function field(name) {
        return els.form.elements.namedItem(name);
    }

    // ------------------------------------------------------------ settings I/O

    function formatNumber(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) {
            return String(value);
        }
        return String(Math.round(n * 1000) / 1000);
    }

    function normalizeHex(text) {
        let hex = String(text || "").trim().toUpperCase();
        if (hex && hex[0] !== "#") {
            hex = "#" + hex;
        }
        if (/^#[0-9A-F]{3}$/.test(hex)) {
            hex = "#" + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
        }
        return hex;
    }

    /*
     * Fields show lengths rounded to 3 decimals. To keep unit round trips
     * lossless (12 pt -> 4.233 mm -> 12 pt), remember each length's exact value
     * in points and use it while the field still shows that value.
     */
    const exactPoints = {};

    function rememberExact(name, value, units) {
        const n = core.parseNumber(value);
        exactPoints[name] = Number.isFinite(n) ? core.toPoints(n, units) : null;
    }

    function exactValue(name, units) {
        const points = exactPoints[name];
        if (points === null || points === undefined) {
            return null;
        }
        const exact = core.fromPoints(points, units);
        return formatNumber(exact) === field(name).value ? exact : null;
    }

    // Raw form values. Numbers stay strings so the core can report bad input.
    function readSettings() {
        const s = {};
        CHOICE_FIELDS.forEach((name) => {
            s[name] = field(name).value;
        });
        Object.keys(SELECT_FIELDS).forEach((name) => {
            s[name] = field(name).value;
        });
        COLOR_FIELDS.forEach((name) => {
            s[name] = normalizeHex(field(name).value);
        });
        BOOLEAN_FIELDS.forEach((name) => {
            s[name] = field(name).checked;
        });
        NUMBER_FIELDS.forEach((name) => {
            s[name] = field(name).value;
        });
        TEXT_FIELDS.forEach((name) => {
            s[name] = field(name).value;
        });
        s.blocks = currentBlocks.map((b) => Object.assign({}, b));
        if (core.UNITS.indexOf(s.units) !== -1) {
            LENGTH_FIELDS.forEach((name) => {
                const exact = exactValue(name, s.units);
                if (exact !== null) {
                    s[name] = exact;
                }
            });
        }
        return s;
    }

    // Settings as stored: known keys only, numbers parsed where possible.
    function cleanSettings(raw) {
        const defaults = core.defaults();
        const out = {};
        Object.keys(defaults).forEach((key) => {
            let value = raw && Object.prototype.hasOwnProperty.call(raw, key) ? raw[key] : defaults[key];
            if (NUMBER_FIELDS.indexOf(key) !== -1) {
                const n = core.parseNumber(value);
                value = Number.isFinite(n) ? n : value;
            }
            if (typeof defaults[key] === "boolean") {
                value = value === true;
            }
            if (typeof defaults[key] === "string" && typeof value !== "string") {
                value = defaults[key];
            }
            if (Array.isArray(defaults[key])) {
                value = Array.isArray(value) ? value.map((item) => Object.assign({}, item)) : [];
            }
            out[key] = value;
        });
        return out;
    }

    function setSelectValue(select, value, fallback) {
        const valid = Array.from(select.options).some((o) => o.value === value);
        select.value = valid ? value : fallback;
    }

    function writeSettings(settings) {
        const s = cleanSettings(settings);
        const defaults = core.defaults();
        CHOICE_FIELDS.forEach((name) => {
            field(name).value = s[name];
            if (field(name).value !== s[name]) {
                field(name).value = defaults[name];
            }
        });
        Object.keys(SELECT_FIELDS).forEach((name) => {
            setSelectValue(field(name), s[name], SELECT_FIELDS[name]);
        });
        COLOR_FIELDS.forEach((name) => {
            field(name).value = s[name];
        });
        BOOLEAN_FIELDS.forEach((name) => {
            field(name).checked = s[name];
        });
        NUMBER_FIELDS.forEach((name) => {
            field(name).value = formatNumber(s[name]);
        });
        TEXT_FIELDS.forEach((name) => {
            field(name).value = s[name];
        });
        currentBlocks = s.blocks;
        syncSwatches();
        currentUnits = field("units").value;
        LENGTH_FIELDS.forEach((name) => rememberExact(name, s[name], currentUnits));
        updateUnitLabels();
        syncLockButton();
    }

    function syncSwatches() {
        document.querySelectorAll("[data-swatch-for]").forEach((swatch) => {
            const hex = normalizeHex(field(swatch.dataset.swatchFor).value);
            if (/^#[0-9A-F]{6}$/.test(hex)) {
                swatch.value = hex.toLowerCase();
            }
        });
    }

    function updateUnitLabels() {
        document.querySelectorAll("[data-unit]").forEach((node) => {
            node.textContent = currentUnits;
        });
    }

    // ------------------------------------------------------------------- state

    let hostStatus = { hasDocument: false };
    let lastResult = null;
    let targetState = { ok: true, indices: [0], boards: [] };
    let currentUnits = "pt";
    let marginsLinked = true;
    let busy = false;
    let previewTimer = 0;
    let persistTimer = 0;
    let lastPreviewKey = "";
    let lastStatusAt = 0;
    let statusIsValidation = false;
    let currentBlocks = [];
    let formatSwapped = false;
    let panelMode = "grid";
    let geometry = null; // Selected artwork paths, for construction lines.

    const bridge = window.__adobe_cep__ && typeof window.CSInterface === "function" ? createCepBridge() : createMockBridge();
    const queue = createQueue(bridge, (isBusy) => {
        busy = isBusy;
        els.panel.setAttribute("aria-busy", String(isBusy));
        updateButtons();
    });

    // ------------------------------------------------------------------ status

    // Shows a status message, optionally with one follow-up action button.
    function say(message, tone, action) {
        statusIsValidation = false;
        els.status.textContent = message || "";
        if (tone) {
            els.status.dataset.tone = tone;
        } else {
            delete els.status.dataset.tone;
        }
        if (action) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "link-button";
            button.textContent = action.label;
            button.addEventListener("click", action.run);
            els.status.appendChild(button);
        }
    }

    function nouns() {
        return NOUNS[hostStatus.host] || NOUNS.illustrator;
    }

    function areaWords(count) {
        return plural(count, nouns().one, nouns().many);
    }

    // Uses the host's word (artboard or page) throughout the panel.
    function applyNouns() {
        const n = nouns();
        const labels = { active: "This " + n.one, all: "All " + n.many, range: "Chosen " + n.many, selection: "Selected objects" };
        Array.from(els.targetMode.options).forEach((option) => {
            option.textContent = labels[option.value];
        });
        document.querySelectorAll("[data-noun]").forEach((node) => {
            node.textContent = n.one;
        });
        document.querySelectorAll("[data-host-only]").forEach((node) => {
            node.hidden = node.dataset.hostOnly !== (hostStatus.host || "illustrator");
        });
    }

    async function applyPageMargins() {
        const target = readTarget();
        const response = await queue.enqueue("applyPageMargins", { settings: readSettings(), target });
        if (response.superseded) {
            return;
        }
        if (!response.ok) {
            sayError(response);
            return;
        }
        applyStatus(response.data.status);
        say("Set margins and columns on " + areaWords(response.data.pages) +
            (response.data.baseline ? ", and the document baseline grid." : "."), "ok");
    }

    function sayError(result) {
        const error = (result && result.error) || {};
        say(error.message || "Something went wrong. Try again.", "error");
        if (error.fields && error.fields.some((f) => f.field === "range")) {
            showRangeError(error.message);
        }
        if (error.detail && window.console) {
            console.warn("[Mullion] host detail:", error.detail);
        }
    }

    function plural(count, one, many) {
        return count + " " + (count === 1 ? one : many);
    }

    // ------------------------------------------------------------------ target

    // "add" keeps existing grids on the target artboards; "replace" swaps them out.
    function readMode() {
        return els.addMode.checked ? "add" : "replace";
    }

    function readTarget() {
        const mode = els.targetMode.value;
        return mode === "range" ? { mode, range: els.targetRange.value } : { mode };
    }

    function showRangeError(message) {
        $("err-range").textContent = message || "";
        if (message) {
            els.targetRange.setAttribute("aria-invalid", "true");
        } else {
            els.targetRange.removeAttribute("aria-invalid");
        }
    }

    // Resolves the target against the document's artboards, like the host does.
    function resolveTarget() {
        const target = readTarget();
        const boards = hostStatus.hasDocument ? hostStatus.artboards || [hostStatus.artboard] : [{ index: 0, name: "Artboard", rect: FALLBACK_RECT }];
        const activeIndex = hostStatus.hasDocument ? hostStatus.artboard.index : 0;
        els.targetRangeRow.hidden = target.mode !== "range";
        els.targetRangeHint.textContent = hostStatus.hasDocument ? "of " + boards.length : "";

        if (target.mode === "selection") {
            const objects = hostStatus.hasDocument && hostStatus.selection ? hostStatus.selection.objects : [];
            if (!objects.length) {
                return { ok: false, error: "Select one or more objects to put a grid inside them.", boards: [] };
            }
            return {
                ok: true,
                boards: objects.map((object, i) => ({
                    index: object.artboard,
                    name: "Object " + (i + 1),
                    rect: object.rect,
                    areaLabel: "object",
                    object: true
                }))
            };
        }
        if (target.mode === "all") {
            return { ok: true, boards };
        }
        if (target.mode === "range") {
            const parsed = core.parseArtboardRange(target.range, boards.length);
            if (!parsed.ok) {
                return { ok: false, error: parsed.error, boards: [] };
            }
            return { ok: true, boards: parsed.indices.map((i) => boards[i]).filter(Boolean) };
        }
        return { ok: true, boards: boards.filter((b) => b.index === activeIndex).slice(0, 1) };
    }

    // ------------------------------------------------------------- validation

    function showErrors(errors) {
        document.querySelectorAll("[data-error-for]").forEach((node) => {
            if (node.id !== "err-range") {
                node.textContent = "";
            }
        });
        els.panel.querySelectorAll("[aria-invalid]").forEach((node) => {
            if (node !== els.targetRange) {
                node.removeAttribute("aria-invalid");
            }
        });

        const general = [];
        errors.forEach((error) => {
            const names = ERROR_FIELD_GROUPS[error.field] || [error.field];
            let shown = false;
            document.querySelectorAll("[data-error-for]").forEach((node) => {
                const scope = node.closest("[data-mode]");
                if (node.id === "err-range" || node.hidden || node.closest("[hidden]") ||
                    (scope && scope.dataset.mode.split(" ").indexOf(panelMode) === -1)) {
                    return;
                }
                const targets = node.dataset.errorFor.split(" ");
                if (targets.indexOf(error.field) !== -1 && node.textContent.indexOf(error.message) === -1) {
                    node.textContent = node.textContent ? node.textContent + " " + error.message : error.message;
                    shown = true;
                }
            });
            names.forEach((name) => {
                const input = field(name);
                if (input && input.setAttribute) {
                    input.setAttribute("aria-invalid", "true");
                }
            });
            if (!shown) {
                general.push(error.message);
            }
        });
        return general;
    }

    const VISIBILITY_SELECTOR = "[data-for], [data-for-output], [data-hide-for-output], [data-for-spiral], [data-for-pattern], [data-hide-for-pattern], [data-when], [data-when-equals], [data-baseline-fields]";

    // Shows each conditional element only when every condition on it holds.
    function syncVisibility(settings) {
        const isPattern = settings.type === "pattern";
        const listed = (value, item) => value.split(" ").indexOf(item) !== -1;
        document.querySelectorAll(VISIBILITY_SELECTOR).forEach((node) => {
            const d = node.dataset;
            let visible = true;
            if (d.for !== undefined) {
                visible = visible && listed(d.for, settings.type);
            }
            if (d.forOutput !== undefined) {
                visible = visible && d.forOutput === settings.output;
            }
            if (d.hideForOutput !== undefined) {
                visible = visible && d.hideForOutput !== settings.output;
            }
            if (d.forSpiral !== undefined) {
                visible = visible && settings.compSpiral === true;
            }
            if (d.forPattern !== undefined) {
                visible = visible && isPattern && listed(d.forPattern, settings.pattern);
            }
            if (d.hideForPattern !== undefined) {
                visible = visible && !(isPattern && listed(d.hideForPattern, settings.pattern));
            }
            if (d.when !== undefined) {
                visible = visible && settings[d.when] === true;
            }
            if (d.whenEquals !== undefined) {
                const [key, expected] = d.whenEquals.split("=");
                visible = visible && String(settings[key]) === expected;
            }
            if (d.baselineFields !== undefined) {
                visible = visible && (settings.type === "baseline" || ((settings.type === "columns" || settings.type === "modular") && settings.addBaseline === true));
            }
            node.hidden = !visible;
        });
        els.patternSizeLabel.textContent = PATTERN_SIZE_LABELS[settings.pattern] || "Size";
    }

    // Moves the output off a choice the current grid can't use, and says so.
    function ensureOutputAllowed() {
        const type = field("type").value;
        const output = field("output").value;
        if (output === "boxes" && !BOX_TYPES[type]) {
            field("output").value = "lines";
            say("Switched output to lines. Boxes work with column and modular grids.");
        } else if (output === "guides" && type === "pattern" && field("pattern").value === "dots") {
            field("output").value = "lines";
            say("Switched output to lines. Dot grids draw filled dots, which can't be guides.");
        }
    }

    // --------------------------------------------------------------- schematic

    const SVG_NS = "http://www.w3.org/2000/svg";

    function svgNode(name, attrs) {
        const node = document.createElementNS(SVG_NS, name);
        Object.keys(attrs).forEach((key) => node.setAttribute(key, attrs[key]));
        return node;
    }

    /*
     * Draws a built grid into an SVG. Used by the main drawing and by library tiles.
     * options: { empty: draw the page as an outline, thumb: thin out dense marks,
     *            icon: draw in the panel accent, artwork: selected paths to draw beneath }
     */
    function paintGrid(svg, result, rect, options) {
        const opts = options || {};
        const width = rect[2] - rect[0];
        const height = rect[1] - rect[3];
        const x = (v) => v - rect[0];
        const y = (v) => rect[1] - v; // Illustrator Y grows upward; SVG Y grows downward.

        svg.setAttribute("viewBox", "0 0 " + width + " " + height);
        Array.from(svg.childNodes).forEach((node) => {
            if (node.nodeName !== "title") {
                svg.removeChild(node);
            }
        });
        svg.classList.toggle("schematic--invalid", !result.ok);
        const style = result.ok ? result.settings : {};
        svg.classList.toggle("schematic--guides", style.output === "guides");
        svg.classList.toggle("schematic--dashed", style.output !== "guides" && style.lineStyle === "dashed");
        svg.classList.toggle("schematic--dotted", style.output !== "guides" && style.lineStyle === "dotted");

        const frag = document.createDocumentFragment();
        frag.appendChild(svgNode("rect", {
            class: "schematic__paper" + (opts.empty ? " schematic__paper--empty" : ""),
            x: 0, y: 0, width, height
        }));

        (opts.artwork || []).forEach((path) => {
            const p = path.points;
            if (!p.length) {
                return;
            }
            let d = "M" + x(p[0].anchor[0]) + " " + y(p[0].anchor[1]);
            const count = path.closed ? p.length : p.length - 1;
            for (let i = 1; i <= count; i++) {
                const from = p[i - 1];
                const to = p[i % p.length];
                d += " C" + x(from.right[0]) + " " + y(from.right[1]) + " " + x(to.left[0]) + " " + y(to.left[1]) + " " + x(to.anchor[0]) + " " + y(to.anchor[1]);
            }
            frag.appendChild(svgNode("path", { class: "schematic__artwork" + (path.closed ? "" : " schematic__artwork--open"), d: d + (path.closed ? " Z" : "") }));
        });

        if (result.ok) {
            const s = result.settings;
            const guides = s.output === "guides";
            const rootStyle = getComputedStyle(document.documentElement);
            // Library tiles share the panel accent, so the gallery reads as one family of icons.
            const color = opts.icon ? rootStyle.getPropertyValue("--accent").trim()
                : guides ? rootStyle.getPropertyValue("--guide").trim() : s.strokeColor;
            const marginColor = !opts.icon && !guides && s.marginColorOn ? s.marginColor : color;
            const strokeOpacity = opts.icon ? 0.95 : guides ? 1 : Math.max(0.35, s.opacity / 100);
            const colorFor = (kind) => {
                if (!opts.icon && !guides && s.kindColors && s.kindColors[kind]) {
                    return s.kindColors[kind];
                }
                return kind === "margin" ? marginColor : color;
            };
            const tracks = result.tracks;

            if (s.output !== "boxes" && !s.shadeGutters) {
                const top = s.extendToEdges ? result.artboard.top : result.content.top;
                const bottom = s.extendToEdges ? result.artboard.bottom : result.content.bottom;
                const cells = tracks.columns.length * Math.max(1, tracks.rows.length);
                if (tracks.rows.length && cells <= MAX_SCHEMATIC_CELLS) {
                    tracks.columns.forEach((col) => {
                        tracks.rows.forEach((row) => {
                            frag.appendChild(svgNode("rect", {
                                class: "schematic__track", fill: color,
                                x: x(col.left), y: y(row.top), width: col.right - col.left, height: row.top - row.bottom
                            }));
                        });
                    });
                } else {
                    tracks.columns.forEach((col) => {
                        frag.appendChild(svgNode("rect", {
                            class: "schematic__track", fill: color,
                            x: x(col.left), y: y(top), width: col.right - col.left, height: top - bottom
                        }));
                    });
                }
            }

            result.boxes.forEach((b) => {
                const rectAttrs = { x: x(b.left), y: y(b.top), width: b.right - b.left, height: b.top - b.bottom };
                if (b.kind === "block") {
                    frag.appendChild(svgNode("rect", Object.assign({ class: "schematic__block", fill: color }, rectAttrs)));
                } else if (b.kind === "gutter") {
                    frag.appendChild(svgNode("rect", Object.assign({ class: "schematic__gutter", fill: opts.icon ? color : s.gutterColor, "fill-opacity": opts.icon ? 0.25 : s.gutterOpacity / 100 }, rectAttrs)));
                } else {
                    frag.appendChild(svgNode("rect", Object.assign({ class: "schematic__box", stroke: color, fill: color, "stroke-opacity": strokeOpacity }, rectAttrs)));
                }
            });

            // Tiles are tiny: keep every Nth row and column of dots or hexagons so
            // they stay fast and still read as an even grid (thinning by list
            // position would leave diagonal stripes).
            const thin = (list, position) => {
                if (!opts.thumb || list.length <= THUMBNAIL_MAX_MARKS) {
                    return list;
                }
                const step = Math.ceil(Math.sqrt(list.length / THUMBNAIL_MAX_MARKS));
                const rank = (values) => {
                    const sorted = Array.from(new Set(values.map((v) => Math.round(v * 10)))).sort((a, b) => a - b);
                    const index = new Map(sorted.map((v, i) => [v, i]));
                    return (v) => index.get(Math.round(v * 10));
                };
                const points = list.map(position);
                const column = rank(points.map((p) => p[0]));
                const row = rank(points.map((p) => p[1]));
                return list.filter((_, i) => row(points[i][1]) % step === 0 && column(points[i][0]) % step === 0);
            };
            const centerOf = (poly) => [
                poly.points.reduce((sum, p) => sum + p[0], 0) / poly.points.length,
                poly.points.reduce((sum, p) => sum + p[1], 0) / poly.points.length
            ];

            thin(result.polygons, centerOf).forEach((poly) => {
                frag.appendChild(svgNode("polygon", {
                    class: "schematic__polygon", stroke: color, "stroke-opacity": strokeOpacity,
                    points: poly.points.map((pt) => x(pt[0]) + "," + y(pt[1])).join(" ")
                }));
            });

            result.segments.forEach((seg) => {
                frag.appendChild(svgNode("line", {
                    class: "schematic__line" + (seg.x1 !== seg.x2 && seg.y1 !== seg.y2 ? " schematic__line--diagonal" : ""),
                    stroke: colorFor(seg.kind), "stroke-opacity": strokeOpacity,
                    x1: x(seg.x1), y1: y(seg.y1), x2: x(seg.x2), y2: y(seg.y2)
                }));
            });

            result.curves.forEach((curve) => {
                const p = curve.points;
                const toward = (from, to) => " C" + x(from.right[0]) + " " + y(from.right[1]) +
                    " " + x(to.left[0]) + " " + y(to.left[1]) + " " + x(to.anchor[0]) + " " + y(to.anchor[1]);
                let d = "M" + x(p[0].anchor[0]) + " " + y(p[0].anchor[1]);
                for (let i = 1; i < p.length; i++) {
                    d += toward(p[i - 1], p[i]);
                }
                if (curve.closed) {
                    d += toward(p[p.length - 1], p[0]) + " Z";
                }
                frag.appendChild(svgNode("path", { class: "schematic__curve", stroke: colorFor(curve.kind), "stroke-opacity": strokeOpacity, d }));
            });

            // Keep dots at least ~1.2 screen pixels across so the drawing shows them.
            const box = svg.getBoundingClientRect();
            const scale = box.width && box.height ? Math.min(box.width / width, box.height / height) : 0.12;
            const minRadius = 0.6 / scale;
            thin(result.dots, (dot) => [dot.x, dot.y]).forEach((dot) => {
                frag.appendChild(svgNode("circle", {
                    class: "schematic__dot", fill: color, "fill-opacity": strokeOpacity,
                    cx: x(dot.x), cy: y(dot.y), r: Math.max(dot.d / 2, minRadius)
                }));
            });
        }
        svg.appendChild(frag);
    }

    function renderSchematic(result, rect, extra) {
        paintGrid(els.svg, result, rect, Object.assign({ empty: !hostStatus.hasDocument }, extra || {}));
        els.svg.classList.toggle("schematic--editable", panelMode === "grid" && blocksEditable(result));
    }

    // ------------------------------------------------------------------ blocks

    function blocksEditable(result) {
        return Boolean(result && result.ok && (result.settings.type === "columns" || result.settings.type === "modular"));
    }

    function renderBlocksSummary(result, settings) {
        if (settings.type !== "columns" && settings.type !== "modular") {
            return;
        }
        const count = currentBlocks.length;
        els.blocksSummary.textContent = count
            ? plural(count, "block", "blocks") + " marked. Click a block in the drawing to remove it."
            : "Drag across the drawing to mark content blocks.";
        els.blocksClear.hidden = count === 0;
    }

    // Converts a pointer position to artboard coordinates using the drawing's transform.
    function pointerToArtboard(event) {
        const matrix = els.svg.getScreenCTM();
        if (!matrix) {
            return null;
        }
        const point = els.svg.createSVGPoint();
        point.x = event.clientX;
        point.y = event.clientY;
        const local = point.matrixTransform(matrix.inverse());
        const rect = currentRect();
        return { x: rect[0] + local.x, y: rect[1] - local.y };
    }

    // Index of the track containing a position, or the nearest track when in a gutter.
    function trackIndex(tracks, value, startKey, endKey, descending) {
        let best = -1;
        let bestDistance = Infinity;
        tracks.forEach((track, i) => {
            const lo = descending ? track[endKey] : track[startKey];
            const hi = descending ? track[startKey] : track[endKey];
            const distance = value < lo ? lo - value : value > hi ? value - hi : 0;
            if (distance < bestDistance) {
                bestDistance = distance;
                best = i;
            }
        });
        return best;
    }

    function cellAt(point) {
        const result = lastResult;
        if (!blocksEditable(result) || !point) {
            return null;
        }
        const column = trackIndex(result.tracks.columns, point.x, "left", "right", false);
        const row = result.settings.type === "modular" ? trackIndex(result.tracks.rows, point.y, "top", "bottom", true) : 0;
        return column === -1 || row === -1 ? null : { column, row };
    }

    function blockFromCells(a, b) {
        return {
            column: Math.min(a.column, b.column) + 1,
            row: Math.min(a.row, b.row) + 1,
            columns: Math.abs(a.column - b.column) + 1,
            rows: Math.abs(a.row - b.row) + 1
        };
    }

    function bindBlockEditing() {
        let start = null;
        let draft = null;
        let startClient = null;

        const draftRect = (cells) => {
            const result = lastResult;
            const block = blockFromCells(cells[0], cells[1]);
            const rect = currentRect();
            const cols = result.tracks.columns;
            const left = cols[block.column - 1].left;
            const right = cols[block.column + block.columns - 2].right;
            let top = result.content.top;
            let bottom = result.content.bottom;
            if (result.settings.type === "modular") {
                top = result.tracks.rows[block.row - 1].top;
                bottom = result.tracks.rows[block.row + block.rows - 2].bottom;
            }
            return { x: left - rect[0], y: rect[1] - top, width: right - left, height: top - bottom };
        };

        els.svg.addEventListener("pointerdown", (event) => {
            const cell = cellAt(pointerToArtboard(event));
            if (!cell || event.button !== 0) {
                return;
            }
            event.preventDefault();
            els.svg.setPointerCapture(event.pointerId);
            start = cell;
            startClient = [event.clientX, event.clientY];
            draft = svgNode("rect", Object.assign({ class: "schematic__draft" }, draftRect([cell, cell])));
            els.svg.appendChild(draft);
        });

        els.svg.addEventListener("pointermove", (event) => {
            if (!start || !draft) {
                return;
            }
            const cell = cellAt(pointerToArtboard(event)) || start;
            const r = draftRect([start, cell]);
            Object.keys(r).forEach((key) => draft.setAttribute(key, r[key]));
        });

        const finish = (event, cancelled) => {
            if (!start) {
                return;
            }
            const point = pointerToArtboard(event);
            const end = cellAt(point) || start;
            const moved = Math.hypot(event.clientX - startClient[0], event.clientY - startClient[1]) > 4;
            if (draft && draft.parentNode) {
                draft.parentNode.removeChild(draft);
            }
            if (!cancelled) {
                const hit = !moved ? findBlockAt(point) : -1;
                if (hit !== -1) {
                    currentBlocks.splice(hit, 1);
                    say("Removed a block.");
                } else {
                    currentBlocks.push(blockFromCells(start, end));
                    const b = currentBlocks[currentBlocks.length - 1];
                    say("Marked a " + b.columns + " \u00d7 " + b.rows + " block.");
                }
                update();
            }
            start = null;
            draft = null;
        };
        els.svg.addEventListener("pointerup", (event) => finish(event, false));
        els.svg.addEventListener("pointercancel", (event) => finish(event, true));

        els.blocksClear.addEventListener("click", () => {
            currentBlocks = [];
            update();
            say("Cleared all blocks.");
        });
    }

    // Index into currentBlocks of the drawn block containing a point, or -1.
    function findBlockAt(point) {
        const result = lastResult;
        if (!point || !blocksEditable(result)) {
            return -1;
        }
        const blocks = result.boxes.filter((b) => b.kind === "block");
        for (let i = blocks.length - 1; i >= 0; i--) {
            const b = blocks[i];
            if (point.x >= b.left && point.x <= b.right && point.y <= b.top && point.y >= b.bottom) {
                // Drawn blocks follow currentBlocks order, skipping blocks outside the grid.
                let drawn = -1;
                for (let j = 0; j < currentBlocks.length; j++) {
                    const block = currentBlocks[j];
                    const inside = block.column <= result.tracks.columns.length &&
                        (result.settings.type !== "modular" || block.row <= result.tracks.rows.length);
                    if (inside) {
                        drawn++;
                    }
                    if (drawn === i) {
                        return j;
                    }
                }
            }
        }
        return -1;
    }

    function measure(points, units) {
        return core.formatMeasure(points, units);
    }

    function shapeWords(result) {
        const s = result.settings;
        if (result.dots.length) {
            return plural(result.dots.length, "dot", "dots");
        }
        if (result.polygons.length) {
            return plural(result.polygons.length, "hexagon", "hexagons");
        }
        if (s.output === "boxes") {
            return plural(result.boxes.filter((b) => b.kind !== "gutter").length, "box", "boxes");
        }
        const total = result.segments.length + result.curves.length;
        return s.output === "guides" ? plural(total, "guide", "guides") : plural(total, "line", "lines");
    }

    function renderReadout(result, settings, rect) {
        const units = core.UNITS.indexOf(settings.units) !== -1 ? settings.units : "pt";
        const width = rect[2] - rect[0];
        const height = rect[1] - rect[3];

        if (hostStatus.hasDocument && els.targetMode.value === "selection") {
            const count = hostStatus.selection ? hostStatus.selection.count : 0;
            els.artboardName.textContent = count ? (count === 1 ? "Selected object" : "Object 1 of " + count) : "No objects selected";
            els.artboardName.title = "";
        } else if (hostStatus.hasDocument) {
            els.artboardName.textContent = hostStatus.artboard.name;
            els.artboardName.title = hostStatus.documentName + ", " + hostStatus.artboard.name;
        } else {
            els.artboardName.textContent = "No document open";
            els.artboardName.title = "";
        }
        els.artboardSize.textContent =
            formatNumber(core.fromPoints(width, units)) + " × " + formatNumber(core.fromPoints(height, units)) + " " + units;

        if (!result.ok) {
            els.metrics.textContent = "Adjust the highlighted settings";
            els.count.textContent = "";
            return;
        }
        const m = result.metrics;
        const s = result.settings;
        if (s.type === "columns") {
            els.metrics.textContent = "Columns " + measure(m.columnWidth, units) + " wide";
        } else if (s.type === "modular") {
            els.metrics.textContent = "Modules " + formatNumber(core.fromPoints(m.columnWidth, units)) + " × " + measure(m.rowHeight, units);
        } else if (s.type === "baseline") {
            els.metrics.textContent = plural(m.baselineCount, "baseline", "baselines");
        } else if (s.type === "composition") {
            els.metrics.textContent = core.COMPOSITION_FLAGS.filter((flag) => s[flag]).map((flag) => GUIDE_NAMES[flag]).join(", ");
        } else if (s.pattern === "radial") {
            els.metrics.textContent = "Rings " + measure(m.ringSpacing, units) + " apart";
        } else {
            els.metrics.textContent = PATTERN_NAMES[s.pattern] + ", " + measure(m.cellSize, units);
        }
        const boards = targetState.ok ? targetState.boards.length : 0;
        els.count.textContent = shapeWords(result) + (boards > 1 ? " × " + boards : "");
        els.count.title = boards > 1 ? "On each of " + boards + " artboards" : "";
    }

    function renderAppearanceSummary(settings) {
        const names = { lines: "Lines", guides: "Guides", boxes: "Boxes" };
        let text = names[settings.output] || "";
        if (settings.output !== "guides") {
            text += ", " + formatNumber(settings.strokeWidth) + " pt, " + formatNumber(settings.opacity) + "%";
            if (settings.lineStyle !== "solid") {
                text += ", " + settings.lineStyle;
            }
        }
        els.appearanceSummary.textContent = text;
    }

    // ------------------------------------------------------------------ update

    // The area the drawing shows: the first selected object in selection mode, else the active artboard.
    function currentRect() {
        if (!hostStatus.hasDocument) {
            return FALLBACK_RECT;
        }
        if (els.targetMode.value === "selection" && hostStatus.selection && hostStatus.selection.objects.length) {
            return hostStatus.selection.objects[0].rect;
        }
        return hostStatus.artboard.rect;
    }

    function currentAreaLabel() {
        return els.targetMode.value === "selection" ? "object" : nouns().one;
    }

    function update() {
        const settings = readSettings();
        syncVisibility(settings);
        syncQuickControls(settings);
        if (panelMode === "construct") {
            updateConstruct(settings);
            return;
        }
        const rect = currentRect();

        targetState = resolveTarget();
        showRangeError(targetState.ok ? "" : targetState.error);

        const result = core.buildGrid(rect, settings, { areaLabel: currentAreaLabel() });
        const general = showErrors(result.errors);

        // Check the other target artboards too, so Generate never fails on the host.
        let targetError = null;
        if (result.ok && targetState.ok && hostStatus.hasDocument) {
            for (const board of targetState.boards) {
                if (!board.object && board.index === hostStatus.artboard.index) {
                    continue;
                }
                const other = core.buildGrid(board.rect, settings, { areaLabel: board.areaLabel || nouns().one });
                if (!other.ok) {
                    targetError = board.name + ": " + other.errors[0].message;
                    break;
                }
            }
        }
        lastResult = result.ok && targetError ? { ok: false, errors: [], targetError } : result;
        if (targetError) {
            general.unshift(targetError);
        }

        if (general.length) {
            say(general[0], "error");
            statusIsValidation = true;
        } else if (statusIsValidation) {
            say("");
        }
        renderSchematic(result, rect);
        renderReadout(result, settings, rect);
        renderAppearanceSummary(settings);
        renderBlocksSummary(result, settings);
        updateButtons();
        schedulePersist();
        if (els.previewToggle.checked) {
            schedulePreview(settings);
        }
    }

    // Construct mode: draws the selected artwork and its construction lines.
    function updateConstruct(settings) {
        const paths = geometry && geometry.paths ? geometry.paths : [];
        const rect = geometry && geometry.artboard ? geometry.artboard.rect : currentRect();
        const units = core.UNITS.indexOf(settings.units) !== -1 ? settings.units : "pt";
        const size = (box) => formatNumber(core.fromPoints(box.width, units)) + " \u00d7 " + formatNumber(core.fromPoints(box.height, units)) + " " + units;
        targetState = { ok: true, boards: [] };
        const result = paths.length
            ? core.buildConstruction(paths, rect, settings)
            : { ok: false, errors: [], segments: [], boxes: [], polygons: [], curves: [], dots: [] };
        lastResult = result;
        const general = showErrors(result.errors);
        if (general.length) {
            say(general[0], "error");
            statusIsValidation = true;
        } else if (statusIsValidation) {
            say("");
        }

        const card = els.constructCard;
        if (!hostStatus.hasDocument) {
            card.dataset.state = "empty";
            els.constructTitle.textContent = "No document open";
            els.constructDetail.textContent = "Open a document with a logo or artwork to construct.";
        } else if (paths.length) {
            card.dataset.state = "ready";
            els.constructTitle.textContent = "Artwork selected";
            els.constructDetail.textContent = plural(paths.length, "path", "paths") + (result.ok ? ", " + size(result.content) : "") +
                (geometry.truncated ? ". Only the first paths are used." : "");
        } else if (geometry && geometry.hasText) {
            card.dataset.state = "warning";
            els.constructTitle.textContent = "Text is selected";
            els.constructDetail.textContent = "Convert it to outlines (Type > Create Outlines), then select it again.";
        } else {
            card.dataset.state = "empty";
            els.constructTitle.textContent = "No artwork selected";
            els.constructDetail.textContent = "Select a logo or artwork to see its construction lines.";
        }

        renderSchematic(result, rect, { artwork: paths });
        els.artboardName.textContent = paths.length ? "Selected artwork" : hostStatus.hasDocument ? "No artwork selected" : "No document open";
        els.artboardName.title = "";
        els.artboardSize.textContent = result.ok ? size(result.content) : "";
        els.count.title = "";
        if (result.ok) {
            els.metrics.textContent = [
                result.metrics.keylines ? plural(result.metrics.keylines, "key line", "key lines") : "",
                settings.conCircles ? plural(result.metrics.circles, "circle", "circles") : ""
            ].filter(Boolean).join(", ") || "Construction lines";
            els.count.textContent = plural(result.shapeCount, "shape", "shapes");
        } else {
            els.metrics.textContent = paths.length ? "Adjust the highlighted settings" : "";
            els.count.textContent = "";
        }
        renderAppearanceSummary(settings);
        updateButtons();
        schedulePersist();
        if (els.previewToggle.checked) {
            schedulePreview(settings);
        }
    }

    // Keeps the opacity slider and quick color chips in step with their fields.
    function syncQuickControls(settings) {
        const opacity = Number(settings.opacity);
        if (Number.isFinite(opacity) && document.activeElement !== els.opacitySlider) {
            els.opacitySlider.value = String(opacity);
        }
        document.querySelectorAll(".quick-color").forEach((chip) => {
            chip.setAttribute("aria-pressed", String(chip.dataset.color.toUpperCase() === normalizeHex(settings.strokeColor)));
        });
    }

    async function refreshGeometry() {
        if (panelMode !== "construct") {
            return;
        }
        if (!hostStatus.hasDocument) {
            geometry = null;
            update();
            return;
        }
        const response = await queue.enqueue("selectionGeometry", undefined, { coalesce: true });
        if (response.superseded || panelMode !== "construct") {
            return;
        }
        geometry = response.ok ? response.data : null;
        if (!response.ok) {
            sayError(response);
        }
        update();
    }

    // Switches between Grid, Layouts, and Construct.
    function setMode(mode, options) {
        const silent = options && options.silent;
        const changed = mode !== panelMode;
        panelMode = PANEL_MODES.indexOf(mode) !== -1 ? mode : "grid";
        els.panel.dataset.panelMode = panelMode;
        els.panel.querySelectorAll('input[name="panel-mode"]').forEach((input) => {
            input.checked = input.value === panelMode;
        });
        if (changed && els.previewToggle.checked) {
            setPreview(false);
        }
        lastPreviewKey = "";
        // Messages about the previous mode's work would be misleading here.
        if (changed && !statusIsValidation) {
            say("");
        }
        library.open = panelMode === "layouts";
        if (library.open) {
            renderLibraryChips();
            renderLibraryGrid();
            if (!silent) {
                els.librarySearch.focus();
            }
        } else if (library.observer) {
            library.observer.disconnect();
        }
        storage.updateUi({ panelMode, libraryCategory: library.category });
        if (panelMode === "construct") {
            refreshGeometry();
        }
        update();
    }

    function updateButtons() {
        const hasDoc = hostStatus.hasDocument;
        const valid = Boolean(lastResult && lastResult.ok);
        const targetOk = targetState.ok;
        const layer = hasDoc && hostStatus.gridLayer ? hostStatus.gridLayer : { exists: false };
        els.generate.disabled = busy || !hasDoc || !valid || !targetOk || panelMode === "layouts";
        els.clear.disabled = busy || !hasDoc || !targetOk;
        els.testLine.disabled = busy || !hasDoc;
        els.previewToggle.disabled = !hasDoc;
        els.toggleVisible.disabled = !layer.exists;
        els.toggleLock.disabled = !hasDoc;
        els.presetDelete.disabled = els.presetSelect.value.indexOf("user:") !== 0;
        const selectionMode = els.targetMode.value === "selection";
        els.formatApply.disabled = busy || !hasDoc || selectionMode || !els.formatSelect.value;
        els.formatRotate.disabled = !els.formatSelect.value;
        [els.alignCheck, els.alignSelect, els.alignSnap].forEach((button) => {
            button.disabled = busy || !hasDoc;
        });
        els.leadingFromText.disabled = !hasDoc;
        els.pageMargins.disabled = busy || !hasDoc || selectionMode || !valid;
    }

    function setIconButton(button, icon, label, engaged) {
        button.querySelector("use").setAttribute("href", "#" + icon);
        button.querySelector("[data-label]").textContent = label;
        button.title = label;
        button.dataset.engaged = String(engaged);
    }

    function syncLayerButtons() {
        const layer = hostStatus.hasDocument && hostStatus.gridLayer ? hostStatus.gridLayer : { exists: false, visible: true };
        const hidden = layer.exists && !layer.visible;
        setIconButton(els.toggleVisible, hidden ? "i-eye-off" : "i-eye", hidden ? "Show grids" : "Hide grids", hidden);
        syncLockButton();
    }

    function syncLockButton() {
        const locked = field("lockLayer").checked;
        setIconButton(els.toggleLock, locked ? "i-lock" : "i-unlock", locked ? "Unlock grids" : "Lock grids", locked);
    }

    function schedulePersist() {
        window.clearTimeout(persistTimer);
        persistTimer = window.setTimeout(() => {
            storage.set(STORAGE_SETTINGS, cleanSettings(readSettings()));
            storage.updateUi({ target: readTarget() });
        }, 300);
    }

    function applyStatus(status) {
        if (!status) {
            return;
        }
        const hadDocument = hostStatus.hasDocument;
        hostStatus = status;
        if (!status.hasDocument) {
            if (els.previewToggle.checked) {
                setPreview(false, { silent: true });
            }
            say("Open or create a document to add a grid.");
        } else {
            if (!hadDocument) {
                say("");
            }
            // The layer's real lock state wins over the remembered setting.
            if (status.gridLayer && status.gridLayer.exists) {
                field("lockLayer").checked = status.gridLayer.locked;
            }
        }
        syncLayerButtons();
        applyNouns();
        update();
        refreshLibraryIfStale();
        refreshGeometry();
    }

    /*
     * A panel left open keeps running the code it loaded, even after the
     * extension's files change (an update, or a development build). Remember
     * the files' modification times and offer a reload when they move on.
     */
    const PANEL_FILES = ["client/app.js", "client/index.html", "client/styles.css", "shared/grid-core.js", "shared/layouts.js", "shared/formats.js", "host/index.jsx"];
    let loadedStamp = null;
    let updateOffered = false;

    function filesStamp() {
        const cepFs = window.cep && window.cep.fs;
        if (!cepFs || typeof cepFs.stat !== "function") {
            return null;
        }
        const root = decodeURIComponent(window.location.pathname).replace(/client\/index\.html$/, "");
        return PANEL_FILES.map((file) => {
            const info = cepFs.stat(root + file);
            return info && info.err === 0 && info.data.mtime ? String(info.data.mtime) : "";
        }).join("|");
    }

    // Offers the reload once, and again each time the user comes back to the panel.
    function checkForUpdate(force) {
        if ((updateOffered && !force) || loadedStamp === null) {
            return;
        }
        const stamp = filesStamp();
        if (stamp !== null && stamp !== loadedStamp) {
            updateOffered = true;
            say("Mullion was updated.", "warning", { label: "Reload panel", run: () => window.location.reload() });
        }
    }

    async function refreshStatus(force) {
        const now = Date.now();
        if (!force && now - lastStatusAt < STATUS_THROTTLE_MS) {
            return;
        }
        lastStatusAt = now;
        checkForUpdate(force);
        const result = await queue.enqueue("status", undefined, { coalesce: true });
        if (result.superseded) {
            return;
        }
        if (result.ok) {
            applyStatus(result.data);
        } else {
            sayError(result);
        }
    }

    // ----------------------------------------------------------------- preview

    function previewKey(settings) {
        return JSON.stringify([
            hostStatus.documentName,
            hostStatus.artboard && hostStatus.artboard.index,
            targetState.boards.map((b) => [b.index].concat(b.rect)),
            readMode(),
            panelMode,
            panelMode === "construct" && geometry ? geometry.paths : null,
            cleanSettings(settings)
        ]);
    }

    function schedulePreview(settings) {
        window.clearTimeout(previewTimer);
        if (!hostStatus.hasDocument || !lastResult || !lastResult.ok || !targetState.ok || panelMode === "layouts") {
            return;
        }
        const key = previewKey(settings);
        if (key === lastPreviewKey) {
            return;
        }
        const target = readTarget();
        const mode = readMode();
        previewTimer = window.setTimeout(async () => {
            lastPreviewKey = key;
            const payload = panelMode === "construct" ? { settings, kind: "construction" } : { settings, target, mode };
            const response = await queue.enqueue("preview", payload, { coalesce: true });
            if (response.superseded || !els.previewToggle.checked) {
                return;
            }
            if (response.ok) {
                hostStatus = response.data.status;
                syncLayerButtons();
                const where = panelMode === "construct" ? "the selected artwork"
                    : readTarget().mode === "selection"
                    ? plural(response.data.artboards, "object", "objects")
                    : response.data.artboards > 1 ? areaWords(response.data.artboards) : hostStatus.artboard.name;
                say("Previewing on " + where + ".");
            } else {
                lastPreviewKey = "";
                sayError(response);
            }
        }, PREVIEW_DELAY_MS);
    }

    async function setPreview(on, options) {
        const silent = options && options.silent;
        els.previewToggle.checked = on;
        window.clearTimeout(previewTimer);
        lastPreviewKey = "";
        if (on) {
            update();
            return;
        }
        queue.drop("preview");
        if (options && options.skipHost) {
            return;
        }
        const response = await queue.enqueue("clearPreview", undefined, { coalesce: true });
        if (response.superseded || silent) {
            return;
        }
        if (response.ok) {
            say(response.data.removed ? "Preview removed." : "");
        } else {
            sayError(response);
        }
    }

    // ----------------------------------------------------------------- actions

    async function generate() {
        if (els.generate.disabled) {
            return;
        }
        const settings = readSettings();
        const target = readTarget();
        const mode = readMode();
        // Generating replaces the preview on the host, so stop previewing first.
        if (els.previewToggle.checked) {
            setPreview(false, { skipHost: true });
        }
        queue.drop("preview");
        const construct = panelMode === "construct";
        const response = await queue.enqueue("generate", construct ? { settings, kind: "construction" } : { settings, target, mode });
        if (response.superseded) {
            return;
        }
        if (response.ok && construct) {
            hostStatus = response.data.status;
            syncLayerButtons();
            say((response.data.replaced ? "Redrew the construction lines" : "Drew construction lines") + " for the selected artwork (" +
                plural(response.data.shapes, "shape", "shapes") + ").", "ok");
            update();
        } else if (response.ok) {
            const data = response.data;
            hostStatus = data.status;
            syncLayerButtons();
            const where = target.mode === "selection"
                ? (data.artboards === 1 ? "the selected object" : plural(data.artboards, "object", "objects"))
                : data.artboards > 1 ? areaWords(data.artboards) : data.status.artboard.name;
            const name = GRID_NAMES[settings.type];
            const article = /^[aeiou]/.test(name) ? "an " : "a ";
            const shapes = " (" + plural(data.shapes, "shape", "shapes") + ").";
            let message = data.replaced
                ? "Replaced " + plural(data.replaced, "grid", "grids") + " on " + where + " with " + article + name + shapes
                : "Added " + article + name + " to " + where + shapes;
            if (data.rescued) {
                message += " Kept " + plural(data.rescued, "item", "items") + " you had added to the old grid.";
            }
            say(message, "ok");
            update();
        } else {
            sayError(response);
            if (response.error && response.error.code === "NO_DOCUMENT") {
                refreshStatus(true);
            }
        }
    }

    async function clear() {
        if (els.clear.disabled) {
            return;
        }
        if (els.previewToggle.checked) {
            setPreview(false, { silent: true });
        }
        queue.drop("preview");
        const target = readTarget();
        const construct = panelMode === "construct";
        const response = await queue.enqueue("clear", construct ? { kind: "construction" } : { target });
        if (response.superseded) {
            return;
        }
        if (!response.ok) {
            sayError(response);
            return;
        }
        const data = response.data;
        hostStatus = data.status;
        syncLayerButtons();
        if (construct) {
            say(data.removed
                ? "Cleared construction lines from " + data.status.artboard.name + "."
                : "No construction lines to clear on " + data.status.artboard.name + ".", data.removed ? "ok" : undefined);
            update();
            return;
        }
        const where = target.mode === "active" ? data.status.artboard.name
            : target.mode === "selection" ? plural(data.targetArtboards, "selected object", "selected objects")
                : areaWords(data.targetArtboards);
        let message = data.removed
            ? "Cleared " + plural(data.removed, "grid", "grids") + " from " + where + "."
            : "No Mullion grids to clear on " + where + ".";
        if (data.rescued) {
            message += " Kept " + plural(data.rescued, "item", "items") + " you had added to a grid; " +
                (data.rescued === 1 ? "it is" : "they are") + " now directly on the layer.";
        }
        say(message, data.removed ? "ok" : undefined);
        update();
    }

    async function setGridLayer(changes, message) {
        const response = await queue.enqueue("setGridLayer", changes);
        if (response.superseded) {
            return;
        }
        if (response.ok) {
            hostStatus = response.data.status;
            syncLayerButtons();
            updateButtons();
            if (message && response.data.changed) {
                say(message);
            }
        } else {
            sayError(response);
        }
    }

    function toggleVisible() {
        const layer = hostStatus.gridLayer;
        if (!layer || !layer.exists) {
            return;
        }
        setGridLayer({ visible: !layer.visible }, layer.visible ? "Grids hidden." : "Grids shown.");
    }

    function toggleLock() {
        const locked = !field("lockLayer").checked;
        field("lockLayer").checked = locked;
        syncLockButton();
        schedulePersist();
        if (hostStatus.gridLayer && hostStatus.gridLayer.exists) {
            setGridLayer({ locked }, locked ? "Grids locked." : "Grids unlocked.");
        } else {
            say(locked ? "New grids will be locked." : "New grids will stay unlocked.");
        }
    }

    async function drawTestLine() {
        const response = await queue.enqueue("drawTestLine");
        if (response.superseded) {
            return;
        }
        if (response.ok) {
            say("Drew a test line across " + response.data.artboard.name + ". Clear removes it.", "ok");
            refreshStatus(true);
        } else {
            sayError(response);
        }
    }

    // ----------------------------------------------------------------- resize

    function renderFormats() {
        const select = els.formatSelect;
        select.textContent = "";
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "Choose a size";
        select.appendChild(placeholder);
        formats.GROUPS.forEach((groupName) => {
            const group = document.createElement("optgroup");
            group.label = groupName;
            formats.FORMATS.filter((f) => f.group === groupName).forEach((format) => {
                const option = document.createElement("option");
                option.value = format.id;
                option.textContent = formats.label(format, formatSwapped);
                group.appendChild(option);
            });
            select.appendChild(group);
        });
    }

    async function resizeTo(width, height, units, label) {
        const target = els.targetMode.value === "selection" ? { mode: "active" } : readTarget();
        const response = await queue.enqueue("resizeArtboards", { width, height, units, target });
        if (response.superseded) {
            return;
        }
        if (!response.ok) {
            sayError(response);
            return;
        }
        applyStatus(response.data.status);
        const where = target.mode === "active" ? response.data.status.artboard.name : areaWords(response.data.resized);
        const size = width + " \u00d7 " + height + " " + units;
        say("Resized " + where + " to " + (label ? label + " (" + size + ")" : size) + ". Generate to fit the grid to the new size.", "ok");
    }

    function resizeToFormat() {
        const format = formats.find(els.formatSelect.value);
        if (!format) {
            return;
        }
        const width = formatSwapped ? format.height : format.width;
        const height = formatSwapped ? format.width : format.height;
        resizeTo(width, height, format.units, format.name);
    }

    // ------------------------------------------------------------------ align

    async function alignObjects(action) {
        const response = await queue.enqueue("alignSelection", { settings: readSettings(), action });
        if (response.superseded) {
            return;
        }
        if (!response.ok) {
            sayError(response);
            return;
        }
        const d = response.data;
        hostStatus = d.status;
        const checked = plural(d.checked, "object", "objects");
        if (action === "snap") {
            const skipped = d.skipped ? " Skipped " + plural(d.skipped, "locked or hidden object", "locked or hidden objects") + "." : "";
            say(d.moved ? "Snapped " + plural(d.moved, "object", "objects") + " to the grid." + skipped : "All " + checked + " already sit on the grid.", "ok");
        } else if (action === "select") {
            say(d.offGrid ? "Selected " + plural(d.offGrid, "off-grid object", "off-grid objects") + "." : "All " + checked + " sit on the grid; nothing selected.");
        } else {
            say(d.offGrid
                ? d.offGrid + " of " + checked + " " + (d.offGrid === 1 ? "is" : "are") + " off the grid, by up to " + measure(d.maxOffset, currentUnits) + "."
                : "All " + checked + " sit on the grid.", d.offGrid ? undefined : "ok",
            d.offGrid ? { label: "Snap to grid", run: () => alignObjects("snap") } : null);
        }
        update();
    }

    async function leadingFromText() {
        const response = await queue.enqueue("textMetrics");
        if (response.superseded) {
            return;
        }
        if (!response.ok) {
            sayError(response);
            return;
        }
        const t = response.data;
        const spacing = formatNumber(core.fromPoints(t.leading, currentUnits));
        field("baselineSpacing").value = spacing;
        rememberExact("baselineSpacing", t.leading, "pt");
        update();
        say("Baseline set to " + formatNumber(t.leading) + " pt from the selected text (" +
            (t.font ? t.font + ", " : "") + formatNumber(t.size) + "/" + formatNumber(t.leading) + (t.autoLeading ? " auto" : "") + ").", "ok");
    }

    // ------------------------------------------------------- export / import

    const PRESET_FILE_FORMAT = "mullion-presets";

    function presetFileText() {
        return JSON.stringify({
            format: PRESET_FILE_FORMAT,
            version: 1,
            presets: loadPresets().map((p) => ({ name: p.name, settings: p.settings }))
        }, null, 2);
    }

    function exportPresets() {
        const presets = loadPresets();
        if (!presets.length) {
            say("Save a preset first; there are no presets to export.", "error");
            return;
        }
        const text = presetFileText();
        const fileName = "grid-presets.json";
        const cepFs = window.cep && window.cep.fs;
        if (cepFs) {
            const choice = cepFs.showSaveDialogEx("Export presets", "", ["json"], fileName);
            if (choice.err || !choice.data) {
                return;
            }
            const written = cepFs.writeFile(choice.data, text);
            if (written.err) {
                say("Couldn't write the presets file. Choose a folder you can save to.", "error");
                return;
            }
        } else {
            const link = document.createElement("a");
            link.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
            link.download = fileName;
            link.click();
            URL.revokeObjectURL(link.href);
        }
        say("Exported " + plural(presets.length, "preset", "presets") + ".", "ok");
    }

    // Adds presets from a file; names that already exist get a number instead of being overwritten.
    function importPresetText(text) {
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            say("That file isn't a presets file.", "error");
            return;
        }
        if (!data || data.format !== PRESET_FILE_FORMAT || !Array.isArray(data.presets)) {
            say("That file isn't a presets file.", "error");
            return;
        }
        const presets = loadPresets();
        const names = new Set(presets.map((p) => p.name));
        let added = 0;
        data.presets.forEach((entry) => {
            if (!entry || typeof entry.name !== "string" || !entry.name.trim() || !entry.settings || typeof entry.settings !== "object") {
                return;
            }
            let name = entry.name.trim().slice(0, 40);
            for (let n = 2; names.has(name); n++) {
                name = entry.name.trim().slice(0, 34) + " (" + n + ")";
            }
            names.add(name);
            presets.push({ name, settings: cleanSettings(entry.settings), savedAt: new Date().toISOString() });
            added++;
        });
        presets.sort((a, b) => a.name.localeCompare(b.name));
        storage.set(STORAGE_PRESETS, presets);
        renderPresets("");
        say(added ? "Imported " + plural(added, "preset", "presets") + "." : "The file had no presets to import.", added ? "ok" : undefined);
    }

    function importPresets() {
        const cepFs = window.cep && window.cep.fs;
        if (cepFs) {
            const choice = cepFs.showOpenDialogEx(false, false, "Import presets", "", ["json"]);
            if (choice.err || !choice.data || !choice.data.length) {
                return;
            }
            const read = cepFs.readFile(choice.data[0]);
            if (read.err) {
                say("Couldn't read that file.", "error");
                return;
            }
            importPresetText(read.data);
            return;
        }
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json,application/json";
        input.addEventListener("change", () => {
            const file = input.files && input.files[0];
            if (file) {
                file.text().then(importPresetText);
            }
        });
        input.click();
    }

    // ----------------------------------------------------------------- presets

    function loadPresets() {
        const list = storage.get(STORAGE_PRESETS);
        if (!Array.isArray(list)) {
            return [];
        }
        return list.filter((p) => p && typeof p.name === "string" && p.name && p.settings && typeof p.settings === "object");
    }

    // Preset menu values are "user:<name>". Ready-made layouts live in the library.
    function renderPresets(selectedValue) {
        const presets = loadPresets();
        const select = els.presetSelect;
        select.textContent = "";
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = presets.length ? "Your presets" : "No saved presets";
        select.appendChild(placeholder);
        presets.forEach((preset) => {
            const option = document.createElement("option");
            option.value = "user:" + preset.name;
            option.textContent = preset.name;
            select.appendChild(option);
        });
        const values = Array.from(select.options).map((o) => o.value);
        select.value = values.indexOf(selectedValue) !== -1 ? selectedValue : "";
        select.disabled = presets.length === 0;
        updateButtons();
    }

    function openPresetSave() {
        els.presetRow.hidden = true;
        els.presetSaveRow.hidden = false;
        const current = els.presetSelect.value;
        els.presetName.value = current.indexOf("user:") === 0 ? current.slice(5) : "";
        els.presetName.focus();
        els.presetName.select();
    }

    function closePresetSave() {
        els.presetSaveRow.hidden = true;
        els.presetRow.hidden = false;
    }

    function savePreset() {
        const name = els.presetName.value.trim();
        if (!name) {
            say("Enter a name to save these settings as a preset.", "error");
            els.presetName.focus();
            return;
        }
        const presets = loadPresets();
        const settings = cleanSettings(readSettings());
        const existing = presets.findIndex((p) => p.name === name);
        const entry = { name, settings, savedAt: new Date().toISOString() };
        if (existing === -1) {
            presets.push(entry);
        } else {
            presets[existing] = entry;
        }
        presets.sort((a, b) => a.name.localeCompare(b.name));
        if (!storage.set(STORAGE_PRESETS, presets)) {
            say("Couldn't save the preset. Panel storage is unavailable.", "error");
            return;
        }
        closePresetSave();
        renderPresets("user:" + name);
        say((existing === -1 ? "Saved" : "Updated") + " preset “" + name + "”.", "ok");
    }

    // Applies settings from a preset or layout while keeping the document's lock state.
    function applySettings(settings, message) {
        const locked = field("lockLayer").checked;
        writeSettings(settings);
        field("lockLayer").checked = locked;
        syncLockButton();
        const margins = MARGIN_FIELDS.map((key) => field(key).value);
        setMarginsLinked(margins.every((v) => v === margins[0]));
        ensureOutputAllowed();
        update();
        say(message);
    }

    function applyPreset(value) {
        const name = value.slice(5);
        const preset = loadPresets().find((p) => p.name === name);
        if (!preset) {
            updateButtons();
            return;
        }
        applySettings(preset.settings, "Loaded preset \u201c" + name + "\u201d.");
    }

    // Layouts change layout fields only, sized for the active artboard; appearance stays.
    function applyLayout(id) {
        const layout = layouts.find(id);
        if (!layout) {
            return;
        }
        const resolved = layouts.resolveLayout(layout, currentRect(), currentUnits);
        const note = layout.relative ? "Margins are sized for this " + currentAreaLabel() + "." : layouts.describeArtboard(layout);
        applySettings(Object.assign(cleanSettings(readSettings()), resolved), "Applied \u201c" + layout.name + "\u201d." + (note ? " " + note : ""));
        if (panelMode === "layouts") {
            say(els.status.textContent, "ok", { label: "Edit settings", run: () => setMode("grid") });
        }
        // Offer to resize when a layout made for a size lands on a different artboard.
        const a = layout.artboard;
        if (a && hostStatus.hasDocument && els.targetMode.value !== "selection") {
            const rect = currentRect();
            const wanted = { width: core.toPoints(a.width, a.units), height: core.toPoints(a.height, a.units) };
            const differs = Math.abs(rect[2] - rect[0] - wanted.width) > 1 || Math.abs(rect[1] - rect[3] - wanted.height) > 1;
            if (differs) {
                say(els.status.textContent, undefined, {
                    label: "Resize " + nouns().one + " to " + a.width + " \u00d7 " + a.height + " " + a.units,
                    run: () => resizeTo(a.width, a.height, a.units, layout.name)
                });
            }
        }
        library.selected = id;
        els.libraryGrid.querySelectorAll(".tile").forEach((tile) => {
            tile.setAttribute("aria-pressed", String(tile.dataset.layout === id));
        });
        storage.updateUi({ lastLayout: id });
    }

    // ----------------------------------------------------------------- library

    const library = {
        open: false,
        category: "",
        selected: "",
        renderedFor: "",
        observer: null
    };

    function libraryList() {
        const query = els.librarySearch.value.trim().toLowerCase();
        if (query) {
            return layouts.LAYOUTS.filter((l) => (l.name + " " + l.category).toLowerCase().indexOf(query) !== -1);
        }
        if (library.category === "Suggested") {
            return layouts.suggestLayouts(currentRect(), 12);
        }
        if (library.category === "All") {
            return layouts.LAYOUTS;
        }
        return layouts.LAYOUTS.filter((l) => l.category === library.category);
    }

    function renderLibraryChips() {
        const suggestions = layouts.suggestLayouts(currentRect(), 12);
        const names = layouts.CATEGORIES.slice(0, 1).concat(suggestions.length ? ["Suggested"] : [], ["All"], layouts.CATEGORIES.slice(1));
        if (names.indexOf(library.category) === -1) {
            library.category = layouts.CATEGORIES[0];
        }
        els.libraryChips.textContent = "";
        names.forEach((name) => {
            const label = document.createElement("label");
            label.className = "chip";
            const input = document.createElement("input");
            input.type = "radio";
            input.name = "library-category";
            input.value = name;
            input.checked = name === library.category;
            const span = document.createElement("span");
            span.textContent = name;
            label.append(input, span);
            els.libraryChips.appendChild(label);
        });
    }

    function paintTile(tile) {
        const layout = layouts.find(tile.dataset.layout);
        const svg = tile.querySelector("svg");
        const fixedSize = layout.artboard;
        const rect = fixedSize
            ? [0, core.toPoints(fixedSize.height, fixedSize.units), core.toPoints(fixedSize.width, fixedSize.units), 0]
            : currentRect();
        const settings = Object.assign(cleanSettings(readSettings()), layouts.resolveLayout(layout, rect, currentUnits));
        if (settings.output === "boxes" && !BOX_TYPES[settings.type]) {
            settings.output = "lines";
        }
        if (settings.output === "guides" && settings.type === "pattern" && settings.pattern === "dots") {
            settings.output = "lines";
        }
        const result = core.buildGrid(rect, settings);
        paintGrid(svg, result, rect, { thumb: true, icon: true });
        tile.classList.toggle("tile--unfit", !result.ok);
        if (!result.ok) {
            tile.querySelector(".tile__meta").textContent = "Doesn't fit this artboard";
        }
    }

    function renderLibraryGrid() {
        const list = libraryList();
        const query = els.librarySearch.value.trim();
        if (library.observer) {
            library.observer.disconnect();
        }
        els.libraryGrid.textContent = "";
        library.renderedFor = JSON.stringify([currentRect(), currentUnits]);

        if (!list.length) {
            els.libraryHint.textContent = query ? "No layouts match \u201c" + query + "\u201d." : "No layouts in this group.";
            return;
        }
        if (query) {
            els.libraryHint.textContent = plural(list.length, "layout matches", "layouts match") + " \u201c" + query + "\u201d.";
        } else if (library.category === "Suggested") {
            els.libraryHint.textContent = "Made for artboards shaped like this one.";
        } else {
            els.libraryHint.textContent = plural(list.length, "layout", "layouts") + ". Select one to apply it; thumbnails show your artboard.";
        }

        library.observer = typeof IntersectionObserver === "function"
            ? new IntersectionObserver((entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        library.observer.unobserve(entry.target);
                        paintTile(entry.target);
                    }
                });
            }, { root: els.libraryGrid, rootMargin: "120px" })
            : null;

        const fragment = document.createDocumentFragment();
        list.forEach((layout) => {
            const item = document.createElement("li");
            const tile = document.createElement("button");
            tile.type = "button";
            tile.className = "tile";
            tile.dataset.layout = layout.id;
            tile.setAttribute("aria-pressed", String(layout.id === library.selected));
            tile.title = layout.name + (layout.artboard ? ", " + layouts.describeShort(layout) : "");
            const art = document.createElementNS(SVG_NS, "svg");
            art.setAttribute("class", "tile__art schematic");
            art.setAttribute("preserveAspectRatio", "xMidYMid meet");
            art.setAttribute("aria-hidden", "true");
            const name = document.createElement("span");
            name.className = "tile__name";
            name.textContent = layout.name;
            const meta = document.createElement("span");
            meta.className = "tile__meta";
            meta.textContent = layouts.describeShort(layout);
            tile.append(art, name, meta);
            item.appendChild(tile);
            fragment.appendChild(item);
        });
        els.libraryGrid.appendChild(fragment);
        els.libraryGrid.scrollTop = 0;
        els.libraryGrid.querySelectorAll(".tile").forEach((tile) => {
            if (library.observer) {
                library.observer.observe(tile);
            } else {
                paintTile(tile);
            }
        });
    }

    // Thumbnails depend on the artboard; redraw them if it changed while the library is open.
    function refreshLibraryIfStale() {
        if (library.open && library.renderedFor !== JSON.stringify([currentRect(), currentUnits])) {
            renderLibraryChips();
            renderLibraryGrid();
        }
    }

    function deletePreset() {
        const value = els.presetSelect.value;
        if (value.indexOf("user:") !== 0) {
            return;
        }
        const name = value.slice(5);
        storage.set(STORAGE_PRESETS, loadPresets().filter((p) => p.name !== name));
        renderPresets("");
        say("Deleted preset “" + name + "”.");
    }

    // ------------------------------------------------------------------ inputs

    function convertUnits(from, to) {
        LENGTH_FIELDS.forEach((name) => {
            const input = field(name);
            const exact = exactValue(name, from);
            const value = exact !== null ? exact : core.parseNumber(input.value);
            if (Number.isFinite(value)) {
                const points = core.toPoints(value, from);
                input.value = formatNumber(core.fromPoints(points, to));
                exactPoints[name] = points;
            }
        });
    }

    function setMarginsLinked(linked) {
        marginsLinked = linked;
        els.marginLink.setAttribute("aria-pressed", String(linked));
        els.marginLink.title = linked ? "Margins are linked. Select to set each side separately." : "Use the same margin on all sides";
        storage.updateUi({ marginsLinked: linked });
    }

    function onControlInput(event) {
        const target = event.target;
        if (!target || !target.name || target.form !== els.form) {
            return;
        }
        if (target.name === "units") {
            if (target.value === currentUnits) {
                return;
            }
            convertUnits(currentUnits, target.value);
            currentUnits = target.value;
            updateUnitLabels();
        }
        if (target.name === "type" || target.name === "pattern") {
            ensureOutputAllowed();
        }
        if (LENGTH_FIELDS.indexOf(target.name) !== -1) {
            rememberExact(target.name, target.value, currentUnits);
        }
        if (marginsLinked && MARGIN_FIELDS.indexOf(target.name) !== -1) {
            MARGIN_FIELDS.forEach((name) => {
                if (name !== target.name) {
                    field(name).value = target.value;
                    exactPoints[name] = exactPoints[target.name];
                }
            });
        }
        if (COLOR_FIELDS.indexOf(target.name) !== -1) {
            syncSwatches();
        }
        update();
    }

    function stepField(name, direction, multiplier) {
        const input = field(name);
        const step = (parseFloat(input.step) || 1) * (multiplier || 1);
        let value = (core.parseNumber(input.value) || 0) + direction * step;
        if (input.min !== "") {
            value = Math.max(parseFloat(input.min), value);
        }
        if (input.max !== "") {
            value = Math.min(parseFloat(input.max), value);
        }
        input.value = formatNumber(value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    // Shift + arrow keys step number fields by ten.
    function onFieldKeydown(event) {
        const input = event.target;
        if (!event.shiftKey || input.type !== "number" || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) {
            return;
        }
        event.preventDefault();
        stepField(input.name, event.key === "ArrowUp" ? 1 : -1, 10);
    }

    // Stepper buttons repeat while held, like Illustrator's own spinners.
    function bindSteppers() {
        let delay = 0;
        let repeat = 0;
        const stop = () => {
            window.clearTimeout(delay);
            window.clearInterval(repeat);
        };
        document.querySelectorAll(".stepper__button").forEach((button) => {
            button.addEventListener("pointerdown", (event) => {
                if (event.button !== 0) {
                    return;
                }
                event.preventDefault();
                const run = () => stepField(button.dataset.field, Number(button.dataset.step), event.shiftKey ? 10 : 1);
                run();
                stop();
                delay = window.setTimeout(() => {
                    repeat = window.setInterval(run, STEP_REPEAT_MS);
                }, STEP_REPEAT_DELAY_MS);
            });
            ["pointerup", "pointerleave", "pointercancel"].forEach((type) => button.addEventListener(type, stop));
        });
        window.addEventListener("blur", stop);
    }

    function setStageCollapsed(collapsed) {
        els.stage.classList.toggle("stage--collapsed", collapsed);
        els.stageToggle.setAttribute("aria-expanded", String(!collapsed));
        els.stageToggle.title = collapsed ? "Show the drawing" : "Hide the drawing";
    }

    function bindEvents() {
        // Controls live both inside the form and in the toolbar (form="settings"),
        // so listen on the whole panel.
        els.panel.addEventListener("input", onControlInput);
        els.panel.addEventListener("change", (event) => {
            const t = event.target;
            if (t.type === "radio" || t.type === "checkbox" || t.tagName === "SELECT") {
                onControlInput(event);
            }
            if (COLOR_FIELDS.indexOf(t.name) !== -1) {
                t.value = normalizeHex(t.value);
                update();
            }
        });
        els.form.addEventListener("keydown", onFieldKeydown);
        els.form.addEventListener("submit", (event) => event.preventDefault());
        bindSteppers();

        document.querySelectorAll("[data-swatch-for]").forEach((swatch) => {
            swatch.addEventListener("input", () => {
                field(swatch.dataset.swatchFor).value = swatch.value.toUpperCase();
                update();
            });
        });

        els.marginLink.addEventListener("click", () => {
            const linked = !marginsLinked;
            setMarginsLinked(linked);
            if (linked) {
                const top = field("marginTop").value;
                MARGIN_FIELDS.forEach((name) => {
                    field(name).value = top;
                    exactPoints[name] = exactPoints.marginTop;
                });
                update();
            }
        });

        els.targetMode.addEventListener("change", () => {
            if (els.targetMode.value === "selection") {
                refreshStatus(true);
            }
            update();
            if (els.targetMode.value === "range") {
                els.targetRange.focus();
            }
        });
        els.targetRange.addEventListener("input", update);
        bindBlockEditing();
        els.leadingFromText.addEventListener("click", leadingFromText);
        els.alignCheck.addEventListener("click", () => alignObjects("check"));
        els.alignSelect.addEventListener("click", () => alignObjects("select"));
        els.alignSnap.addEventListener("click", () => alignObjects("snap"));
        els.formatSelect.addEventListener("change", updateButtons);
        els.formatRotate.addEventListener("click", () => {
            formatSwapped = !formatSwapped;
            els.formatRotate.setAttribute("aria-pressed", String(formatSwapped));
            const selected = els.formatSelect.value;
            renderFormats();
            els.formatSelect.value = selected;
            updateButtons();
        });
        els.formatApply.addEventListener("click", resizeToFormat);
        els.presetsExport.addEventListener("click", exportPresets);
        els.pageMargins.addEventListener("click", applyPageMargins);
        els.presetsImport.addEventListener("click", importPresets);
        els.addMode.addEventListener("change", () => {
            storage.updateUi({ addMode: els.addMode.checked });
            update();
        });
        els.toggleVisible.addEventListener("click", toggleVisible);
        els.toggleLock.addEventListener("click", toggleLock);
        els.refresh.addEventListener("click", () => {
            refreshStatus(true).then(() => say("Read the document again."));
        });

        els.stageToggle.addEventListener("click", () => {
            const collapsed = !els.stage.classList.contains("stage--collapsed");
            setStageCollapsed(collapsed);
            storage.updateUi({ stageCollapsed: collapsed });
        });
        els.appearance.addEventListener("toggle", () => storage.updateUi({ appearanceOpen: els.appearance.open }));

        els.previewToggle.addEventListener("change", () => setPreview(els.previewToggle.checked));
        els.generate.addEventListener("click", generate);
        els.clear.addEventListener("click", clear);
        els.testLine.addEventListener("click", drawTestLine);

        els.panel.querySelectorAll('input[name="panel-mode"]').forEach((input) => {
            input.addEventListener("change", () => setMode(input.value));
        });
        document.querySelectorAll(".quick-color").forEach((chip) => {
            chip.addEventListener("click", () => {
                field("strokeColor").value = chip.dataset.color;
                syncSwatches();
                update();
            });
        });
        els.opacitySlider.addEventListener("input", () => {
            field("opacity").value = els.opacitySlider.value;
            update();
        });
        els.librarySearch.addEventListener("input", renderLibraryGrid);
        els.libraryChips.addEventListener("change", (event) => {
            library.category = event.target.value;
            els.librarySearch.value = "";
            renderLibraryGrid();
        });
        els.libraryGrid.addEventListener("click", (event) => {
            const tile = event.target.closest(".tile");
            if (tile) {
                applyLayout(tile.dataset.layout);
            }
        });
        els.library.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                if (els.librarySearch.value) {
                    els.librarySearch.value = "";
                    renderLibraryGrid();
                } else {
                    setMode("grid");
                    els.panel.querySelector('input[name="panel-mode"][value="layouts"]').focus();
                }
            }
        });

        els.presetNew.addEventListener("click", openPresetSave);
        els.presetSave.addEventListener("click", savePreset);
        els.presetCancel.addEventListener("click", closePresetSave);
        els.presetName.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                savePreset();
            } else if (event.key === "Escape") {
                event.preventDefault();
                closePresetSave();
            }
        });
        els.presetSelect.addEventListener("change", () => applyPreset(els.presetSelect.value));
        els.presetDelete.addEventListener("click", deletePreset);
        els.reset.addEventListener("click", () => {
            const locked = field("lockLayer").checked;
            writeSettings(core.defaults());
            field("lockLayer").checked = locked;
            syncLockButton();
            setMarginsLinked(true);
            update();
            say("Settings reset to defaults.");
        });

        // Cmd/Ctrl + Enter generates from anywhere in the panel.
        document.addEventListener("keydown", (event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                generate();
            }
        });

        // Illustrator has no artboard-change event, so re-read the document
        // whenever the user returns to the panel.
        window.addEventListener("focus", () => refreshStatus(true));
        els.panel.addEventListener("mouseenter", () => refreshStatus(false));
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden) {
                refreshStatus(true);
            }
        });
        ["documentAfterActivate", "documentAfterDeactivate"].forEach((type) => {
            bridge.on(type, () => refreshStatus(true));
        });
        bridge.on(bridge.themeEvent, () => {
            applyTheme(bridge.skin());
            update();
        });

        window.addEventListener("beforeunload", () => {
            // Save now: the debounced save may not have run yet when the panel closes.
            window.clearTimeout(persistTimer);
            storage.set(STORAGE_SETTINGS, cleanSettings(readSettings()));
            storage.updateUi({ target: readTarget() });
            if (els.previewToggle.checked) {
                bridge.fire("clearPreview");
            }
        });
    }

    // -------------------------------------------------------------------- init

    function init() {
        if (!core) {
            say("Mullion is missing its grid engine. Reinstall the extension.", "error");
            return;
        }
        applyTheme(bridge.skin());
        writeSettings(storage.get(STORAGE_SETTINGS) || core.defaults());

        const ui = storage.get(STORAGE_UI) || {};
        const margins = MARGIN_FIELDS.map((name) => field(name).value);
        const marginsMatch = margins.every((value) => value === margins[0]);
        setMarginsLinked(typeof ui.marginsLinked === "boolean" ? ui.marginsLinked && marginsMatch : marginsMatch);
        setStageCollapsed(ui.stageCollapsed === true);
        els.appearance.open = ui.appearanceOpen !== false;
        els.addMode.checked = ui.addMode === true;
        library.category = typeof ui.libraryCategory === "string" ? ui.libraryCategory : "";
        library.selected = typeof ui.lastLayout === "string" ? ui.lastLayout : "";
        if (ui.target && typeof ui.target.mode === "string") {
            setSelectValue(els.targetMode, ui.target.mode, "active");
            els.targetRange.value = typeof ui.target.range === "string" ? ui.target.range : "";
        }

        renderPresets("");
        renderFormats();
        applyNouns();
        syncLayerButtons();
        loadedStamp = filesStamp();
        bindEvents();
        setMode(PANEL_MODES.indexOf(ui.panelMode) !== -1 ? ui.panelMode : "grid", { silent: true });
        refreshStatus(true);
        if (bridge.kind === "mock") {
            document.documentElement.dataset.host = "mock";
            // Browser-only hooks for the smoke test; never present inside Illustrator.
            window.__mullionTest = { importPresetText, presetFileText };
        }
    }

    init();
}());
