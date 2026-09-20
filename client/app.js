/*
 * GuideComposer panel controller.
 *
 * Runs in CEP's embedded Chromium (88+, Illustrator 2022 and later). Opened in
 * an ordinary browser it switches to a mock host so the UI can be developed
 * without Illustrator: add ?theme=light|mediumlight|mediumdark|dark and
 * ?nodoc to the URL to try other states.
 *
 * This file is the controller: it owns the DOM, the panel's live state, and
 * what happens when you click something. Parts that can stand on their own live
 * in modules/ and are loaded by index.html before this file:
 *
 *   constants.js   every tunable number, field list and word list
 *   storage.js     settings, presets, and the backup that outlives an update
 *   queue.js       one host call at a time, with coalescing
 *   bridge.js      talking to Illustrator, and pretending to in a browser
 *   theme.js       matching the host's interface brightness
 *   fields.js      which settings are visible, and where errors appear
 *   schematic.js   turning grid geometry into SVG
 *
 * docs/ARCHITECTURE.md explains the whole project, including why these are
 * plain scripts sharing a namespace rather than ES modules.
 *
 * Data flow
 *   controls -> readSettings()/readTarget() -> MullionCore.buildGrid() per target artboard
 *            -> drawing, readout, and inline errors
 *            -> (preview on) debounced, serialized host preview
 *   buttons  -> queue -> bridge.call(method, payload) -> host JSON response
 */
