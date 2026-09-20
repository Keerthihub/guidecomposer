/*
 * Shared configuration for the GuideComposer panel.
 *
 * Every tunable number, field list and vocabulary table the panel uses lives
 * here, so changing "how long before we show a spinner" or "which fields are
 * numbers" is one edit in one obvious place rather than a search through the
 * controller.
 *
 * Nothing here has behaviour. If you find yourself wanting to add a function,
 * it belongs in one of the other modules.
 *
 * Loaded by index.html before every other panel script. Everything is handed
 * to the rest of the panel through the shared `MullionUI` namespace — the name
 * is historical and internal only; users never see it.
 */
(function (root) {
    "use strict";

    const core = window.MullionCore;
    const layouts = window.MullionLayouts || {
        CATEGORIES: [], LAYOUTS: [], find: () => null, resolveLayout: () => ({}),
        suggestLayouts: () => [], describeArtboard: () => "", describeShort: () => ""
    };

    const STORAGE_SETTINGS = "mullion.settings.v1";
    const STORAGE_PRESETS = "mullion.presets.v1";
    const STORAGE_UI = "mullion.ui.v1";

    // This panel's own version. The host reports the version of the files on
    // disk, so the two differing means the extension was updated underneath us.
    const PANEL_VERSION = "0.1.1";

    const PREVIEW_DELAY_MS = 200;
    // Redrawing thousands of shapes on every edit stalls Illustrator and fills its
    // undo history, so live preview pauses above this many shapes (Generate still works).
    const PREVIEW_MAX_SHAPES = 1500;
    // A host call that hasn't answered by now is abandoned so the panel stays usable.
    const HOST_TIMEOUT_MS = 90000;
    // The host keeps running an abandoned call, so anything that would change the
    // document waits until it answers rather than doing the work twice.
    const MUTATING_METHODS = { preview: true, generate: true, clear: true, clearPreview: true, setGridLayer: true, resizeArtboards: true, alignSelection: true, applyPageMargins: true, drawTestLine: true };
    // Show a working state only once a call is slow enough to notice.
    const WORKING_DELAY_MS = 400;
    const STATUS_THROTTLE_MS = 600;
    // How long an Undo stays on offer after a destructive change.
    const UNDO_MS = 8000;
    // Rebooting the host re-reads its files, so look for a new version sparingly.
    const UPDATE_CHECK_MS = 300000;
    const STEP_REPEAT_DELAY_MS = 400;
    const STEP_REPEAT_MS = 70;
    // Below this the drawing cannot share the panel with the controls, so it collapses.
    const SHORT_PANEL_PX = 470;
    const FALLBACK_RECT = [0, 792, 612, 0]; // US Letter, shown when no document is open
    const MAX_SCHEMATIC_CELLS = 2500;
    const THUMBNAIL_MAX_MARKS = 500; // Dots and hexagons beyond this are thinned in tile thumbnails.
    // Marks across a tile before it stops reading as a grid and starts reading
    // as a solid block.
    const TILE_LEGIBLE_MARKS = 14;

    const formats = window.MullionFormats || { GROUPS: [], FORMATS: [], find: () => null, toPoints: () => ({}), label: () => "" };

    const HOST_METHODS = ["status", "preview", "clearPreview", "generate", "clear", "setGridLayer", "resizeArtboards", "alignSelection", "textMetrics", "applyPageMargins", "selectionGeometry", "documentGrid", "drawTestLine"];
    const LENGTH_FIELDS = ["columnGutter", "rowGutter", "marginTop", "marginRight", "marginBottom", "marginLeft", "baselineSpacing", "baselineOffset", "patternSize", "conPadding"];
    const MARGIN_FIELDS = ["marginTop", "marginRight", "marginBottom", "marginLeft"];
    const NUMBER_FIELDS = LENGTH_FIELDS.concat(["columns", "rows", "strokeWidth", "opacity", "dotSize", "rings", "spokes", "gutterOpacity", "overlayColumns", "patternAngle"]);
    const BOOLEAN_FIELDS = ["extendToEdges", "lockLayer", "marginColorOn", "shadeGutters", "addBaseline", "squareModules"]
        .concat(core ? core.COMPOSITION_FLAGS : [], core ? core.CONSTRUCTION_FLAGS : []);
    const TEXT_FIELDS = ["columnRatios", "rowRatios"];
    // Fields that are simply off when left blank.
    const OFF_WHEN_EMPTY = { overlayColumns: 0 };
    // Host vocabulary: Illustrator has artboards, InDesign has pages.
    const NOUNS = {
        illustrator: { one: "artboard", many: "artboards", title: "Artboard" },
        indesign: { one: "page", many: "pages", title: "Page" }
    };
    const COLOR_FIELDS = ["strokeColor", "marginColor", "gutterColor", "conBoundsColor", "conKeylineColor", "conCircleColor"];
    const CHOICE_FIELDS = ["type", "output", "lineStyle", "conExtend"];
    const SELECT_FIELDS = { units: "pt", spiralFocus: "bottom-right", pattern: "square" };
    // One arrow-key press should move a length by a useful amount in its own
    // unit: a fixed step of 1 moves a gutter by a whole inch.
    const UNIT_STEPS = { pt: 1, px: 1, mm: 0.5, in: 0.05 };
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

    // The presets file format, shared by Export, Import and the backup.
    const PRESET_FILE_FORMAT = "mullion-presets";
    const PRESET_FILE_VERSION = 1;
    const MAX_IMPORT_PRESETS = 200;

    root.constants = {
        PRESET_FILE_FORMAT,
        PRESET_FILE_VERSION,
        MAX_IMPORT_PRESETS,
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
        SUPERSEDED
    };
}(window.MullionUI = window.MullionUI || {}));
