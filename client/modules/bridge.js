/*
 * How the panel talks to Illustrator — and how it pretends to, in a browser.
 *
 * Two bridges with the same shape, chosen at startup:
 *
 *  - **The CEP bridge** is the real one. It hands a URI-encoded JSON payload to
 *    ExtendScript via CSInterface.evalScript and parses the `{ok, data|error}`
 *    envelope that comes back. It also has to ask CEP for the ordinary editing
 *    shortcuts, because Illustrator swallows Cmd-A, Cmd-C and friends before a
 *    panel ever sees them — without that, selecting a number in a field and
 *    typing appends instead of replacing.
 *  - **The mock bridge** runs the whole panel in an ordinary browser against a
 *    fake document, which is how the UI is developed and how the automated
 *    panel tests run. Add ?theme=, ?nodoc or ?host=indesign to the URL.
 *
 * If you are adding a host call, it needs a name in HOST_METHODS
 * (modules/constants.js), an endpoint in host/index.jsx, and an answer from
 * the mock bridge so the browser build keeps working.
 */
(function (root) {
    "use strict";

    const { core, PANEL_VERSION, HOST_METHODS } = root.constants;


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

        /*
         * Illustrator swallows the ordinary editing shortcuts before a panel
         * ever sees them, so Select All, Copy, Paste, Cut and Undo do nothing
         * inside a field: select a number, type, and the digits append instead
         * of replacing. A panel has to ask for the keys it wants.
         */
        function claimEditingShortcuts() {
            const keys = [];
            // A, C, V, X, Z with Command (macOS) and with Control (Windows).
            [65, 67, 86, 88, 90].forEach((keyCode) => {
                keys.push({ keyCode, metaKey: true });
                keys.push({ keyCode, ctrlKey: true });
                keys.push({ keyCode, metaKey: true, shiftKey: true }); // Redo
                keys.push({ keyCode, ctrlKey: true, shiftKey: true });
            });
            try {
                cs.registerKeyEventsInterest(JSON.stringify(keys));
            } catch (e) {
                // Older hosts may not offer it; the fields still work, they just
                // need the mouse to select what is in them.
            }
        }
        claimEditingShortcuts();

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
            // so these two signals mean GuideComposer itself is gone: boot and retry once.
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
            // The version of the host files on disk. Booting evaluates them
            // again, so a fresh boot reports an extension updated since launch.
            // This works the same on Windows and macOS: the path comes from CEP,
            // never from the panel's own URL.
            async version(options) {
                const booted = await ((options && options.fresh) || !booting ? boot() : booting);
                return booted.ok && booted.data ? booted.data.version || null : null;
            },
            app() {
                const env = cs.getHostEnvironment();
                return env ? { name: env.appName, version: env.appVersion, locale: env.appLocale } : {};
            },
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
                // Only generated grids count as replaced; sweeping our own
                // preview is not something to tell the user about.
                const finals = state.groups.filter((g) => g.kind === "final" && g.construction).length;
                state.groups = state.groups.filter((g) => g.kind !== "preview" && !(kind === "final" && g.construction));
                const replaced = kind === "final" ? finals : 0;
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
            const settings = payload.settings || {};
            const layers = [settings].concat((settings.overlayTypes || [])
                .map((type) => Object.assign({}, settings, { type, overlayTypes: [] })));
            for (const board of resolved.boards) {
                for (const layer of layers) {
                    const grid = core.buildGrid(board.rect, layer, { areaLabel: board.areaLabel });
                    if (!grid.ok) {
                        const prefix = resolved.boards.length > 1 ? board.name + ": " : "";
                        return fail("INVALID_SETTINGS", prefix + (layer === settings ? "" : "Overlay grid: ") + grid.errors[0].message, grid.errors);
                    }
                    shapes += grid.shapeCount;
                    metrics = metrics || grid.metrics;
                }
            }
            const indices = resolved.boards.map((b) => b.index);
            const replacing = payload.mode !== "add";
            state.groups = state.groups.filter((g) => g.kind !== "preview");
            const before = state.groups.length;
            if (kind === "final" && replacing) {
                state.groups = state.groups.filter((g) => indices.indexOf(g.artboard) === -1);
            }
            const replaced = before - state.groups.length;
            resolved.boards.forEach((b) => layers.forEach(() => state.groups.push({ kind, artboard: b.index, settings: payload.settings })));
            state.layer = state.layer || { visible: true, locked: false };
            state.layer.visible = true;
            if (kind === "final") {
                state.layer.locked = payload.settings.lockLayer === true;
            }
            return ok({ shapes, artboards: resolved.boards.length, layers: layers.length, metrics, replaced, rescued: 0, hidden: 0, status: status() });
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
            // Grids record the settings that drew them, as tags in the real host.
            documentGrid: () => {
                if (!state.hasDocument) {
                    return noDocument;
                }
                const grid = state.groups.find((g) => g.kind === "final" && g.artboard === 0 && g.settings);
                return grid ? ok({ found: true, schema: 1, settings: grid.settings, area: "artboard:0" }) : ok({ found: false });
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

        // Development hook: makes the next calls answer slowly, so the panel's
        // working and timed-out states can be exercised in a browser.
        let stallMs = 0;

        return {
            kind: "mock",
            // How many grids are on the active artboard, for the panel tests.
            groupCount() {
                return state.groups.filter((g) => g.kind === "final" && g.artboard === 0).length;
            },
            call(method, payload) {
                const delay = stallMs || 60;
                stallMs = 0;
                return new Promise((resolve) => {
                    window.setTimeout(() => resolve(handlers[method](payload || {})), delay);
                });
            },
            stall(ms) {
                stallMs = Number(ms) || 0;
            },
            version() {
                return Promise.resolve(params.get("hostversion") || PANEL_VERSION);
            },
            app() {
                return { name: mockHost === "indesign" ? "IDSN" : "ILST", version: "0.0 (mock)", locale: "en_US" };
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

    Object.assign(root, { createCepBridge, createMockBridge, hostError });
}(window.MullionUI = window.MullionUI || {}));