(function () {
    "use strict";

    /*
     * Every shared constant, field list and vocabulary table comes from
     * modules/constants.js. Destructured rather than used through a namespace
     * object so the code below reads the same as it always has.
     */
    const {
        core,
        layouts,
        STORAGE_SETTINGS,
        STORAGE_PRESETS,
        STORAGE_UI,
        PANEL_VERSION,
        PREVIEW_DELAY_MS,
        PREVIEW_MAX_SHAPES,
        HOST_TIMEOUT_MS,
        MUTATING_METHODS,
        WORKING_DELAY_MS,
        STATUS_THROTTLE_MS,
        UNDO_MS,
        UPDATE_CHECK_MS,
        STEP_REPEAT_DELAY_MS,
        STEP_REPEAT_MS,
        SHORT_PANEL_PX,
        FALLBACK_RECT,
        MAX_SCHEMATIC_CELLS,
        THUMBNAIL_MAX_MARKS,
        TILE_LEGIBLE_MARKS,
        formats,
        HOST_METHODS,
        LENGTH_FIELDS,
        MARGIN_FIELDS,
        NUMBER_FIELDS,
        BOOLEAN_FIELDS,
        TEXT_FIELDS,
        OFF_WHEN_EMPTY,
        NOUNS,
        COLOR_FIELDS,
        CHOICE_FIELDS,
        SELECT_FIELDS,
        UNIT_STEPS,
        GRID_NAMES,
        PATTERN_NAMES,
        PATTERN_SIZE_LABELS,
        GUIDE_NAMES,
        PANEL_MODES,
        BOX_TYPES,
        ERROR_FIELD_GROUPS,
        SUPERSEDED,
        PRESET_FILE_FORMAT,
        PRESET_FILE_VERSION,
        MAX_IMPORT_PRESETS
    } = window.MullionUI.constants;

    // Settings, presets, and the backup that survives an Illustrator update: modules/storage.js.
    const {
        configureStorage, storage, storageWrite, storageWriteUi,
        loadPresets, writePresets, restorePresetsIfOrphaned
    } = window.MullionUI;

    // Real and mock host bridges: modules/bridge.js.
    const { createCepBridge, createMockBridge, hostError } = window.MullionUI;

    // Host calls run one at a time: modules/queue.js.
    const { createQueue } = window.MullionUI;

    // Panel colours follow the host's interface brightness: modules/theme.js.
    const { applyTheme } = window.MullionUI;

    // ----------------------------------------------------------------- elements

    const $ = (id) => document.getElementById(id);
    const els = {
        panel: $("panel"),
        form: $("settings"),
        stage: document.querySelector(".stage"),
        stageToggle: $("stage-toggle"),
        svg: $("schematic"),
        svgTitle: $("schematic-title"),
        progress: $("progress"),
        fieldErrors: $("field-errors"),
        panelVersion: $("panel-version"),
        copyDiagnostics: $("copy-diagnostics"),
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
        outputNote: $("output-note"),
        controls: $("controls"),
        library: $("library"),
        constructCard: $("construct-card"),
        constructTitle: $("construct-title"),
        constructDetail: $("construct-detail"),
        opacitySlider: $("opacity-slider"),
        librarySearch: $("library-search"),
        libraryFilter: $("library-filter"),
        overlayTypes: $("overlay-types"),
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
        loadDocumentGrid: $("load-document-grid"),
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
            // An empty optional field means "off", not "invalid".
            s[name] = field(name).value === "" && OFF_WHEN_EMPTY[name] !== undefined
                ? OFF_WHEN_EMPTY[name]
                : field(name).value;
        });
        TEXT_FIELDS.forEach((name) => {
            s[name] = field(name).value;
        });
        s.blocks = currentBlocks.map((b) => Object.assign({}, b));
        s.overlayTypes = readOverlayTypes();
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

    /*
     * Grid types drawn over the main one. They are the same five types, minus
     * whichever is currently the main grid, so the row never offers to overlay a
     * grid on itself.
     */
    const TYPE_LABELS = { columns: "Columns", modular: "Modular", baseline: "Baseline", composition: "Compose", pattern: "Pattern" };

    function readOverlayTypes() {
        const chosen = [];
        els.overlayTypes.querySelectorAll("input:checked").forEach((input) => {
            if (input.value !== field("type").value) {
                chosen.push(input.value);
            }
        });
        return chosen;
    }

    function writeOverlayTypes(list) {
        const wanted = Array.isArray(list) ? list : [];
        els.overlayTypes.querySelectorAll("input").forEach((input) => {
            input.checked = wanted.indexOf(input.value) !== -1;
        });
    }

    function renderOverlayTypes() {
        const main = field("type").value;
        const chosen = readOverlayTypes();
        els.overlayTypes.textContent = "";
        Object.keys(TYPE_LABELS).forEach((type) => {
            if (type === main) {
                return; // A grid is not an overlay of itself.
            }
            const label = document.createElement("label");
            label.className = "overlay-type";
            const input = document.createElement("input");
            input.type = "checkbox";
            input.value = type;
            input.checked = chosen.indexOf(type) !== -1;
            input.addEventListener("change", update);
            const text = document.createElement("span");
            text.textContent = TYPE_LABELS[type];
            label.append(input, text);
            els.overlayTypes.appendChild(label);
        });
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
            // Leave optional fields blank when they are off, so the field reads
            // as "Off" rather than as a number someone has to interpret.
            field(name).value = OFF_WHEN_EMPTY[name] === s[name] ? "" : formatNumber(s[name]);
        });
        TEXT_FIELDS.forEach((name) => {
            field(name).value = s[name];
        });
        currentBlocks = s.blocks;
        renderOverlayTypes();
        writeOverlayTypes(s.overlayTypes);
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
        // Arrow keys and the stepper buttons move a length by one step of its
        // own unit: 1 pt, but 0.05 in, so an arrow never jumps a whole inch.
        const step = UNIT_STEPS[currentUnits] || 1;
        LENGTH_FIELDS.forEach((name) => {
            const input = field(name);
            if (input) {
                input.step = String(step);
            }
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
    let lastDocumentName = null;
    let previewDrawn = false; // Whether a live preview may be on the document.
    /*
     * Previewing is on to begin with, but it waits for the user to ask for
     * something before it draws: opening the panel, or switching to another
     * document, must not put anything into work the user has not touched.
     */
    let previewArmed = false;
    let previewQuiet = false; // The next preview resumes after Generate; it says nothing.
    let geometry = null; // Selected artwork paths, for construction lines.
    let geometryKey = "";

    const bridge = window.__adobe_cep__ && typeof window.CSInterface === "function" ? createCepBridge() : createMockBridge();
    const queue = createQueue(bridge, onBusyChange, onStalledChange, appName);

    // ------------------------------------------------------------------ status

    /*
     * The status line is a small model, not a string in the DOM: re-reading its
     * textContent would pick up the label of an action button and concatenate
     * messages. A message can carry several actions, and a notice (an update
     * prompt) is kept aside so a routine message never destroys it.
     */
    let statusState = { message: "", tone: null, actions: [] };
    let statusNotice = null; // { message, tone, actions }, re-shown when the line clears.
    let lastErrorMessage = "";
    let undoTimer = 0;

    function renderStatus() {
        const shown = statusState.message || !statusNotice ? statusState : statusNotice;
        els.status.textContent = shown.message || "";
        if (shown.tone) {
            els.status.dataset.tone = shown.tone;
        } else {
            delete els.status.dataset.tone;
        }
        shown.actions.forEach((action) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "link-button";
            button.textContent = action.label;
            button.addEventListener("click", action.run);
            els.status.appendChild(button);
        });
    }

    // Shows a status message with any number of follow-up action buttons.
    /*
     * Who last wrote the status line. Previewing chatters as you work, so it is
     * allowed to replace its own messages and an empty line, never something the
     * panel said because the user asked for it.
     */
    let statusSource = "user";

    function sayFromPreview(message, tone) {
        say(message, tone);
        statusSource = "preview";
    }

    function previewMaySpeak() {
        return !statusState.message || statusSource === "preview";
    }

    function say(message, tone, actions) {
        statusSource = "user";
        statusIsValidation = false;
        if (tone === "error" && message) {
            lastErrorMessage = message; // Kept for the diagnostics a customer sends us.
        }
        const list = !actions ? [] : Array.isArray(actions) ? actions.filter(Boolean) : [actions];
        statusState = { message: message || "", tone: tone || null, actions: list };
        renderStatus();
    }

    // Adds another action to the message already shown, keeping its text intact.
    function addStatusAction(action) {
        if (!action) {
            return;
        }
        statusState.actions = statusState.actions.concat([action]);
        renderStatus();
    }

    /*
     * A notice the panel must not lose: it survives background refreshes and
     * routine messages, and comes back whenever the status line is cleared.
     */
    function sayNotice(message, tone, actions) {
        statusNotice = { message, tone: tone || null, actions: !actions ? [] : Array.isArray(actions) ? actions : [actions] };
        say(message, tone, statusNotice.actions);
    }

    // Offers an Undo for a few seconds after a change that can't be taken back.
    function offerUndo(message, tone, undo) {
        window.clearTimeout(undoTimer);
        const mine = {
            label: "Undo",
            run: () => {
                window.clearTimeout(undoTimer);
                undo();
            }
        };
        say(message, tone, mine);
        undoTimer = window.setTimeout(() => {
            if (statusState.actions.indexOf(mine) !== -1) {
                statusState.actions = statusState.actions.filter((a) => a !== mine);
                renderStatus();
            }
        }, UNDO_MS);
    }

    // ------------------------------------------------------------------- focus

    // Somewhere focus can always go: the tab for the mode the panel is in.
    function focusAnchor() {
        const tab = els.panel.querySelector('input[name="panel-mode"]:checked');
        if (tab) {
            tab.focus({ preventScroll: true });
        }
    }

    /*
     * Hiding the element that holds the keyboard focus drops focus on <body>,
     * which ends the keyboard path through the panel. Move it somewhere stable
     * before the element disappears.
     */
    function rescueFocus(node) {
        const active = document.activeElement;
        if (active && active !== document.body && node.contains(active)) {
            focusAnchor();
        }
    }

    // The first control a mode should hand the keyboard when it opens.
    function focusMode(mode) {
        const first = mode === "layouts" ? els.librarySearch
            : mode === "construct" ? field("conBounds")
            : els.panel.querySelector('input[name="type"]:checked');
        if (first) {
            first.focus({ preventScroll: true });
        }
    }

    // ----------------------------------------------------------- working state

    let workingTimer = 0;

    /*
     * Illustrator can take seconds to draw a large grid. A busy cursor alone
     * reads as a frozen panel, so any call that isn't answered quickly shows a
     * progress bar and names what the panel is waiting for.
     */
    function setWorking(on) {
        els.panel.dataset.working = String(on);
        els.progress.hidden = !on;
    }

    function onBusyChange(isBusy) {
        busy = isBusy;
        els.panel.setAttribute("aria-busy", String(isBusy));
        if (isBusy) {
            if (!workingTimer && els.panel.dataset.working !== "true") {
                workingTimer = window.setTimeout(() => {
                    workingTimer = 0;
                    setWorking(true);
                }, WORKING_DELAY_MS);
            }
        } else {
            window.clearTimeout(workingTimer);
            workingTimer = 0;
            setWorking(false);
        }
        updateButtons();
    }

    // The host is still running a call the panel gave up on.
    function onStalledChange(stalled) {
        if (!stalled) {
            say(appName() + " answered. The panel is ready again.");
        }
        updateButtons();
    }

    function appName() {
        return hostStatus.host === "indesign" ? "InDesign" : "Illustrator";
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
            console.warn("[GuideComposer] host detail:", error.detail);
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

    // Which settings are visible, and where their errors appear: modules/fields.js.
    const { configureFields, showErrors, syncVisibility, ensureOutputAllowed } = window.MullionUI;

    // --------------------------------------------------------------- schematic

    // Turning engine geometry into the SVG the panel draws: modules/schematic.js.
    const { SVG_NS, svgNode, tileZoom, paintGrid } = window.MullionUI;

    let lastRender = null;

    function renderSchematic(result, rect, extra) {
        lastRender = { result, rect, extra };
        const options = Object.assign({ empty: !hostStatus.hasDocument }, extra || {});
        const overlays = options.overlays || [];
        delete options.overlays;
        paintGrid(els.svg, result, rect, options);
        // Overlay grids are drawn into the same picture, fainter than the main one.
        overlays.forEach((overlay) => {
            paintGrid(els.svg, overlay, rect, Object.assign({}, options, { append: true, dim: true }));
        });
        els.svg.classList.toggle("schematic--editable", panelMode === "grid" && blocksEditable(result));
    }

    /*
     * Dot radii and the smallest visible mark are worked out from the drawing's
     * measured size, so a drawing painted while collapsed (0 × 0) or before a
     * resize is wrong until it is painted again.
     */
    function repaintDrawing() {
        if (!lastRender || !els.svg.getClientRects().length) {
            return;
        }
        renderSchematic(lastRender.result, lastRender.rect, lastRender.extra);
    }

    // The drawing is one image to a screen reader: its title says what it shows.
    function describeSchematic(result) {
        const where = panelMode === "construct" ? "the selected artwork"
            : hostStatus.hasDocument ? hostStatus.artboard.name
            : "an empty " + nouns().one;
        const what = result && result.ok
            ? els.metrics.textContent + ", " + els.count.textContent
            : "settings that don't make a grid yet";
        els.svgTitle.textContent = "Drawing of " + what + " on " + where + ".";
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
        // Blocks are marked by dragging on the drawing. There is no keyboard
        // path for it, so the summary says so rather than leaving it unsaid.
        els.blocksSummary.textContent = count
            ? plural(count, "block", "blocks") + " marked. Click a block in the drawing to remove it (mouse or pen only)."
            : "Drag across the drawing to mark content blocks.";
        // The fact that this needs a pointer matters to someone using a
        // keyboard or a screen reader, and clutters the panel for everyone else.
        els.blocksSummary.title = count ? "" : "Marking blocks needs a mouse, trackpad or pen.";
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

    function cellAt(point, from) {
        const result = from || lastResult;
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
        /*
         * The grid the drag started on. A background refresh (or any edit) can
         * replace lastResult mid-drag, and a failed build carries no tracks at
         * all, so the drag is measured against this snapshot and abandoned if
         * the drawing under the pointer is no longer the one being dragged on.
         */
        let dragResult = null;

        const draftRect = (cells) => {
            const result = dragResult;
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

        // Ends the drag without marking anything: the grid it started on is gone.
        const abandon = () => {
            if (draft && draft.parentNode) {
                draft.parentNode.removeChild(draft);
            }
            start = null;
            draft = null;
            dragResult = null;
        };

        const dragValid = () => Boolean(start && draft && dragResult && dragResult === lastResult);

        els.svg.addEventListener("pointerdown", (event) => {
            const cell = cellAt(pointerToArtboard(event), lastResult);
            if (!cell || event.button !== 0) {
                return;
            }
            event.preventDefault();
            els.svg.setPointerCapture(event.pointerId);
            dragResult = lastResult;
            start = cell;
            startClient = [event.clientX, event.clientY];
            draft = svgNode("rect", Object.assign({ class: "schematic__draft" }, draftRect([cell, cell])));
            els.svg.appendChild(draft);
        });

        els.svg.addEventListener("pointermove", (event) => {
            if (!start) {
                return;
            }
            if (!dragValid()) {
                abandon();
                return;
            }
            const cell = cellAt(pointerToArtboard(event), dragResult) || start;
            const r = draftRect([start, cell]);
            Object.keys(r).forEach((key) => draft.setAttribute(key, r[key]));
        });

        const finish = (event, cancelled) => {
            if (!start) {
                return;
            }
            if (!dragValid()) {
                abandon();
                return;
            }
            const point = pointerToArtboard(event);
            const end = cellAt(point, dragResult) || start;
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

    function renderReadout(result, settings, rect, overlays) {
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
            describeSchematic(result);
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
        const stacked = (overlays || []).length;
        if (stacked) {
            // The readout names every grid that Generate will draw, in order.
            els.metrics.textContent = [GRID_NAMES[s.type]].concat((settings.overlayTypes || []).map((t) => GRID_NAMES[t]))
                .map((name) => name.replace(/^(a |an |set of )/, "")).join(" + ");
        }
        const total = (result.shapeCount || 0) + (overlays || []).reduce((sum, o) => sum + (o.shapeCount || 0), 0);
        els.count.textContent = (stacked ? plural(total, "shape", "shapes") : shapeWords(result)) + (boards > 1 ? " × " + boards : "");
        els.count.title = boards > 1 ? "On each of " + boards + " " + nouns().many : "";
        describeSchematic(result);
    }

    /*
     * Three words on a segmented control do not explain themselves. This says
     * what the choice actually does to the document, in the terms a designer
     * thinks in: something you can style, something that snaps, or filled
     * shapes.
     */
    const OUTPUT_NOTES = {
        lines: "Real artwork on its own non-printing layer. Style it with the color and width below.",
        guides: "Illustrator guides: your artwork snaps to them and they never print. Their colour comes from Illustrator's preferences, not from here.",
        boxes: "One filled box per module instead of lines, handy as a background to place things on."
    };

    function renderAppearanceSummary(settings) {
        els.outputNote.textContent = OUTPUT_NOTES[settings.output] || "";
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

    let lastMainType = "";

    function update() {
        if (field("type").value !== lastMainType) {
            lastMainType = field("type").value;
            renderOverlayTypes();
        }
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

        /*
         * Anything that disables Generate has to say why in the status line:
         * an inline error under a field the user isn't looking at (or inside a
         * collapsed section) leaves the button looking broken.
         */
        const blocking = general[0] ||
            (!targetState.ok ? targetState.error : "") ||
            (!result.ok && result.errors.length ? result.errors[0].message : "");
        if (blocking) {
            say(blocking, "error");
            statusIsValidation = true;
        } else if (statusIsValidation) {
            say("");
        }
        // Overlay grids are built from the same settings with a different type,
        // exactly as the host will draw them.
        const overlays = [];
        (settings.overlayTypes || []).forEach((type) => {
            const built = core.buildGrid(rect, Object.assign({}, settings, { type, overlayTypes: [] }), { areaLabel: currentAreaLabel() });
            if (built.ok) {
                overlays.push(built);
            } else if (result.ok) {
                // The overlay is what is wrong, so say which one.
                say(TYPE_LABELS[type] + " overlay: " + built.errors[0].message, "error");
                statusIsValidation = true;
            }
        });
        renderSchematic(result, rect, { overlays });
        renderReadout(result, settings, rect, overlays);
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
        const blocking = general[0] || (!result.ok && result.errors.length ? result.errors[0].message : "");
        if (blocking) {
            say(blocking, "error");
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
        describeSchematic(result);
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

    // Reads the selected artwork's paths. Reading many paths takes Illustrator a
    // while, so this only runs again when the selection looks different, unless forced.
    async function refreshGeometry(force) {
        if (panelMode !== "construct") {
            return;
        }
        if (!hostStatus.hasDocument) {
            geometry = null;
            geometryKey = "";
            update();
            return;
        }
        const key = JSON.stringify([hostStatus.documentName, hostStatus.selection]);
        if (!force && geometry && key === geometryKey) {
            return;
        }
        geometryKey = key;
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
        lastPreviewKey = "";
        // Messages about the previous mode's work would be misleading here.
        if (changed && !statusIsValidation) {
            say("");
        }
        library.open = panelMode === "layouts";
        // Leaving Layouts hides the search box, which may hold the focus.
        if (changed && !library.open) {
            rescueFocus(els.library);
        }
        if (library.open) {
            renderLibraryChips();
            renderLibraryGrid();
        } else if (library.observer) {
            library.observer.disconnect();
        }
        // Entering a mode hands the keyboard that mode's first control, unless
        // the mode was changed with the arrow keys: those move between the tabs
        // themselves, and focus has to stay there to keep moving.
        if (changed && !silent && !(options && options.keepFocus)) {
            focusMode(panelMode);
        }
        storageWriteUi({ panelMode, libraryCategory: library.category });
        if (panelMode === "construct") {
            refreshGeometry(true);
        }
        update();
    }

    // Why Generate can't be used right now, in the user's terms.
    function generateBlockedReason() {
        if (queue.stalled()) {
            return appName() + " is still working on the last request.";
        }
        if (!hostStatus.hasDocument) {
            return "Open or create a document to add a grid.";
        }
        if (panelMode === "layouts") {
            return "Choose a layout, then switch to Grid to generate it.";
        }
        if (!targetState.ok) {
            return targetState.error;
        }
        if (panelMode === "construct" && !(geometry && geometry.paths && geometry.paths.length)) {
            return "Select the artwork to draw construction lines for.";
        }
        if (!(lastResult && lastResult.ok)) {
            return "Adjust the highlighted settings first.";
        }
        return busy ? appName() + " is working." : "";
    }

    function updateButtons() {
        const hasDoc = hostStatus.hasDocument;
        const valid = Boolean(lastResult && lastResult.ok);
        const targetOk = targetState.ok;
        const layer = hasDoc && hostStatus.gridLayer ? hostStatus.gridLayer : { exists: false };
        els.generate.disabled = busy || !hasDoc || !valid || !targetOk;
        // A disabled Generate always says why, on the button as well as in the
        // status line: a button that does nothing and explains nothing reads as
        // a broken panel.
        els.generate.title = els.generate.disabled ? generateBlockedReason() : "";
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
            if (storageWrite(STORAGE_SETTINGS, cleanSettings(readSettings()), "your settings", true)) {
                storageWriteUi({ target: readTarget() });
            }
        }, 300);
    }

    // Whether the panel has seen a document; null until the first status arrives.
    let hadDocument = null;

    function applyStatus(status) {
        if (!status) {
            return;
        }
        const changed = status.hasDocument !== hadDocument;
        if (status.documentName !== lastDocumentName) {
            // Another document: nothing is drawn into it until the user asks.
            lastDocumentName = status.documentName;
            previewArmed = false;
        }
        hadDocument = status.hasDocument;
        hostStatus = status;
        if (!status.hasDocument) {
            if (els.previewToggle.checked) {
                // The panel is stopping, not the user; their choice is kept.
                setPreview(false, { silent: true, remember: false });
            }
            /*
             * Only on the way into the no-document state. Saying it on every
             * background refresh would wipe out whatever the status line holds,
             * including errors, update prompts and offered actions.
             */
            if (changed) {
                say("Open or create a document to add a grid.");
            }
        } else {
            if (changed) {
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
     * A panel left open keeps running the JavaScript it loaded, even after the
     * extension's files change (an update, or a development build). The host is
     * evaluated from disk on every boot, so booting it again and comparing the
     * version it reports with this panel's names the update exactly. Nothing
     * here depends on the panel's own URL, so it works the same on Windows,
     * where location.pathname starts "/C:/".
     */
    let hostVersion = null;
    let offeredVersion = "";
    let lastUpdateCheckAt = 0;

    async function checkForUpdate(force) {
        const now = Date.now();
        if (!force && now - lastUpdateCheckAt < UPDATE_CHECK_MS) {
            return;
        }
        lastUpdateCheckAt = now;
        const version = await bridge.version({ fresh: hostVersion !== null });
        if (!version) {
            return;
        }
        hostVersion = version;
        showVersion();
        if (version !== PANEL_VERSION && version !== offeredVersion) {
            offeredVersion = version;
            // A notice, so a background refresh or a routine message can't lose it.
            sayNotice("GuideComposer " + version + " is installed; this panel is still running " + PANEL_VERSION + ".",
                "warning", { label: "Reload panel", run: () => window.location.reload() });
        }
    }

    function showVersion() {
        els.panelVersion.textContent = hostVersion && hostVersion !== PANEL_VERSION
            ? PANEL_VERSION + " (installed: " + hostVersion + ")"
            : PANEL_VERSION;
    }

    async function refreshStatus(force) {
        const now = Date.now();
        if (!force && now - lastStatusAt < STATUS_THROTTLE_MS) {
            return;
        }
        lastStatusAt = now;
        if (force) {
            checkForUpdate(false);
        }
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
        // Layouts previews too: picking a tile should show it on the page.
        if (!previewArmed || !hostStatus.hasDocument || !lastResult || !lastResult.ok || !targetState.ok) {
            return;
        }
        const key = previewKey(settings);
        if (key === lastPreviewKey) {
            return;
        }
        const shapes = (lastResult.shapeCount || 0) * Math.max(1, panelMode === "construct" ? 1 : targetState.boards.length);
        if (shapes > PREVIEW_MAX_SHAPES) {
            previewQuiet = false;
            lastPreviewKey = key;
            queue.drop("preview");
            if (previewDrawn) {
                previewDrawn = false;
                queue.enqueue("clearPreview", undefined, { coalesce: true });
            }
            if (previewMaySpeak()) {
                sayFromPreview("Preview paused: " + shapes.toLocaleString("en-US") + " shapes is too many to redraw on every change. Generate draws them.", "warning");
            }
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
                previewDrawn = true;
                hostStatus = response.data.status;
                syncLayerButtons();
                const where = panelMode === "construct" ? "the selected artwork"
                    : readTarget().mode === "selection"
                    ? plural(response.data.artboards, "object", "objects")
                    : response.data.artboards > 1 ? areaWords(response.data.artboards) : hostStatus.artboard.name;
                /*
                 * Previewing is something the panel does on its own, so it never
                 * talks over something the user asked for: a result, a warning,
                 * an error, or a message still offering an action.
                 */
                if (previewQuiet || !previewMaySpeak()) {
                    previewQuiet = false;
                } else {
                    sayFromPreview("Previewing on " + where + ".");
                }
            } else {
                lastPreviewKey = "";
                sayError(response);
            }
        }, PREVIEW_DELAY_MS);
    }

    async function setPreview(on, options) {
        const silent = options && options.silent;
        els.previewToggle.checked = on;
        if (!(options && options.remember === false)) {
            storageWriteUi({ preview: on });
        }
        window.clearTimeout(previewTimer);
        lastPreviewKey = "";
        if (on) {
            previewArmed = true;
            // Turning previewing on is a request to see what happens next, so a
            // finished result makes way for it. An offer still on the line stays.
            if (!silent && statusState.actions.length === 0) {
                say("");
            }
            update();
            return;
        }
        queue.drop("preview");
        previewDrawn = false;
        previewQuiet = false;
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
        /*
         * Generating replaces the preview on the host, so no preview may be in
         * flight while it runs. The toggle itself stays on: the user asked for a
         * live preview, and previewing resumes from the generated grid below.
         */
        const previewing = els.previewToggle.checked;
        window.clearTimeout(previewTimer);
        queue.drop("preview");
        previewDrawn = false;
        lastPreviewKey = "";
        const construct = panelMode === "construct";
        const response = await queue.enqueue("generate", construct ? { settings, kind: "construction" } : { settings, target, mode });
        if (response.superseded) {
            return;
        }
        if (response.ok && previewing) {
            previewQuiet = true;
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
        // Clearing means "take the grids off": a live preview would put one
        // straight back, so previewing stops here and the message says so.
        const previewing = els.previewToggle.checked;
        if (previewing) {
            setPreview(false, { silent: true, remember: false });
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
        const previewNote = previewing ? " Preview is off; turn it back on to keep previewing." : "";
        if (construct) {
            say((data.removed
                ? "Cleared construction lines from " + data.status.artboard.name + "."
                : "No construction lines to clear on " + data.status.artboard.name + ".") + previewNote, data.removed ? "ok" : undefined);
            update();
            return;
        }
        const where = target.mode === "active" ? data.status.artboard.name
            : target.mode === "selection" ? plural(data.targetArtboards, "selected object", "selected objects")
                : areaWords(data.targetArtboards);
        let message = data.removed
            ? "Cleared " + plural(data.removed, "grid", "grids") + " from " + where + "."
            : "No GuideComposer grids to clear on " + where + ".";
        if (data.rescued) {
            message += " Kept " + plural(data.rescued, "item", "items") + " you had added to a grid; " +
                (data.rescued === 1 ? "it is" : "they are") + " now directly on the layer.";
        }
        say(message + previewNote, data.removed ? "ok" : undefined);
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

    /*
     * Grids carry the settings that drew them, so a document opened later (or by
     * someone else) can hand its grid back to the panel.
     */
    async function loadDocumentGrid() {
        const response = await queue.enqueue("documentGrid");
        if (response.superseded) {
            return;
        }
        if (!response.ok) {
            sayError(response);
            return;
        }
        if (!response.data.found) {
            say("No GuideComposer grid on this " + nouns().one + " to read settings from.");
            return;
        }
        applySettings(settingsFromStored(response.data.settings), "Loaded the settings that drew this grid.");
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

    // Import is the one place the panel reads a file someone else wrote: bound
    // what it will take on, so a huge or generated file can't hang the panel.
    const MAX_IMPORT_BYTES = 512 * 1024;

    function presetFileText() {
        return JSON.stringify({
            format: PRESET_FILE_FORMAT,
            version: PRESET_FILE_VERSION,
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
            // The dialog hands back exactly what was typed, so a name without an
            // extension would be saved as a file Import can't offer to open.
            const target = /\.json$/i.test(choice.data) ? choice.data : choice.data + ".json";
            const written = cepFs.writeFile(target, text);
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
        if (typeof text !== "string" || text.length > MAX_IMPORT_BYTES) {
            say("That presets file is too large to import (the limit is " + Math.round(MAX_IMPORT_BYTES / 1024) + " KB).", "error");
            return;
        }
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
        // A file version this panel doesn't know may mean the settings are
        // written differently; importing it anyway would make silent nonsense.
        if (data.version !== PRESET_FILE_VERSION) {
            say("This presets file is version " + JSON.stringify(data.version) + "; GuideComposer " + PANEL_VERSION +
                " reads version " + PRESET_FILE_VERSION + " files. Update GuideComposer, or export the presets again from the panel that wrote them.", "error");
            return;
        }
        const presets = loadPresets();
        const names = new Set(presets.map((p) => p.name));
        const offered = data.presets.length;
        let added = 0;
        data.presets.slice(0, MAX_IMPORT_PRESETS).forEach((entry) => {
            if (!entry || typeof entry.name !== "string" || !entry.name.trim() || !entry.settings || typeof entry.settings !== "object") {
                return;
            }
            let name = entry.name.trim().slice(0, 40);
            for (let n = 2; names.has(name); n++) {
                name = entry.name.trim().slice(0, 34) + " (" + n + ")";
            }
            names.add(name);
            presets.push({ name, settings: settingsFromStored(entry.settings), savedAt: new Date().toISOString() });
            added++;
        });
        presets.sort((a, b) => a.name.localeCompare(b.name));
        if (!writePresets(presets, "the imported presets")) {
            renderPresets("");
            return;
        }
        renderPresets("");
        const skipped = offered > MAX_IMPORT_PRESETS ? " The file held " + offered + "; only the first " + MAX_IMPORT_PRESETS + " were imported." : "";
        say(added ? "Imported " + plural(added, "preset", "presets") + "." + skipped : "The file had no presets to import.", added ? "ok" : undefined);
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
        if (!writePresets(presets, "the preset")) {
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
        // New settings redraw the preview; that routine confirmation must not
        // replace what the panel just told the user it did.
        previewQuiet = true;
    }

    function applyPreset(value) {
        const name = value.slice(5);
        const preset = loadPresets().find((p) => p.name === name);
        if (!preset) {
            updateButtons();
            return;
        }
        applySettings(settingsFromStored(preset.settings), "Loaded preset \u201c" + name + "\u201d.");
    }

    /*
     * Settings as they arrive from storage or a preset file. Defaults are in
     * points, so an object that names a unit without carrying every length (an
     * old preset, a hand-written file) would otherwise read a 36 pt default
     * margin as 36 in and open the panel with Generate disabled. Convert the
     * lengths the object doesn't set, the way settingsInUnits does for layouts.
     */
    function settingsFromStored(raw) {
        const clean = cleanSettings(raw);
        const units = clean.units;
        if (!raw || typeof raw !== "object" || units === "pt" || core.UNITS.indexOf(units) === -1) {
            return clean;
        }
        const defaults = core.defaults();
        LENGTH_FIELDS.forEach((name) => {
            if (!Object.prototype.hasOwnProperty.call(raw, name)) {
                clean[name] = Number(formatNumber(core.fromPoints(defaults[name], units)));
            }
        });
        return clean;
    }

    /*
     * The current settings with every length expressed in another unit. A layout
     * that brings its own units must not reinterpret the lengths it leaves alone
     * (24 pt spacing must not become 24 in).
     */
    function settingsInUnits(units) {
        const settings = cleanSettings(readSettings());
        if (!units || units === currentUnits || core.UNITS.indexOf(units) === -1) {
            return settings;
        }
        LENGTH_FIELDS.forEach((name) => {
            const exact = exactValue(name, currentUnits);
            const value = exact !== null ? exact : core.parseNumber(settings[name]);
            if (Number.isFinite(value)) {
                settings[name] = Number(formatNumber(core.fromPoints(core.toPoints(value, currentUnits), units)));
            }
        });
        settings.units = units;
        return settings;
    }

    // Layouts change layout fields only, sized for the active artboard; appearance stays.
    function applyLayout(id) {
        const layout = layouts.find(id);
        if (!layout) {
            return;
        }
        const resolved = layouts.resolveLayout(layout, currentRect(), currentUnits);
        const note = layout.relative ? "Margins are sized for this " + currentAreaLabel() + "." : layouts.describeArtboard(layout);
        applySettings(Object.assign(settingsInUnits(resolved.units), resolved), "Applied \u201c" + layout.name + "\u201d." + (note ? " " + note : ""));
        /*
         * Picking a layout should show it, not describe it. If previewing was
         * off, it goes on here, so the artboard answers the question the tile
         * asked. Nothing is committed until Generate.
         */
        previewArmed = true;
        if (hostStatus.hasDocument && !els.previewToggle.checked) {
            // Silent: the message about the layout that was just applied stands.
            setPreview(true, { silent: true });
        }
        // Actions are added to the message, never rebuilt from the status line:
        // reading it back would swallow the previous button's label.
        if (panelMode === "layouts") {
            statusState.tone = "ok";
            addStatusAction({ label: "Edit settings", run: () => setMode("grid") });
        }
        // Offer to resize when a layout made for a size lands on a different artboard.
        const a = layout.artboard;
        if (a && hostStatus.hasDocument && els.targetMode.value !== "selection") {
            const rect = currentRect();
            const wanted = { width: core.toPoints(a.width, a.units), height: core.toPoints(a.height, a.units) };
            const differs = Math.abs(rect[2] - rect[0] - wanted.width) > 1 || Math.abs(rect[1] - rect[3] - wanted.height) > 1;
            if (differs) {
                addStatusAction({
                    label: "Resize " + nouns().one + " to " + a.width + " \u00d7 " + a.height + " " + a.units,
                    run: () => resizeTo(a.width, a.height, a.units, layout.name)
                });
            }
        }
        library.selected = id;
        els.libraryGrid.querySelectorAll(".tile").forEach((tile) => {
            tile.setAttribute("aria-pressed", String(tile.dataset.layout === id));
        });
        storageWriteUi({ lastLayout: id });
    }

    // ----------------------------------------------------------------- library

    const library = {
        open: false,
        category: "",
        selected: "",
        renderedFor: "",
        observer: null
    };

    /*
     * One menu instead of a dozen chips. The wording is what a designer would
     * say out loud, and the library's own category names sit inside the groups,
     * so nobody has to know what "Asymmetric" means to find a layout.
     */
    const LIBRARY_GROUPS = [
        { group: "", items: [
            { value: "Suggested", label: "Made for this page" },
            { value: "All", label: "All layouts" }
        ] },
        { group: "Simple grids", items: [
            { value: "Columns", label: "Columns" },
            { value: "Modular", label: "Rows and columns" },
            { value: "Baseline", label: "Baselines for text" },
            { value: "Asymmetric", label: "Uneven columns" }
        ] },
        { group: "Made for a page size", items: [
            { value: "Print", label: "Print sizes" },
            { value: "Screen", label: "Screens and web" },
            { value: "Social", label: "Social posts" }
        ] },
        { group: "Classic systems", items: [
            { value: "Systems", label: "Grid systems" },
            { value: "Composition", label: "Composition guides" }
        ] },
        { group: "Patterns", items: [
            { value: "Patterns", label: "Dots, hexagons, isometric" }
        ] }
    ];

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
        const values = [];
        els.libraryFilter.textContent = "";
        LIBRARY_GROUPS.forEach((section) => {
            // "Made for this page" only appears when there is something to show.
            const items = section.items.filter((item) => item.value !== "Suggested" || suggestions.length);
            if (!items.length) {
                return;
            }
            const parent = section.group ? document.createElement("optgroup") : els.libraryFilter;
            if (section.group) {
                parent.label = section.group;
            }
            items.forEach((item) => {
                const option = document.createElement("option");
                option.value = item.value;
                option.textContent = item.label + " (" + countFor(item.value, suggestions) + ")";
                parent.appendChild(option);
                values.push(item.value);
            });
            if (section.group) {
                els.libraryFilter.appendChild(parent);
            }
        });
        if (values.indexOf(library.category) === -1) {
            library.category = suggestions.length ? "Suggested" : "All";
        }
        els.libraryFilter.value = library.category;
    }

    function countFor(value, suggestions) {
        if (value === "Suggested") {
            return suggestions.length;
        }
        if (value === "All") {
            return layouts.LAYOUTS.length;
        }
        return layouts.LAYOUTS.filter((l) => l.category === value).length;
    }

    /*
     * What a tile says under its name. The name already carries the detail
     * ("Dot grid, 5 mm"), so the line below it answers the only question left:
     * will this fit the page I am working on?
     */
    function describeTile(layout) {
        if (!layout.artboard) {
            return layouts.describeShort(layout);
        }
        const wanted = { width: core.toPoints(layout.artboard.width, layout.artboard.units), height: core.toPoints(layout.artboard.height, layout.artboard.units) };
        const rect = currentRect();
        const fits = Math.abs(rect[2] - rect[0] - wanted.width) <= 1 && Math.abs(rect[1] - rect[3] - wanted.height) <= 1;
        if (fits) {
            return "Fits this " + nouns().one;
        }
        return "Made for " + layout.artboard.width + " \u00d7 " + layout.artboard.height + " " + layout.artboard.units;
    }

    function paintTile(tile) {
        const layout = layouts.find(tile.dataset.layout);
        const svg = tile.querySelector("svg");
        const fixedSize = layout.artboard;
        const rect = fixedSize
            ? [0, core.toPoints(fixedSize.height, fixedSize.units), core.toPoints(fixedSize.width, fixedSize.units), 0]
            : currentRect();
        const resolved = layouts.resolveLayout(layout, rect, currentUnits);
        const settings = Object.assign(settingsInUnits(resolved.units), resolved);
        /*
         * A tile is an icon of the layout, not a rehearsal of your appearance
         * settings: drawn as boxes or guides it would show faint fills or
         * nothing at all, which is how a gallery of 128 layouts ends up looking
         * empty. Every tile is drawn as lines.
         */
        settings.output = "lines";
        settings.lineStyle = "solid";
        settings.shadeGutters = false;
        let result = core.buildGrid(rect, settings);
        let drawnOn = rect;
        if (!result.ok) {
            /*
             * The layout cannot fit this page, but a blank tile says nothing
             * about what it is. Draw it on the page it was made for (or a
             * default page) so it can still be recognised; the line underneath
             * says it will not fit here.
             */
            const natural = fixedSize
                ? rect
                : [0, core.toPoints(11, "in"), core.toPoints(8.5, "in"), 0];
            const naturalSettings = Object.assign(settingsInUnits(resolved.units), layouts.resolveLayout(layout, natural, currentUnits));
            const fallback = core.buildGrid(natural, naturalSettings);
            if (fallback.ok) {
                result = fallback;
                drawnOn = natural;
            }
        }
        paintGrid(svg, result, drawnOn, { thumb: true, icon: true });
        tile.classList.toggle("tile--unfit", drawnOn !== rect || !result.ok);
        // Repainting happens in place, so the meta line goes back to the
        // layout's own description when the artboard changes to one that fits.
        tile.querySelector(".tile__meta").textContent = drawnOn === rect && result.ok
            ? describeTile(layout)
            : "Doesn't fit this " + nouns().one;
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
        } else if (!hostStatus.hasDocument) {
            els.libraryHint.textContent = "Open a document to see each layout on your own page.";
        } else if (library.category === "Suggested") {
            els.libraryHint.textContent = "Layouts made for a page shaped like yours. Pick one to see it on the " + nouns().one + ".";
        } else {
            els.libraryHint.textContent = "Pick one to see it on the " + nouns().one + ", then Generate to keep it.";
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
            meta.textContent = describeTile(layout);
            // The gallery is one tab stop (see setRovingTile): arrow keys move
            // between tiles, so Tab doesn't have to walk through 128 of them.
            tile.tabIndex = -1;
            tile.append(art, name, meta);
            item.appendChild(tile);
            fragment.appendChild(item);
        });
        els.libraryGrid.appendChild(fragment);
        els.libraryGrid.scrollTop = 0;
        // The tab stop starts on the applied layout, if it is in this list.
        const tiles = Array.from(els.libraryGrid.querySelectorAll(".tile"));
        setRovingTile(tiles.find((tile) => tile.dataset.layout === library.selected) || tiles[0], false);
        els.libraryGrid.querySelectorAll(".tile").forEach((tile) => {
            if (library.observer) {
                library.observer.observe(tile);
            } else {
                paintTile(tile);
            }
        });
    }

    /*
     * The gallery holds 128 tiles. As plain buttons they are 128 tab stops
     * between the search box and the action bar, so the grid keeps a single
     * tab stop (the tile last used) and arrow keys move within it.
     */
    function setRovingTile(tile, focus) {
        if (!tile) {
            return;
        }
        els.libraryGrid.querySelectorAll(".tile").forEach((other) => {
            other.tabIndex = other === tile ? 0 : -1;
        });
        if (focus) {
            tile.focus();
        }
    }

    // Tiles per row, measured from the laid-out grid rather than assumed.
    function tilesPerRow(tiles) {
        const top = tiles[0].offsetTop;
        let count = 0;
        while (count < tiles.length && tiles[count].offsetTop === top) {
            count++;
        }
        return Math.max(1, count);
    }

    function onLibraryGridKeydown(event) {
        const tile = event.target.closest(".tile");
        const keys = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"];
        if (!tile || keys.indexOf(event.key) === -1) {
            return;
        }
        const tiles = Array.from(els.libraryGrid.querySelectorAll(".tile"));
        const perRow = tilesPerRow(tiles);
        const from = tiles.indexOf(tile);
        const steps = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: perRow, ArrowUp: -perRow };
        const to = event.key === "Home" ? 0
            : event.key === "End" ? tiles.length - 1
            : Math.min(tiles.length - 1, Math.max(0, from + steps[event.key]));
        event.preventDefault();
        setRovingTile(tiles[to], true);
    }

    /*
     * Thumbnails show the active artboard, so they go stale when it changes.
     * Repaint them where they are: rebuilding the grid on every background
     * status poll would throw away the scroll position and the focused tile.
     */
    function refreshLibraryIfStale() {
        const key = JSON.stringify([currentRect(), currentUnits]);
        if (!library.open || library.renderedFor === key) {
            return;
        }
        library.renderedFor = key;
        const wanted = libraryList().map((l) => l.id).join("|");
        const tiles = Array.from(els.libraryGrid.querySelectorAll(".tile"));
        // Suggestions are chosen by artboard shape, so that list can really change.
        if (wanted !== tiles.map((t) => t.dataset.layout).join("|")) {
            renderLibraryChips();
            renderLibraryGrid();
            return;
        }
        tiles.forEach(paintTile);
    }

    function deletePreset() {
        const value = els.presetSelect.value;
        if (value.indexOf("user:") !== 0) {
            return;
        }
        const name = value.slice(5);
        const before = loadPresets();
        const deleted = before.find((p) => p.name === name);
        if (!writePresets(before.filter((p) => p.name !== name), "the preset list")) {
            return;
        }
        renderPresets("");
        // Deleting is one click and can't be taken back: offer it back for a moment.
        offerUndo("Deleted preset “" + name + "”.", undefined, () => {
            const presets = loadPresets().filter((p) => p.name !== name).concat(deleted ? [deleted] : []);
            presets.sort((a, b) => a.name.localeCompare(b.name));
            if (writePresets(presets, "the preset list")) {
                renderPresets("user:" + name);
                say("Restored preset “" + name + "”.");
            }
        });
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
        storageWriteUi({ marginsLinked: linked });
    }

    function onControlInput(event) {
        const target = event.target;
        if (!target || !target.name || target.form !== els.form) {
            return;
        }
        previewArmed = true;
        /*
         * Changing a setting makes the last result stale: "Cleared 2 grids" is
         * no longer what the panel is doing. The line is cleared so previewing
         * can say what is happening now. Messages still offering an action are
         * left alone, because the offer is still good.
         */
        if (statusState.message && statusState.actions.length === 0 && !statusIsValidation) {
            say("");
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
    /*
     * Clicking or tabbing into a small numeric field selects what is in it, so
     * typing replaces the number rather than adding digits to it. This is what
     * Illustrator's own panels do, and it is the difference between "I can't
     * edit this" and "I typed 8".
     */
    function selectOnFocus(event) {
        const input = event.target;
        if (!input || input.form !== els.form) {
            return;
        }
        if (input.type !== "number" && input.type !== "text") {
            return;
        }
        // Long text fields (column widths, preset names) keep the caret where
        // the user put it.
        if (input.name === "columnRatios" || input.name === "rowRatios") {
            return;
        }
        window.setTimeout(() => {
            try {
                input.select();
            } catch (e) {
                // Some input types refuse selection; nothing is lost.
            }
        }, 0);
    }

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
            let steppedByPointer = false;
            /*
             * The host takes the first click when the panel is not focused, and
             * a swallowed pointerdown would mean a button that does nothing.
             * The click that follows steps instead, and a click that follows a
             * pointer press this button already handled is ignored.
             */
            button.addEventListener("click", () => {
                if (steppedByPointer) {
                    steppedByPointer = false;
                    return;
                }
                stepField(button.dataset.field, Number(button.dataset.step), 1);
            });
            button.addEventListener("pointerdown", (event) => {
                if (event.button !== 0) {
                    return;
                }
                event.preventDefault();
                steppedByPointer = true;
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

    // ------------------------------------------------------------ diagnostics

    /*
     * The only support channel a customer has. Everything here answers a
     * question we would otherwise have to ask: which build, which app, which
     * platform, what was on screen, and what went wrong last.
     */
    function diagnosticsText() {
        const app = (bridge.app && bridge.app()) || {};
        const s = cleanSettings(readSettings());
        const lengths = ["columnGutter", "rowGutter", "marginTop", "marginRight", "marginBottom", "marginLeft"]
            .map((name) => name + " " + formatNumber(s[name])).join(", ");
        return [
            "GuideComposer panel " + PANEL_VERSION + (hostVersion && hostVersion !== PANEL_VERSION ? " (installed files: " + hostVersion + ")" : ""),
            "Host: " + (app.name || "unknown") + " " + (app.version || "") + " (" + (hostStatus.host || "illustrator") + "), bridge " + bridge.kind,
            "OS: " + (navigator.platform || "unknown") + " — " + navigator.userAgent,
            "Document: " + (hostStatus.hasDocument
                ? (hostStatus.documentName || "untitled") + ", " + plural(hostStatus.artboardCount || 0, "artboard", "artboards") +
                    ", active " + hostStatus.artboard.name + " " + formatNumber(hostStatus.artboard.width) + " × " + formatNumber(hostStatus.artboard.height) + " pt"
                : "none open"),
            "Mode: " + panelMode + ", target " + JSON.stringify(readTarget()) + ", " + readMode(),
            "Grid: " + s.type + (s.type === "pattern" ? "/" + s.pattern : "") + ", output " + s.output + ", " + s.columns + " × " + s.rows +
                ", units " + s.units + ", " + lengths,
            "Drawing: " + els.metrics.textContent + (els.count.textContent ? ", " + els.count.textContent : ""),
            "Last error: " + (lastErrorMessage || "none")
        ].join("\n");
    }

    async function copyDiagnostics() {
        const text = diagnosticsText();
        let copied = false;
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                copied = true;
            }
        } catch (e) {
            copied = false;
        }
        if (!copied) {
            // CEP's Chromium can refuse the async clipboard; the old path still works.
            const area = document.createElement("textarea");
            area.value = text;
            area.setAttribute("aria-hidden", "true");
            area.style.position = "fixed";
            area.style.opacity = "0";
            document.body.appendChild(area);
            area.select();
            try {
                copied = document.execCommand("copy");
            } catch (e) {
                copied = false;
            }
            document.body.removeChild(area);
        }
        if (copied) {
            say("Copied diagnostics to the clipboard. Paste them into your support message.", "ok");
        } else {
            say("Couldn't reach the clipboard. The diagnostics are in the panel's console (Help > Debug).", "error");
            if (window.console) {
                console.log("[GuideComposer] diagnostics\n" + text);
            }
        }
    }

    /*
     * The drawing is the first thing to go when the panel is short: at the
     * manifest's smallest size (240 × 320) it would leave no room for the
     * settings, and the action bar would be pushed out of sight.
     * stageCollapsed is what the user chose; stageTooShort is forced by height.
     */
    let stageCollapsed = false;
    let stageTooShort = false;

    function syncStage() {
        const collapsed = stageCollapsed || stageTooShort;
        els.stage.classList.toggle("stage--collapsed", collapsed);
        els.stageToggle.setAttribute("aria-expanded", String(!collapsed));
        els.stageToggle.disabled = stageTooShort;
        els.stageToggle.title = stageTooShort ? "The panel is too short to show the drawing"
            : collapsed ? "Show the drawing" : "Hide the drawing";
        // A drawing painted while collapsed measured 0 × 0 and fell back to a
        // 5 pt dot radius, so it is painted again as soon as it has a size.
        if (!collapsed) {
            repaintDrawing();
        }
    }

    function setStageCollapsed(collapsed) {
        stageCollapsed = collapsed;
        syncStage();
    }

    // Collapses the drawing when the panel is too short to show it, and gives
    // it back when there is room again.
    function fitStageToHeight() {
        const short = window.innerHeight < SHORT_PANEL_PX;
        if (short === stageTooShort) {
            return;
        }
        stageTooShort = short;
        syncStage();
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
        els.form.addEventListener("focusin", selectOnFocus);
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
            storageWriteUi({ addMode: els.addMode.checked });
            update();
        });
        els.toggleVisible.addEventListener("click", toggleVisible);
        els.toggleLock.addEventListener("click", toggleLock);
        els.refresh.addEventListener("click", () => {
            refreshStatus(true).then(() => {
            refreshGeometry(true);
            say("Read the document again.");
        });
        });

        els.stageToggle.addEventListener("click", () => {
            const collapsed = !els.stage.classList.contains("stage--collapsed");
            setStageCollapsed(collapsed);
            storageWriteUi({ stageCollapsed: collapsed });
        });
        els.appearance.addEventListener("toggle", () => storageWriteUi({ appearanceOpen: els.appearance.open }));

        // The drawing's dot sizes come from its measured size, and how much room
        // the panel has for it changes with every drag of the panel's edge.
        let resizeTimer = 0;
        window.addEventListener("resize", () => {
            window.clearTimeout(resizeTimer);
            resizeTimer = window.setTimeout(() => {
                fitStageToHeight();
                repaintDrawing();
            }, 120);
        });

        els.previewToggle.addEventListener("change", () => setPreview(els.previewToggle.checked));
        els.generate.addEventListener("click", generate);
        els.clear.addEventListener("click", clear);
        els.testLine.addEventListener("click", drawTestLine);
        els.loadDocumentGrid.addEventListener("click", loadDocumentGrid);

        // Arrow keys move between the mode tabs, which changes the mode as they
        // go: a mode entered that way keeps focus on the tabs.
        let modeChangedByKey = false;
        els.panel.querySelectorAll('input[name="panel-mode"]').forEach((input) => {
            input.addEventListener("keydown", () => {
                modeChangedByKey = true;
            });
            input.addEventListener("change", () => {
                setMode(input.value, { keepFocus: modeChangedByKey });
                modeChangedByKey = false;
            });
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
        els.libraryFilter.addEventListener("change", () => {
            library.category = els.libraryFilter.value;
            els.librarySearch.value = "";
            renderLibraryGrid();
        });
        els.libraryGrid.addEventListener("click", (event) => {
            const tile = event.target.closest(".tile");
            if (tile) {
                setRovingTile(tile, false);
                applyLayout(tile.dataset.layout);
            }
        });
        els.libraryGrid.addEventListener("keydown", onLibraryGridKeydown);
        els.libraryGrid.addEventListener("focusin", (event) => {
            const tile = event.target.closest(".tile");
            if (tile) {
                setRovingTile(tile, false);
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
            // Resetting throws away everything in the form, so keep a copy and
            // offer it back for a few seconds.
            const before = cleanSettings(readSettings());
            const linked = marginsLinked;
            writeSettings(core.defaults());
            field("lockLayer").checked = locked;
            syncLockButton();
            setMarginsLinked(true);
            update();
            offerUndo("Settings reset to defaults.", undefined, () => {
                writeSettings(before);
                field("lockLayer").checked = locked;
                syncLockButton();
                setMarginsLinked(linked);
                update();
                say("Put your settings back.");
            });
        });
        els.copyDiagnostics.addEventListener("click", copyDiagnostics);

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
        // modules/storage.js needs these two from the controller; see its header.
        configureStorage({ say, plural, settingsFromStored });
        configureFields({ field, rescueFocus, say, els, panelMode: () => panelMode });
        if (!core) {
            say("GuideComposer is missing its grid engine. Reinstall the extension.", "error");
            return;
        }
        applyTheme(bridge.skin());
        writeSettings(settingsFromStored(storage.get(STORAGE_SETTINGS) || core.defaults()));

        const ui = storage.get(STORAGE_UI) || {};
        const margins = MARGIN_FIELDS.map((name) => field(name).value);
        const marginsMatch = margins.every((value) => value === margins[0]);
        setMarginsLinked(typeof ui.marginsLinked === "boolean" ? ui.marginsLinked && marginsMatch : marginsMatch);
        stageCollapsed = ui.stageCollapsed === true;
        fitStageToHeight();
        syncStage();
        els.appearance.open = ui.appearanceOpen !== false;
        els.addMode.checked = ui.addMode === true;
        // Preview is on to begin with: the panel should show what it does
        // before anyone has to know what Generate means. The choice sticks.
        els.previewToggle.checked = ui.preview !== false;
        library.category = typeof ui.libraryCategory === "string" ? ui.libraryCategory : "";
        library.selected = typeof ui.lastLayout === "string" ? ui.lastLayout : "";
        if (ui.target && typeof ui.target.mode === "string") {
            setSelectValue(els.targetMode, ui.target.mode, "active");
            els.targetRange.value = typeof ui.target.range === "string" ? ui.target.range : "";
        }

        const restoredPresets = restorePresetsIfOrphaned();
        renderPresets("");
        renderFormats();
        applyNouns();
        syncLayerButtons();
        showVersion();
        bindEvents();
        setMode(PANEL_MODES.indexOf(ui.panelMode) !== -1 ? ui.panelMode : "grid", { silent: true });
        // The first status refresh overwrites whatever the status line holds, so
        // a restore announced before it would never be seen. Say it afterwards.
        refreshStatus(true).then(() => { // Reads the document, and looks for a newer installed version.
            if (restoredPresets) {
                say("Restored " + plural(restoredPresets, "preset", "presets") +
                    " from a backup. Panel storage was empty, which usually means Illustrator was updated.", "ok");
            }
        });
        if (bridge.kind === "mock") {
            document.documentElement.dataset.host = "mock";
            // Browser-only hooks for the smoke test; never present inside Illustrator.
            window.__mullionTest = {
                importPresetText,
                presetFileText,
                diagnosticsText,
                groupCount: () => bridge.groupCount(),
                stall: (ms) => bridge.stall(ms),
                setHostTimeout: (ms) => queue.setTimeout(ms)
            };
        }
    }

    init();
}());
