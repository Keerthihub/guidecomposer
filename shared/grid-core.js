/*
 * Mullion grid core: pure geometry and validation.
 *
 * ES3-compatible so the same file runs in Illustrator's ExtendScript engine,
 * in the CEP panel, and under Node for tests. No DOM, no Illustrator objects,
 * no JSON, no ES5 array helpers.
 *
 * Coordinates follow Illustrator's scripting model: an artboard rectangle is
 * [left, top, right, bottom] in points, and Y grows upward, so top > bottom.
 * Moving down the page means subtracting from Y.
 *
 * A built grid is made of these shape lists:
 *   segments: straight lines    { kind, x1, y1, x2, y2 }
 *   boxes:    rectangles        { kind, left, top, right, bottom }
 *   polygons: closed polygons   { kind, points: [[x, y], ...] }
 *   curves:   Bezier paths      { kind, closed, points: [{ anchor, left, right }] }
 *             where left/right are the incoming/outgoing handles, as [x, y]
 *   dots:     filled circles    { kind, x, y, d }
 *
 * Kinds decide styling: "margin" shapes can take the margin color, "gutter"
 * and "block" boxes are filled, everything else uses the stroke color.
 */
(function (root, factory) {
    var core = factory();
    if (typeof module === "object" && module && module.exports) {
        module.exports = core;
    } else {
        root.MullionCore = core;
    }
}((typeof $ !== "undefined" && $ && $.global) ? $.global : this, function () {
    var EPSILON = 1e-6;
    var PRECISION = 10000; // Output coordinates are rounded to 1/10000 pt.
    var PHI = (1 + Math.sqrt(5)) / 2;
    var KAPPA = 0.5522847498307936; // Bezier handle length for a quarter circle of radius 1.
    var SQRT3 = Math.sqrt(3);

    var POINTS_PER_UNIT = {
        pt: 1,
        px: 1, // Illustrator maps 1 px to 1 pt (72 ppi).
        mm: 72 / 25.4,
        "in": 72
    };

    var UNIT_LABELS = { pt: "pt", px: "px", mm: "mm", "in": "in" };

    var GRID_TYPES = { columns: true, modular: true, baseline: true, composition: true, pattern: true };
    var OUTPUTS = { lines: true, guides: true, boxes: true };
    var SPIRAL_FOCI = { "top-left": true, "top-right": true, "bottom-left": true, "bottom-right": true };
    var PATTERNS = { square: true, dots: true, isometric: true, hexagon: true, radial: true, diagonal: true };
    var LINE_STYLES = { solid: true, dashed: true, dotted: true };
    var COMPOSITION_FLAGS = ["compThirds", "compFifths", "compGolden", "compDiagonals", "compCenter",
        "compArmature", "compDynamic", "compVillard", "compSpiral"];
    var CONSTRUCTION_FLAGS = ["conBounds", "conKeylines", "conCircles", "conCenter", "conDiagonals"];
    // The only panel settings construction lines read besides their own options.
    var CONSTRUCTION_STYLE_KEYS = ["units", "output", "strokeWidth", "opacity", "lineStyle", "lockLayer"];

    // Whole-number fields: [minimum, maximum].
    var COUNT_LIMITS = {
        columns: [1, 100],
        rows: [1, 100],
        rings: [1, 50],
        spokes: [0, 72],
        overlayColumns: [0, 48]
    };

    var LIMITS = {
        maxColumns: 100,
        maxRows: 100,
        maxBaselines: 1000,
        maxShapes: 5000,       // per artboard
        maxTotalShapes: 10000, // per request, across artboards (enforced by the host)
        maxStrokeWidth: 100,
        maxDotSize: 50,
        maxBlocks: 200,
        spiralSquares: 10
    };

    var DEFAULTS = {
        type: "columns",
        units: "pt",
        columns: 12,
        rows: 8,
        columnGutter: 12,
        rowGutter: 12,
        columnRatios: "",
        rowRatios: "",
        addBaseline: false,
        blocks: [],
        marginTop: 36,
        marginRight: 36,
        marginBottom: 36,
        marginLeft: 36,
        baselineSpacing: 12,
        baselineOffset: 0,
        compThirds: true,
        compGolden: false,
        compDiagonals: false,
        compCenter: false,
        compSpiral: false,
        compFifths: false,
        compArmature: false,
        compDynamic: false,
        compVillard: false,
        overlayColumns: 0,
        squareModules: false,
        patternAngle: 45,
        conBounds: true,
        conKeylines: true,
        conCircles: true,
        conCenter: false,
        conDiagonals: false,
        conExtend: "artboard",
        conPadding: 24,
        conBoundsColor: "#8C93A1",
        conKeylineColor: "#2F7CF6",
        conCircleColor: "#E0457B",
        spiralFocus: "bottom-right",
        pattern: "square",
        patternSize: 24,
        dotSize: 2,
        rings: 6,
        spokes: 12,
        extendToEdges: false,
        output: "lines",
        strokeColor: "#E0457B",
        strokeWidth: 0.5,
        opacity: 100,
        lineStyle: "solid",
        marginColorOn: false,
        marginColor: "#1C9B8E",
        shadeGutters: false,
        gutterColor: "#E0457B",
        gutterOpacity: 15,
        lockLayer: true
    };

    var FIELD_NAMES = {
        columns: "Columns",
        rows: "Rows",
        columnGutter: "Column gutter",
        rowGutter: "Row gutter",
        columnRatios: "Column widths",
        rowRatios: "Row heights",
        blocks: "Blocks",
        marginTop: "Top margin",
        marginRight: "Right margin",
        marginBottom: "Bottom margin",
        marginLeft: "Left margin",
        baselineSpacing: "Baseline spacing",
        baselineOffset: "Baseline offset",
        composition: "Composition guides",
        spiralFocus: "Spiral focus",
        overlayColumns: "Overlay columns",
        patternAngle: "Angle",
        construction: "Construction lines",
        conPadding: "Extension",
        conBoundsColor: "Bounds color",
        conKeylineColor: "Key line color",
        conCircleColor: "Circle color",
        selection: "Selection",
        pattern: "Pattern",
        patternSize: "Size",
        dotSize: "Dot size",
        rings: "Rings",
        spokes: "Spokes",
        strokeWidth: "Stroke width",
        opacity: "Opacity",
        strokeColor: "Stroke color",
        lineStyle: "Line style",
        marginColor: "Margin color",
        gutterColor: "Gutter color",
        gutterOpacity: "Gutter opacity",
        units: "Units",
        type: "Grid type",
        output: "Output",
        range: "Artboards"
    };

    // ----------------------------------------------------------------- numbers

    function round(value) {
        var r = Math.round(value * PRECISION) / PRECISION;
        return r === 0 ? 0 : r; // Avoid -0 in output.
    }

    function isFiniteNumber(value) {
        return typeof value === "number" && !isNaN(value) && isFinite(value);
    }

    function isArray(value) {
        return Object.prototype.toString.call(value) === "[object Array]";
    }

    // Copies arrays and plain objects all the way down, so callers can edit a
    // copy without reaching back into the original.
    function copyValue(value) {
        var out;
        var i;
        var key;
        if (isArray(value)) {
            out = [];
            for (i = 0; i < value.length; i++) {
                out.push(copyValue(value[i]));
            }
            return out;
        }
        if (value && typeof value === "object") {
            out = {};
            for (key in value) {
                if (hasOwn(value, key)) {
                    out[key] = copyValue(value[key]);
                }
            }
            return out;
        }
        return value;
    }

    function stripSpace(text) {
        return String(text).replace(/^\s+|\s+$/g, "");
    }

    // Accepts numbers and numeric strings. Returns NaN for anything else,
    // including empty strings and trailing garbage such as "12pt".
    function parseNumber(value) {
        if (typeof value === "number") {
            return value;
        }
        if (typeof value !== "string") {
            return NaN;
        }
        var text = stripSpace(value);
        if (!/^[+\-]?(\d+\.?\d*|\.\d+)([eE][+\-]?\d+)?$/.test(text)) {
            return NaN;
        }
        return Number(text);
    }

    function hasOwn(obj, key) {
        return Object.prototype.hasOwnProperty.call(obj, key);
    }

    function plural(count, one, many) {
        return count + " " + (count === 1 ? one : many);
    }

    function isHexColor(value) {
        return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
    }

    // ------------------------------------------------------------------- units

    function isUnit(unit) {
        return typeof unit === "string" && hasOwn(POINTS_PER_UNIT, unit);
    }

    function toPoints(value, unit) {
        if (!isUnit(unit)) {
            throw new Error("Unknown unit: " + unit);
        }
        return value * POINTS_PER_UNIT[unit];
    }

    function fromPoints(points, unit) {
        if (!isUnit(unit)) {
            throw new Error("Unknown unit: " + unit);
        }
        return points / POINTS_PER_UNIT[unit];
    }

    // Formats a point measurement in the user's unit with at most 2 decimals.
    function formatMeasure(points, unit) {
        var value = Math.round(fromPoints(points, unit) * 100) / 100;
        if (value === 0) {
            value = 0;
        }
        return String(value) + " " + UNIT_LABELS[unit];
    }

    // -------------------------------------------------------------- validation

    /*
     * Numeric fields validated for a grid. options: { pattern, addBaseline,
     * columnRatios, rowRatios } where ratios replace the column/row counts.
     */
    function relevantFields(type, options) {
        var o = typeof options === "string" ? { pattern: options } : (options || {});
        var pattern = o.pattern;
        var fields = ["marginTop", "marginRight", "marginBottom", "marginLeft"];
        if (type === "columns" || type === "modular") {
            if (!o.columnRatios) {
                fields.push("columns");
            }
            fields.push("columnGutter", "overlayColumns");
            if (type === "modular") {
                if (!o.rowRatios && !o.squareModules) {
                    fields.push("rows");
                }
                fields.push("rowGutter");
            }
            if (o.addBaseline) {
                fields.push("baselineSpacing", "baselineOffset");
            }
        } else if (type === "baseline") {
            fields.push("baselineSpacing", "baselineOffset");
        } else if (type === "pattern") {
            if (pattern === "radial") {
                fields.push("rings", "spokes");
            } else {
                fields.push("patternSize");
            }
        }
        return fields;
    }

    function isProvided(raw, key) {
        return !!raw && hasOwn(raw, key) && raw[key] !== undefined && raw[key] !== null;
    }

    function pick(raw, key) {
        return isProvided(raw, key) ? raw[key] : DEFAULTS[key];
    }

    /*
     * Parses proportions such as "2 1 1", "2:1:1", or [1, 1, 2, 3, 5].
     * Returns { ok, values } (values is null when empty, meaning equal sizes)
     * or { ok: false, error }.
     */
    function parseRatios(value, label) {
        var parts;
        if (value === undefined || value === null || value === "") {
            return { ok: true, values: null };
        }
        if (typeof value === "string") {
            var text = stripSpace(value);
            if (text === "") {
                return { ok: true, values: null };
            }
            parts = text.split(/[\s,:;]+/);
        } else if (value && typeof value.length === "number") {
            parts = value;
        } else {
            return { ok: false, error: label + " must be numbers separated by spaces, such as 2 1 1." };
        }
        var values = [];
        for (var i = 0; i < parts.length; i++) {
            if (parts[i] === "") {
                continue;
            }
            var n = parseNumber(typeof parts[i] === "number" ? parts[i] : String(parts[i]));
            if (!isFiniteNumber(n) || n <= 0) {
                return { ok: false, error: label + " must be positive numbers separated by spaces, such as 2 1 1." };
            }
            values.push(n);
        }
        if (values.length === 0) {
            return { ok: true, values: null };
        }
        if (values.length > LIMITS.maxColumns) {
            return { ok: false, error: label + " can have at most " + LIMITS.maxColumns + " values." };
        }
        return { ok: true, values: values };
    }

    /*
     * Parses content blocks: [{ column, row, columns, rows }] with 1-based
     * positions and sizes in modules. Returns { ok, blocks } or { ok: false, error }.
     */
    function parseBlocks(value) {
        if (value === undefined || value === null || value === "") {
            return { ok: true, blocks: [] };
        }
        if (typeof value === "string" || typeof value.length !== "number") {
            return { ok: false, error: "Blocks must be a list." };
        }
        if (value.length > LIMITS.maxBlocks) {
            return { ok: false, error: "Use at most " + LIMITS.maxBlocks + " blocks." };
        }
        var blocks = [];
        var keys = ["column", "row", "columns", "rows"];
        for (var i = 0; i < value.length; i++) {
            var b = value[i];
            var clean = {};
            for (var k = 0; k < keys.length; k++) {
                var n = b ? parseNumber(b[keys[k]]) : NaN;
                if (!isFiniteNumber(n) || Math.floor(n) !== n || n < 1 || n > 1000) {
                    return { ok: false, error: "Block " + (i + 1) + " needs whole numbers for its column, row, width, and height." };
                }
                clean[keys[k]] = n;
            }
            blocks.push(clean);
        }
        return { ok: true, blocks: blocks };
    }

    /*
     * Validates raw panel settings and converts every length to points.
     * Only the fields used by the chosen grid type are validated.
     * Returns { ok, errors: [{ field, message }], settings }.
     */
    function normalizeSettings(raw) {
        var errors = [];
        var s = {};
        var i;

        function addError(field, message) {
            errors.push({ field: field, message: message });
        }

        function readColor(key) {
            var color = pick(raw, key);
            if (!isHexColor(color)) {
                addError(key, FIELD_NAMES[key] + " must be a hex color such as #E0457B.");
                return DEFAULTS[key];
            }
            return color.toUpperCase();
        }

        s.type = pick(raw, "type");
        if (typeof s.type !== "string" || !hasOwn(GRID_TYPES, s.type)) {
            addError("type", "Choose a grid type: columns, modular, baseline, composition, or pattern.");
            s.type = DEFAULTS.type;
        }

        s.units = pick(raw, "units");
        if (!isUnit(s.units)) {
            addError("units", "Choose a unit: pt, px, mm, or in.");
            s.units = DEFAULTS.units;
        }

        if (s.type === "pattern") {
            s.pattern = pick(raw, "pattern");
            if (typeof s.pattern !== "string" || !hasOwn(PATTERNS, s.pattern)) {
                addError("pattern", "Choose a pattern: square, dots, isometric, hexagon, radial, or diagonal.");
                s.pattern = DEFAULTS.pattern;
            }
        }

        if (s.type === "columns" || s.type === "modular") {
            s.addBaseline = pick(raw, "addBaseline") === true;
            var columnRatios = parseRatios(pick(raw, "columnRatios"), FIELD_NAMES.columnRatios);
            if (!columnRatios.ok) {
                addError("columnRatios", columnRatios.error);
            } else if (columnRatios.values) {
                s.columnRatios = columnRatios.values;
                s.columns = columnRatios.values.length;
            }
            if (s.type === "modular") {
                var rowRatios = parseRatios(pick(raw, "rowRatios"), FIELD_NAMES.rowRatios);
                if (!rowRatios.ok) {
                    addError("rowRatios", rowRatios.error);
                } else if (rowRatios.values) {
                    s.rowRatios = rowRatios.values;
                    s.rows = rowRatios.values.length;
                }
            }
            var parsedBlocks = parseBlocks(pick(raw, "blocks"));
            if (!parsedBlocks.ok) {
                addError("blocks", parsedBlocks.error);
            } else {
                s.blocks = parsedBlocks.blocks;
            }
        }

        if (s.type === "modular") {
            s.squareModules = pick(raw, "squareModules") === true;
        }

        var fields = relevantFields(s.type, {
            pattern: s.pattern,
            addBaseline: s.addBaseline,
            columnRatios: s.columnRatios,
            rowRatios: s.rowRatios,
            squareModules: s.squareModules
        });
        for (i = 0; i < fields.length; i++) {
            var key = fields[i];
            var label = FIELD_NAMES[key];
            var value = parseNumber(pick(raw, key));
            var isCount = hasOwn(COUNT_LIMITS, key);
            if (!isProvided(raw, key) && !isCount) {
                // Length defaults are stored in points; express them in the chosen unit.
                value = fromPoints(DEFAULTS[key], s.units);
            }

            if (isCount) {
                var min = COUNT_LIMITS[key][0];
                var max = COUNT_LIMITS[key][1];
                if (!isFiniteNumber(value) || Math.floor(value) !== value || value < min || value > max) {
                    addError(key, label + " must be a whole number from " + min + " to " + max + ".");
                    continue;
                }
                s[key] = value;
            } else if (key === "baselineSpacing" || key === "patternSize") {
                if (!isFiniteNumber(value) || value <= 0) {
                    addError(key, label + " must be greater than 0.");
                    continue;
                }
                s[key] = toPoints(value, s.units);
            } else {
                if (!isFiniteNumber(value) || value < 0) {
                    addError(key, label + " must be a number of 0 or more.");
                    continue;
                }
                s[key] = toPoints(value, s.units);
            }
        }

        if (s.type === "composition") {
            var any = false;
            for (i = 0; i < COMPOSITION_FLAGS.length; i++) {
                s[COMPOSITION_FLAGS[i]] = pick(raw, COMPOSITION_FLAGS[i]) === true;
                any = any || s[COMPOSITION_FLAGS[i]];
            }
            if (!any) {
                addError("composition", "Choose at least one composition guide.");
            }
            if (s.compSpiral) {
                s.spiralFocus = pick(raw, "spiralFocus");
                if (typeof s.spiralFocus !== "string" || !hasOwn(SPIRAL_FOCI, s.spiralFocus)) {
                    addError("spiralFocus", "Choose where the spiral should focus: top left, top right, bottom left, or bottom right.");
                    s.spiralFocus = DEFAULTS.spiralFocus;
                }
            }
        }

        s.extendToEdges = pick(raw, "extendToEdges") === true;
        // Composition guides are the content rectangle's own geometry: its
        // corners, its diagonals, its proportions. There is no line to run past
        // the margins, so the panel is told the option does nothing here.
        s.extendToEdgesApplies = s.type !== "composition";
        s.lockLayer = pick(raw, "lockLayer") === true;

        s.output = pick(raw, "output");
        if (typeof s.output !== "string" || !hasOwn(OUTPUTS, s.output)) {
            addError("output", "Choose an output: lines, guides, or boxes.");
            s.output = DEFAULTS.output;
        } else if (s.output === "boxes" && s.type !== "columns" && s.type !== "modular") {
            addError("output", "Boxes work with column and modular grids. Choose lines or guides.");
        } else if (s.output === "guides" && s.type === "pattern" && s.pattern === "dots") {
            addError("output", "Dot grids draw filled dots, which can't be guides. Choose lines.");
        }

        if (s.type === "pattern" && s.pattern === "diagonal") {
            var angle = parseNumber(pick(raw, "patternAngle"));
            if (!isFiniteNumber(angle) || angle < 5 || angle > 85) {
                addError("patternAngle", "Angle must be from 5 to 85 degrees.");
            } else {
                s.patternAngle = angle;
            }
        }

        if (s.type === "pattern" && s.pattern === "dots") {
            var dot = parseNumber(pick(raw, "dotSize"));
            if (!isFiniteNumber(dot) || dot <= 0 || dot > LIMITS.maxDotSize) {
                addError("dotSize", "Dot size must be more than 0 and at most " + LIMITS.maxDotSize + " pt.");
            } else {
                s.dotSize = dot; // Always points, like stroke width.
            }
        }

        if (s.output !== "guides") {
            s.strokeColor = readColor("strokeColor");

            // Stroke width is always in points, whatever the layout unit.
            var width = parseNumber(pick(raw, "strokeWidth"));
            if (!isFiniteNumber(width) || width <= 0 || width > LIMITS.maxStrokeWidth) {
                addError("strokeWidth", "Stroke width must be more than 0 and at most " + LIMITS.maxStrokeWidth + " pt.");
            } else {
                s.strokeWidth = width;
            }

            var opacity = parseNumber(pick(raw, "opacity"));
            if (!isFiniteNumber(opacity) || opacity < 0 || opacity > 100) {
                addError("opacity", "Opacity must be from 0 to 100.");
            } else {
                s.opacity = opacity;
            }

            s.lineStyle = pick(raw, "lineStyle");
            if (typeof s.lineStyle !== "string" || !hasOwn(LINE_STYLES, s.lineStyle)) {
                addError("lineStyle", "Choose a line style: solid, dashed, or dotted.");
                s.lineStyle = DEFAULTS.lineStyle;
            }

            s.marginColorOn = pick(raw, "marginColorOn") === true;
            if (s.marginColorOn) {
                s.marginColor = readColor("marginColor");
            }

            s.shadeGutters = pick(raw, "shadeGutters") === true && (s.type === "columns" || s.type === "modular");
            if (s.shadeGutters) {
                s.gutterColor = readColor("gutterColor");
                var gutterOpacity = parseNumber(pick(raw, "gutterOpacity"));
                if (!isFiniteNumber(gutterOpacity) || gutterOpacity < 0 || gutterOpacity > 100) {
                    addError("gutterOpacity", "Gutter opacity must be from 0 to 100.");
                } else {
                    s.gutterOpacity = gutterOpacity;
                }
            }
        }

        return { ok: errors.length === 0, errors: errors, settings: s };
    }

    /*
     * Parses an artboard list typed by the user, such as "1-3, 5", using
     * 1-based artboard numbers like Illustrator's own dialogs.
     * Returns { ok, indices } with sorted 0-based indices, or { ok: false, error }.
     */
    function parseArtboardRange(text, count) {
        var str = stripSpace(text === undefined || text === null ? "" : text);
        if (str === "") {
            return { ok: false, error: "Enter artboard numbers, such as 1-3, 5." };
        }
        var parts = str.split(",");
        var seen = {};
        var indices = [];
        for (var i = 0; i < parts.length; i++) {
            var part = stripSpace(parts[i]);
            if (part === "") {
                continue;
            }
            var match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
            if (!match) {
                return { ok: false, error: "“" + part + "” isn't an artboard number or range. Use numbers such as 1-3, 5." };
            }
            var first = parseInt(match[1], 10);
            var last = match[2] ? parseInt(match[2], 10) : first;
            if (first > last) {
                var swap = first;
                first = last;
                last = swap;
            }
            if (first < 1) {
                return { ok: false, error: "Artboard numbers start at 1." };
            }
            if (last > count) {
                return { ok: false, error: "Artboard " + last + " doesn't exist. This document has " + plural(count, "artboard", "artboards") + "." };
            }
            for (var n = first; n <= last; n++) {
                if (!hasOwn(seen, String(n))) {
                    seen[String(n)] = true;
                    indices.push(n - 1);
                }
            }
        }
        if (!indices.length) {
            return { ok: false, error: "Enter artboard numbers, such as 1-3, 5." };
        }
        indices.sort(function (a, b) { return a - b; });
        return { ok: true, indices: indices };
    }

    // ---------------------------------------------------------------- geometry

    /*
     * Reads an Illustrator artboard rectangle [left, top, right, bottom].
     * Returns { ok, error, box } where box has left/top/right/bottom/width/height.
     */
    function readRect(rect) {
        if (!rect || typeof rect.length !== "number" || rect.length !== 4) {
            return { ok: false, error: "The artboard rectangle must have four numbers: left, top, right, bottom." };
        }
        for (var i = 0; i < 4; i++) {
            if (!isFiniteNumber(rect[i])) {
                return { ok: false, error: "The artboard rectangle contains a value that is not a number." };
            }
        }
        var box = {
            left: rect[0],
            top: rect[1],
            right: rect[2],
            bottom: rect[3],
            width: rect[2] - rect[0],
            height: rect[1] - rect[3]
        };
        if (box.width <= EPSILON || box.height <= EPSILON) {
            return { ok: false, error: "The artboard has no usable size. Its right edge must be right of its left edge and its top above its bottom." };
        }
        return { ok: true, box: box };
    }

    /*
     * Splits a span into equal tracks separated by gutters.
     * Returns { ok, size, tracks: [{ start, end }] } measured as distances
     * from the start of the span (always increasing). Callers map distances
     * onto X (left to right) or Y (top to bottom).
     * On failure, `index` is the track that leaves no room.
     */
    function divideSpan(length, count, gutter, weights) {
        var available = length - gutter * (count - 1);
        var total = 0;
        var i;
        if (weights) {
            for (i = 0; i < count; i++) {
                total += weights[i];
            }
        }
        var tracks = [];
        var smallest = Infinity;
        var narrowest = 0;
        var start = 0;
        for (i = 0; i < count; i++) {
            var size = weights ? available * weights[i] / total : available / count;
            // Written as a failed comparison rather than Math.min so a NaN size,
            // which weights far apart enough to overflow produce, wins and is
            // reported. The first such track is the one named.
            if (!isNaN(smallest) && !(size >= smallest)) {
                smallest = size;
                narrowest = i;
            }
            tracks.push({ start: start, end: start + size });
            start += size + gutter;
        }
        // Positive test, so NaN fails here instead of passing for want of a comparison.
        if (!(smallest > EPSILON)) {
            return { ok: false, size: smallest, index: narrowest };
        }
        return { ok: true, size: smallest, equal: !weights, tracks: tracks };
    }

    // Collects track edges as sorted distances with coincident edges merged.
    function trackEdges(tracks) {
        var edges = [];
        for (var i = 0; i < tracks.length; i++) {
            pushUnique(edges, tracks[i].start);
            pushUnique(edges, tracks[i].end);
        }
        return edges;
    }

    function pushUnique(list, value) {
        for (var i = 0; i < list.length; i++) {
            if (Math.abs(list[i] - value) <= EPSILON) {
                return;
            }
        }
        list.push(value);
    }

    function segment(kind, x1, y1, x2, y2) {
        return { kind: kind, x1: round(x1), y1: round(y1), x2: round(x2), y2: round(y2) };
    }

    function vertical(kind, x, yTop, yBottom) {
        return segment(kind, x, yTop, x, yBottom);
    }

    function horizontal(kind, y, xLeft, xRight) {
        return segment(kind, xLeft, y, xRight, y);
    }

    function box(kind, left, top, right, bottom) {
        return { kind: kind, left: round(left), top: round(top), right: round(right), bottom: round(bottom) };
    }

    function frame(area, out) {
        out.push(horizontal("margin", area.top, area.left, area.right));
        out.push(horizontal("margin", area.bottom, area.left, area.right));
        out.push(vertical("margin", area.left, area.top, area.bottom));
        out.push(vertical("margin", area.right, area.top, area.bottom));
    }

    // Removes segments matching an earlier one in either direction, to 1/1000 pt.
    function dedupeSegments(segments) {
        var seen = {};
        var out = [];
        function point(x, y) {
            var rx = Math.round(x * 1000) / 1000;
            var ry = Math.round(y * 1000) / 1000;
            return (rx === 0 ? 0 : rx) + "," + (ry === 0 ? 0 : ry);
        }
        for (var i = 0; i < segments.length; i++) {
            var s = segments[i];
            var a = point(s.x1, s.y1);
            var b = point(s.x2, s.y2);
            var key = a < b ? a + "|" + b : b + "|" + a;
            if (!hasOwn(seen, key)) {
                seen[key] = true;
                out.push(s);
            }
        }
        return out;
    }

    /*
     * Golden spiral, in the largest golden rectangle that fits an area.
     *
     * Built in a landscape golden rectangle (width PHI, height 1, v downward)
     * by cutting squares off the left, top, right and bottom in turn and
     * drawing a quarter circle through each square. Portrait areas use the
     * transposed rectangle. The result is flipped so the spiral's focus (where
     * it converges) lands in the requested quadrant, then placed in the area.
     *
     * The rectangle keeps its proportion instead of stretching to the area:
     * scaling x and y apart would leave the squares oblong and the arcs
     * elliptical, which is no longer a golden spiral. It is centered, and the
     * rectangle it occupies comes back as `box` so the panel can report it.
     *
     * Returns { curve, squares: [segments], box } in Illustrator coordinates.
     */
    function goldenSpiral(area, focus, squareCount) {
        var x = 0;
        var y = 0;
        var w = PHI;
        var h = 1;
        var arcs = [];
        var cuts = [];

        for (var i = 0; i < squareCount; i++) {
            var side = i % 4;
            var s, p0, p3, c;
            if (side === 0) {       // square on the left
                s = h;
                p0 = [x, y + s]; p3 = [x + s, y]; c = [x + s, y + s];
                cuts.push([x + s, y, x + s, y + h]);
                x += s; w -= s;
            } else if (side === 1) { // square on the top
                s = w;
                p0 = [x, y]; p3 = [x + s, y + s]; c = [x, y + s];
                cuts.push([x, y + s, x + w, y + s]);
                y += s; h -= s;
            } else if (side === 2) { // square on the right
                s = h;
                p0 = [x + w, y]; p3 = [x + w - s, y + s]; c = [x + w - s, y];
                cuts.push([x + w - s, y, x + w - s, y + h]);
                w -= s;
            } else {                 // square on the bottom
                s = w;
                p0 = [x + w, y + h]; p3 = [x, y + h - s]; c = [x + w, y + h - s];
                cuts.push([x, y + h - s, x + w, y + h - s]);
                h -= s;
            }
            arcs.push({
                p0: p0,
                p1: [p0[0] + KAPPA * (p3[0] - c[0]), p0[1] + KAPPA * (p3[1] - c[1])],
                p2: [p3[0] + KAPPA * (p0[0] - c[0]), p3[1] + KAPPA * (p0[1] - c[1])],
                p3: p3
            });
        }

        var portrait = area.height > area.width + EPSILON;
        function normalize(pt) {
            var nx = pt[0] / PHI;
            var ny = pt[1];
            return portrait ? [ny, nx] : [nx, ny];
        }
        var eye = normalize([x + w / 2, y + h / 2]);
        var wantLeft = focus === "top-left" || focus === "bottom-left";
        var wantTop = focus === "top-left" || focus === "top-right";
        var flipX = (eye[0] < 0.5) !== wantLeft;
        var flipY = (eye[1] < 0.5) !== wantTop;

        // The largest golden rectangle inside the area, centered: width / height
        // is PHI for a landscape area and 1 / PHI once the figure is transposed.
        var ratio = portrait ? 1 / PHI : PHI;
        var boxWidth = area.width;
        var boxHeight = boxWidth / ratio;
        if (boxHeight > area.height) {
            boxHeight = area.height;
            boxWidth = boxHeight * ratio;
        }
        var boxLeft = area.left + (area.width - boxWidth) / 2;
        var boxTop = area.top - (area.height - boxHeight) / 2;

        function place(pt) {
            var n = normalize(pt);
            var nx = flipX ? 1 - n[0] : n[0];
            var ny = flipY ? 1 - n[1] : n[1];
            return [round(boxLeft + nx * boxWidth), round(boxTop - ny * boxHeight)];
        }

        var points = [];
        var start = place(arcs[0].p0);
        points.push({ anchor: start, left: start, right: place(arcs[0].p1) });
        for (var a = 0; a < arcs.length; a++) {
            var anchor = place(arcs[a].p3);
            points.push({
                anchor: anchor,
                left: place(arcs[a].p2),
                right: a + 1 < arcs.length ? place(arcs[a + 1].p1) : anchor
            });
        }

        var squares = [];
        for (var k = 0; k < cuts.length; k++) {
            var from = place([cuts[k][0], cuts[k][1]]);
            var to = place([cuts[k][2], cuts[k][3]]);
            squares.push(segment("spiral", from[0], from[1], to[0], to[1]));
        }

        return {
            curve: { kind: "spiral", closed: false, points: points },
            squares: squares,
            box: {
                left: round(boxLeft), top: round(boxTop),
                right: round(boxLeft + boxWidth), bottom: round(boxTop - boxHeight),
                width: round(boxWidth), height: round(boxHeight)
            }
        };
    }

    // A circle as four smooth Bezier points, clockwise from the top.
    function circle(kind, cx, cy, r) {
        var k = KAPPA * r;
        function pt(ax, ay, lx, ly, rx, ry) {
            return { anchor: [round(ax), round(ay)], left: [round(lx), round(ly)], right: [round(rx), round(ry)] };
        }
        return {
            kind: kind,
            closed: true,
            points: [
                pt(cx, cy + r, cx - k, cy + r, cx + k, cy + r),
                pt(cx + r, cy, cx + r, cy + k, cx + r, cy - k),
                pt(cx, cy - r, cx + k, cy - r, cx - k, cy - r),
                pt(cx - r, cy, cx - r, cy - k, cx - r, cy + k)
            ]
        };
    }

    /*
     * How many lines of a family at angleDeg (0 = horizontal, counterclockwise),
     * spaced `spacing` apart perpendicular to the lines, cross the area, with one
     * line through its top-left corner. Counting is separate from drawing so a
     * pattern can be measured against the shape limit before any of it is built.
     * Returns the direction (u), the normal (n), and the range of line indices.
     */
    function familyRange(area, angleDeg, spacing) {
        var angle = angleDeg * Math.PI / 180;
        var ux = Math.cos(angle);
        var uy = Math.sin(angle);
        var nx = -uy;
        var ny = ux;
        var corners = [[area.left, area.top], [area.right, area.top], [area.right, area.bottom], [area.left, area.bottom]];
        var anchor = nx * area.left + ny * area.top;
        var pMin = Infinity;
        var pMax = -Infinity;
        for (var c = 0; c < 4; c++) {
            var p = nx * corners[c][0] + ny * corners[c][1];
            pMin = Math.min(pMin, p);
            pMax = Math.max(pMax, p);
        }
        var first = Math.ceil((pMin - anchor) / spacing - EPSILON);
        var last = Math.floor((pMax - anchor) / spacing + EPSILON);
        return { ux: ux, uy: uy, nx: nx, ny: ny, anchor: anchor, first: first, last: last, count: last - first + 1 };
    }

    /*
     * The lines of that family, clipped to the area.
     * Returns { ok, count, segments } where ok is false if the family would exceed `limit`.
     */
    function lineFamily(kind, area, angleDeg, spacing, limit) {
        var range = familyRange(area, angleDeg, spacing);
        var ux = range.ux;
        var uy = range.uy;
        var nx = range.nx;
        var ny = range.ny;
        var anchor = range.anchor;
        var count = range.count;
        if (count > limit) {
            return { ok: false, count: count, segments: [] };
        }
        var out = [];
        for (var k = range.first; k <= range.last; k++) {
            var offset = anchor + k * spacing;
            var bx = nx * offset;
            var by = ny * offset;
            var t0 = -Infinity;
            var t1 = Infinity;
            var inside = true;
            var axes = [[bx, ux, area.left, area.right], [by, uy, area.bottom, area.top]];
            for (var ax = 0; ax < 2; ax++) {
                var base = axes[ax][0];
                var dir = axes[ax][1];
                var lo = axes[ax][2];
                var hi = axes[ax][3];
                if (Math.abs(dir) < EPSILON) {
                    if (base < lo - EPSILON || base > hi + EPSILON) {
                        inside = false;
                    }
                } else {
                    var ta = (lo - base) / dir;
                    var tb = (hi - base) / dir;
                    t0 = Math.max(t0, Math.min(ta, tb));
                    t1 = Math.min(t1, Math.max(ta, tb));
                }
            }
            if (inside && t1 - t0 > 1e-4) {
                out.push(segment(kind, bx + t0 * ux, by + t0 * uy, bx + t1 * ux, by + t1 * uy));
            }
        }
        return { ok: true, count: count, segments: out };
    }

    /*
     * Reciprocal diagonals of a w x h rectangle: from each corner, the line
     * perpendicular to the diagonal that doesn't pass through it, to the far side.
     * Returns [u1, v1, u2, v2] in local coordinates (v downward).
     */
    function reciprocals(w, h) {
        function hit(u, v, du, dv) {
            var ts = [];
            if (du > EPSILON) { ts.push((w - u) / du); }
            if (du < -EPSILON) { ts.push(-u / du); }
            if (dv > EPSILON) { ts.push((h - v) / dv); }
            if (dv < -EPSILON) { ts.push(-v / dv); }
            var tMin = Infinity;
            for (var k = 0; k < ts.length; k++) {
                if (ts[k] > EPSILON && ts[k] < tMin) {
                    tMin = ts[k];
                }
            }
            return [u, v, u + du * tMin, v + dv * tMin];
        }
        return [hit(0, 0, h, w), hit(w, 0, -h, w), hit(w, h, -h, -w), hit(0, h, h, -w)];
    }

    function failure(errors) {
        return { ok: false, errors: errors, segments: [], boxes: [], polygons: [], curves: [], dots: [] };
    }

    function pointsFinite(pt) {
        return !!pt && isFiniteNumber(pt[0]) && isFiniteNumber(pt[1]);
    }

    /*
     * Every coordinate a build is about to hand back. A NaN or an infinity here
     * means the geometry went wrong upstream, and drawing it would leave broken
     * paths on the page, so builds check this before reporting success.
     */
    function allFinite(shapes) {
        var i, j, k, pts;
        for (i = 0; i < shapes.segments.length; i++) {
            var s = shapes.segments[i];
            if (!isFiniteNumber(s.x1) || !isFiniteNumber(s.y1) || !isFiniteNumber(s.x2) || !isFiniteNumber(s.y2)) {
                return false;
            }
        }
        for (i = 0; i < shapes.boxes.length; i++) {
            var b = shapes.boxes[i];
            if (!isFiniteNumber(b.left) || !isFiniteNumber(b.top) || !isFiniteNumber(b.right) || !isFiniteNumber(b.bottom)) {
                return false;
            }
        }
        for (i = 0; i < shapes.polygons.length; i++) {
            pts = shapes.polygons[i].points;
            for (j = 0; j < pts.length; j++) {
                if (!pointsFinite(pts[j])) {
                    return false;
                }
            }
        }
        for (i = 0; i < shapes.curves.length; i++) {
            pts = shapes.curves[i].points;
            for (j = 0; j < pts.length; j++) {
                var handles = [pts[j].anchor, pts[j].left, pts[j].right];
                for (k = 0; k < handles.length; k++) {
                    if (!pointsFinite(handles[k])) {
                        return false;
                    }
                }
            }
        }
        for (i = 0; i < shapes.dots.length; i++) {
            var d = shapes.dots[i];
            if (!isFiniteNumber(d.x) || !isFiniteNumber(d.y) || !isFiniteNumber(d.d)) {
                return false;
            }
        }
        return true;
    }

    // The field a whole-grid problem belongs to: the one the panel can highlight.
    function gridField(s) {
        if (s.type === "pattern") {
            return s.pattern === "radial" ? "rings" : "patternSize";
        }
        if (s.type === "columns" || s.type === "modular") {
            return "columns";
        }
        if (s.type === "baseline") {
            return "baselineSpacing";
        }
        return "type";
    }

    function brokenGeometry(field) {
        return {
            field: field,
            message: "These settings work out to a position that isn't a number, so nothing was drawn. Change the sizes a little and try again."
        };
    }

    /*
     * Proportions so far apart that one track collapses. The gutter isn't the
     * culprit here, so the message names the ratio and the track it sizes.
     */
    function ratioError(field, ratios, index, noun, span, unit) {
        var place = isFiniteNumber(index) ? index : 0;
        return {
            field: field,
            message: FIELD_NAMES[field] + " don't fit. The ratio " + ratios[place] + " leaves " + noun + " " + (place + 1) +
                " with almost no room; the space between margins is " + formatMeasure(span, unit) +
                ". Use proportions closer together."
        };
    }

    // Baseline lines between margins, shared by baseline grids and grids with a baseline.
    function addBaselines(s, content, spanLeft, spanRight, unit, segments, errors, metrics) {
        if (s.baselineOffset > content.height + EPSILON) {
            errors.push({
                field: "baselineOffset",
                message: "Baseline offset of " + formatMeasure(s.baselineOffset, unit) +
                    " is deeper than the space between margins (" + formatMeasure(content.height, unit) + ")."
            });
            return;
        }
        var available = content.height - s.baselineOffset;
        var count = Math.floor(available / s.baselineSpacing + EPSILON) + 1;
        if (count > LIMITS.maxBaselines) {
            errors.push({
                field: "baselineSpacing",
                message: "That spacing creates " + count + " baselines. Use a larger spacing to stay at or under " + LIMITS.maxBaselines + "."
            });
            return;
        }
        metrics.baselineCount = count;
        for (var i = 0; i < count; i++) {
            segments.push(horizontal("baseline", content.top - s.baselineOffset - i * s.baselineSpacing, spanLeft, spanRight));
        }
    }

    function tooMany(field, count, noun) {
        return {
            field: field,
            message: "That makes " + count + " " + noun + ". Use a larger size or fewer divisions to stay at or under " + LIMITS.maxShapes + "."
        };
    }

    // What a pattern's cells are called when they don't fit between the margins.
    var PATTERN_CELLS = {
        square: "Squares of ",
        diagonal: "Diamonds of ",
        isometric: "Triangles with sides of "
    };

    /*
     * Pattern grids fill `area`; the margin frame is drawn around `frameArea`,
     * which differs only when the pattern runs out to the artboard edges.
     * Pushes shapes into `shapes` and returns an error object or null.
     */
    function buildPattern(s, area, frameArea, shapes, metrics, unit) {
        var size = s.patternSize;
        var limit = LIMITS.maxShapes;
        var i, j, fam;

        if (s.pattern !== "dots") {
            frame(frameArea, shapes.segments);
        }

        if (s.pattern === "square" || s.pattern === "diagonal" || s.pattern === "isometric") {
            var families;
            if (s.pattern === "square") {
                families = [[90, size], [0, size]];
            } else if (s.pattern === "diagonal") {
                // Two families mirrored about the vertical, spaced so each diamond is `size` wide.
                var tilt = s.patternAngle || 45;
                var gap = size * Math.sin(tilt * Math.PI / 180);
                families = [[tilt, gap], [180 - tilt, gap]];
            } else {
                // Equilateral triangles with sides `size`.
                families = [[90, size * SQRT3 / 2], [30, size * SQRT3 / 2], [150, size * SQRT3 / 2]];
            }
            // Measure every family first: a pattern too big for the area draws
            // nothing but the frame, and one too small blows the shape limit.
            // Both are the size's doing, so both are reported on the size.
            var counts = [];
            var lines = 0;
            for (i = 0; i < families.length; i++) {
                counts.push(familyRange(area, families[i][0], families[i][1]).count);
                lines += counts[i];
                if (counts[i] < 2) {
                    // Fewer than two lines in a family means not one whole cell fits.
                    return {
                        field: "patternSize",
                        message: PATTERN_CELLS[s.pattern] + formatMeasure(size, unit) +
                            " don't fit between the margins. Use a smaller size."
                    };
                }
            }
            lines += 4; // The margin frame around them.
            if (lines > limit) {
                return tooMany("patternSize", lines, "lines");
            }
            for (i = 0; i < families.length; i++) {
                fam = lineFamily("pattern", area, families[i][0], families[i][1], counts[i]);
                for (j = 0; j < fam.segments.length; j++) {
                    shapes.segments.push(fam.segments[j]);
                }
            }
            metrics.cellSize = round(size);
            return null;
        }

        if (s.pattern === "dots") {
            var across = Math.floor(area.width / size + EPSILON) + 1;
            var down = Math.floor(area.height / size + EPSILON) + 1;
            if (across * down > limit) {
                return tooMany("patternSize", across * down, "dots");
            }
            for (j = 0; j < down; j++) {
                for (i = 0; i < across; i++) {
                    shapes.dots.push({ kind: "dot", x: round(area.left + i * size), y: round(area.top - j * size), d: s.dotSize });
                }
            }
            metrics.cellSize = round(size);
            metrics.dotCount = across * down;
            return null;
        }

        if (s.pattern === "hexagon") {
            // Pointy-top hexagons with sides `size`; only whole hexagons, centered as a block.
            var w = SQRT3 * size;
            var rowStep = 1.5 * size;
            var rows = area.height + EPSILON >= 2 * size ? Math.floor((area.height - 2 * size) / rowStep + EPSILON) + 1 : 0;
            var evenCount = Math.floor(area.width / w + EPSILON);
            var oddCount = rows > 1 ? Math.floor((area.width - w / 2) / w + EPSILON) : evenCount;
            // Offset rows start half a hexagon in, so a width that fits only the
            // even rows would drop every odd one. Refuse rather than draw gaps.
            if (rows < 1 || evenCount < 1 || oddCount < 1) {
                return {
                    field: "patternSize",
                    message: "Hexagons with " + formatMeasure(size, unit) + " sides don't fit between the margins. Use a smaller size."
                };
            }
            var total = 0;
            for (j = 0; j < rows; j++) {
                total += j % 2 === 0 ? evenCount : oddCount;
            }
            if (total > limit) {
                return tooMany("patternSize", total, "hexagons");
            }
            var blockWidth = rows > 1 ? Math.max(evenCount * w, oddCount * w + w / 2) : evenCount * w;
            var blockHeight = 2 * size + (rows - 1) * rowStep;
            var originX = area.left + (area.width - blockWidth) / 2;
            var originY = area.top - (area.height - blockHeight) / 2;
            for (j = 0; j < rows; j++) {
                var count = j % 2 === 0 ? evenCount : oddCount;
                var cy = originY - size - j * rowStep;
                for (i = 0; i < count; i++) {
                    var cx = originX + w / 2 + i * w + (j % 2 === 1 ? w / 2 : 0);
                    var pts = [];
                    for (var v = 0; v < 6; v++) {
                        var a = (90 - v * 60) * Math.PI / 180;
                        pts.push([round(cx + size * Math.cos(a)), round(cy + size * Math.sin(a))]);
                    }
                    shapes.polygons.push({ kind: "hexagon", points: pts });
                }
            }
            metrics.cellSize = round(size);
            metrics.hexagonCount = total;
            return null;
        }

        // Radial: evenly spaced rings and spokes from the center of the area.
        var radius = Math.min(area.width, area.height) / 2;
        var centerX = area.left + area.width / 2;
        var centerY = area.top - area.height / 2;
        for (i = 1; i <= s.rings; i++) {
            shapes.curves.push(circle("ring", centerX, centerY, radius * i / s.rings));
        }
        for (i = 0; i < s.spokes; i++) {
            var angle = (90 - i * 360 / s.spokes) * Math.PI / 180;
            shapes.segments.push(segment("spoke", centerX, centerY, centerX + radius * Math.cos(angle), centerY + radius * Math.sin(angle)));
        }
        metrics.ringSpacing = round(radius / s.rings);
        return null;
    }

    /*
     * Builds the full grid for one artboard.
     *   rect:    Illustrator artboardRect [left, top, right, bottom]
     *   raw:     panel settings (lengths in raw.units)
     *   options: { areaLabel: word used in messages, "artboard" by default }
     * Returns {
     *   ok, errors, settings,
     *   artboard: { left, top, right, bottom, width, height },
     *   content:  { left, top, right, bottom, width, height },
     *   metrics:  { columnWidth, columnWidths, rowHeight, rowHeights, baselineCount, blockCount,
     *               cellSize, dotCount, hexagonCount, ringSpacing } (lengths in points),
     *   tracks:   { columns: [{ left, right }], rows: [{ top, bottom }] },
     *   segments, boxes, polygons, curves, dots (see the file header),
     *   shapeCount
     * }
     */
    function buildGrid(rect, raw, options) {
        var areaLabel = (options && options.areaLabel) || "artboard";
        var normalized = normalizeSettings(raw);
        if (!normalized.ok) {
            return failure(normalized.errors);
        }
        var s = normalized.settings;
        var unit = s.units;

        var board = readRect(rect);
        if (!board.ok) {
            return failure([{ field: "artboard", message: board.error }]);
        }
        var a = board.box;

        var content = {
            left: a.left + s.marginLeft,
            right: a.right - s.marginRight,
            top: a.top - s.marginTop,
            bottom: a.bottom + s.marginBottom
        };
        content.width = content.right - content.left;
        content.height = content.top - content.bottom;

        var errors = [];
        if (content.width <= EPSILON) {
            errors.push({
                field: "marginLeft",
                message: "Left and right margins leave no room. Together they must be less than the " + areaLabel + " width of " + formatMeasure(a.width, unit) + "."
            });
        }
        if (content.height <= EPSILON) {
            errors.push({
                field: "marginTop",
                message: "Top and bottom margins leave no room. Together they must be less than the " + areaLabel + " height of " + formatMeasure(a.height, unit) + "."
            });
        }
        if (errors.length) {
            return failure(errors);
        }

        // Lines along a column run between these Y values; lines along a row between these X values.
        var spanTop = s.extendToEdges ? a.top : content.top;
        var spanBottom = s.extendToEdges ? a.bottom : content.bottom;
        var spanLeft = s.extendToEdges ? a.left : content.left;
        var spanRight = s.extendToEdges ? a.right : content.right;

        var shapes = { segments: [], boxes: [], polygons: [], curves: [], dots: [] };
        var segments = shapes.segments;
        var boxes = shapes.boxes;
        var metrics = { columnWidth: null, rowHeight: null, baselineCount: null };
        var tracks = { columns: [], rows: [] };
        var asBoxes = s.output === "boxes";
        var i, j, edges;

        if (s.type === "columns" || s.type === "modular") {
            var cols = divideSpan(content.width, s.columns, s.columnGutter, s.columnRatios);
            if (!cols.ok) {
                errors.push(s.columnRatios
                    ? ratioError("columnRatios", s.columnRatios, cols.index, "column", content.width, unit)
                    : {
                        field: "columnGutter",
                        message: "Columns don't fit. " + s.columns + " columns with " + formatMeasure(s.columnGutter, unit) +
                            " gutters need more than " + formatMeasure(s.columnGutter * (s.columns - 1), unit) +
                            " of width; the space between margins is " + formatMeasure(content.width, unit) + "."
                    });
            } else {
                metrics.columnWidth = cols.equal ? round(cols.size) : null;
                metrics.columnWidths = [];
                for (i = 0; i < cols.tracks.length; i++) {
                    tracks.columns.push({ left: round(content.left + cols.tracks[i].start), right: round(content.left + cols.tracks[i].end) });
                    metrics.columnWidths.push(round(cols.tracks[i].end - cols.tracks[i].start));
                }
                if (!asBoxes) {
                    edges = trackEdges(cols.tracks);
                    for (i = 0; i < edges.length; i++) {
                        segments.push(vertical("column", content.left + edges[i], spanTop, spanBottom));
                    }
                }
            }
        }

        if (s.type === "modular") {
            var rows;
            var squareError = null;
            if (s.squareModules && metrics.columnWidth) {
                // Rows as tall as the columns are wide, as many as fit from the top margin.
                var squareCount = Math.floor((content.height + s.rowGutter) / (metrics.columnWidth + s.rowGutter) + EPSILON);
                if (squareCount > COUNT_LIMITS.rows[1]) {
                    // Square modules take their row count from the column width, so
                    // the column count is the only thing the user can change here.
                    squareError = {
                        field: "squareModules",
                        message: "Square modules " + formatMeasure(metrics.columnWidth, unit) + " wide make " + squareCount +
                            " rows, more than the " + COUNT_LIMITS.rows[1] + " allowed. Use fewer columns to make the modules larger."
                    };
                    rows = { ok: true, size: metrics.columnWidth, equal: true, tracks: [] };
                } else {
                    var squareTracks = [];
                    for (j = 0; j < squareCount; j++) {
                        var squareStart = j * (metrics.columnWidth + s.rowGutter);
                        squareTracks.push({ start: squareStart, end: squareStart + metrics.columnWidth });
                    }
                    rows = squareCount >= 1 ? { ok: true, size: metrics.columnWidth, equal: true, tracks: squareTracks } : { ok: false, size: 0 };
                    s.rows = squareCount;
                }
            } else if (s.squareModules) {
                rows = { ok: false, size: 0 };
            } else {
                rows = divideSpan(content.height, s.rows, s.rowGutter, s.rowRatios);
            }
            if (squareError) {
                errors.push(squareError);
            } else if (!rows.ok) {
                errors.push(s.squareModules ? {
                    field: "squareModules",
                    message: "Square modules need equal columns that fit between the margins at least once."
                } : (s.rowRatios
                    ? ratioError("rowRatios", s.rowRatios, rows.index, "row", content.height, unit)
                    : {
                        field: "rowGutter",
                        message: "Rows don't fit. " + s.rows + " rows with " + formatMeasure(s.rowGutter, unit) +
                            " gutters need more than " + formatMeasure(s.rowGutter * (s.rows - 1), unit) +
                            " of height; the space between margins is " + formatMeasure(content.height, unit) + "."
                    }));
            } else {
                metrics.rowHeight = rows.equal ? round(rows.size) : null;
                metrics.rowHeights = [];
                for (i = 0; i < rows.tracks.length; i++) {
                    tracks.rows.push({ top: round(content.top - rows.tracks[i].start), bottom: round(content.top - rows.tracks[i].end) });
                    metrics.rowHeights.push(round(rows.tracks[i].end - rows.tracks[i].start));
                }
                if (!asBoxes) {
                    edges = trackEdges(rows.tracks);
                    for (i = 0; i < edges.length; i++) {
                        // Distances run downward from the top margin, so Y decreases.
                        segments.push(horizontal("row", content.top - edges[i], spanLeft, spanRight));
                    }
                }
            }
        }

        if ((s.type === "columns" || s.type === "modular") && s.overlayColumns > 1 && errors.length === 0) {
            // A second, gutterless division of the same width: a compound grid such as 3 + 4.
            for (i = 1; i < s.overlayColumns; i++) {
                segments.push(vertical("overlay", content.left + content.width * i / s.overlayColumns, spanTop, spanBottom));
            }
        }

        if ((s.type === "columns" || s.type === "modular") && s.blocks && s.blocks.length && errors.length === 0) {
            // Blocks outside the grid are clipped to it; blocks entirely outside are skipped.
            metrics.blockCount = 0;
            for (i = 0; i < s.blocks.length; i++) {
                var blk = s.blocks[i];
                var c0 = blk.column - 1;
                if (c0 >= tracks.columns.length) {
                    continue;
                }
                var c1 = Math.min(c0 + blk.columns, tracks.columns.length) - 1;
                var blockTop = content.top;
                var blockBottom = content.bottom;
                if (s.type === "modular") {
                    var r0 = blk.row - 1;
                    if (r0 >= tracks.rows.length) {
                        continue;
                    }
                    var r1 = Math.min(r0 + blk.rows, tracks.rows.length) - 1;
                    blockTop = tracks.rows[r0].top;
                    blockBottom = tracks.rows[r1].bottom;
                }
                boxes.push(box("block", tracks.columns[c0].left, blockTop, tracks.columns[c1].right, blockBottom));
                metrics.blockCount++;
            }
        }

        if (s.shadeGutters && errors.length === 0) {
            // Column gutters run full height; row gutters are split around them so fills never overlap.
            var gaps = [];
            for (i = 0; i + 1 < tracks.columns.length; i++) {
                if (tracks.columns[i + 1].left - tracks.columns[i].right > EPSILON) {
                    gaps.push([tracks.columns[i].right, tracks.columns[i + 1].left]);
                    boxes.push(box("gutter", tracks.columns[i].right, spanTop, tracks.columns[i + 1].left, spanBottom));
                }
            }
            for (j = 0; j + 1 < tracks.rows.length; j++) {
                var gTop = tracks.rows[j].bottom;
                var gBottom = tracks.rows[j + 1].top;
                if (gTop - gBottom <= EPSILON) {
                    continue;
                }
                var from = spanLeft;
                for (i = 0; i <= gaps.length; i++) {
                    var to = i < gaps.length ? gaps[i][0] : spanRight;
                    if (to - from > EPSILON) {
                        boxes.push(box("gutter", from, gTop, to, gBottom));
                    }
                    if (i < gaps.length) {
                        from = gaps[i][1];
                    }
                }
            }
        }

        if (asBoxes && errors.length === 0) {
            if (s.type === "columns") {
                for (i = 0; i < tracks.columns.length; i++) {
                    boxes.push(box("column", tracks.columns[i].left, spanTop, tracks.columns[i].right, spanBottom));
                }
            } else if (tracks.columns.length * tracks.rows.length <= LIMITS.maxShapes) {
                for (j = 0; j < tracks.rows.length; j++) {
                    for (i = 0; i < tracks.columns.length; i++) {
                        boxes.push(box("module", tracks.columns[i].left, tracks.rows[j].top, tracks.columns[i].right, tracks.rows[j].bottom));
                    }
                }
            } else {
                errors.push({
                    field: "columns",
                    message: "That makes " + (tracks.columns.length * tracks.rows.length) + " boxes. Reduce columns or rows to stay at or under " + LIMITS.maxShapes + "."
                });
            }
        }

        if (s.type === "columns" && !asBoxes && errors.length === 0) {
            // A column grid still marks the top and bottom of the text area.
            segments.push(horizontal("margin", content.top, spanLeft, spanRight));
            segments.push(horizontal("margin", content.bottom, spanLeft, spanRight));
        }

        if (s.type === "baseline" || ((s.type === "columns" || s.type === "modular") && s.addBaseline && errors.length === 0)) {
            addBaselines(s, content, spanLeft, spanRight, unit, segments, errors, metrics);
        }

        if (s.type === "composition") {
            var l = content.left;
            var r = content.right;
            var t = content.top;
            var b = content.bottom;
            var cw = content.width;
            var ch = content.height;

            // The frame marks the area the guides divide.
            frame(content, segments);

            if (s.compThirds) {
                for (i = 1; i <= 2; i++) {
                    segments.push(vertical("thirds", l + cw * i / 3, t, b));
                    segments.push(horizontal("thirds", t - ch * i / 3, l, r));
                }
            }
            if (s.compGolden) {
                var minor = 1 / (PHI * PHI); // 0.382
                var major = 1 / PHI;         // 0.618
                segments.push(vertical("golden", l + cw * minor, t, b));
                segments.push(vertical("golden", l + cw * major, t, b));
                segments.push(horizontal("golden", t - ch * minor, l, r));
                segments.push(horizontal("golden", t - ch * major, l, r));
            }
            if (s.compDiagonals) {
                segments.push(segment("diagonal", l, t, r, b));
                segments.push(segment("diagonal", l, b, r, t));
            }
            if (s.compCenter) {
                segments.push(vertical("center", l + cw / 2, t, b));
                segments.push(horizontal("center", t - ch / 2, l, r));
            }
            if (s.compFifths) {
                for (i = 1; i <= 4; i++) {
                    segments.push(vertical("fifths", l + cw * i / 5, t, b));
                    segments.push(horizontal("fifths", t - ch * i / 5, l, r));
                }
            }
            if (s.compArmature || s.compDynamic || s.compVillard) {
                var local = function (kind, u1, v1, u2, v2) {
                    // (u, v) measured from the top-left corner, v downward.
                    segments.push(segment(kind, l + u1, t - v1, l + u2, t - v2));
                };
                if (s.compArmature || s.compDynamic) {
                    // Both figures are built on the two diagonals.
                    var both = s.compArmature ? "armature" : "dynamic";
                    local(both, 0, 0, cw, ch);
                    local(both, cw, 0, 0, ch);
                }
                if (s.compDynamic) {
                    // Reciprocals belong to the dynamic rectangle, not the armature:
                    // the classical armature is the two diagonals and the eight
                    // corner-to-midpoint lines, nothing more.
                    var recips = reciprocals(cw, ch);
                    for (i = 0; i < recips.length; i++) {
                        local("dynamic", recips[i][0], recips[i][1], recips[i][2], recips[i][3]);
                    }
                }
                if (s.compArmature) {
                    // Each corner to the midpoints of the two sides it doesn't touch.
                    local("armature", 0, 0, cw, ch / 2);
                    local("armature", 0, 0, cw / 2, ch);
                    local("armature", cw, 0, 0, ch / 2);
                    local("armature", cw, 0, cw / 2, ch);
                    local("armature", cw, ch, 0, ch / 2);
                    local("armature", cw, ch, cw / 2, 0);
                    local("armature", 0, ch, cw, ch / 2);
                    local("armature", 0, ch, cw / 2, 0);
                }
                if (s.compDynamic) {
                    // Lines through the "eyes", where reciprocals cross the diagonals.
                    var denominator = cw * cw + ch * ch;
                    var eyeU = cw * ch * ch / denominator;
                    var eyeV = cw * cw * ch / denominator;
                    local("dynamic", eyeU, 0, eyeU, ch);
                    local("dynamic", cw - eyeU, 0, cw - eyeU, ch);
                    local("dynamic", 0, eyeV, cw, eyeV);
                    local("dynamic", 0, ch - eyeV, cw, ch - eyeV);
                }
                if (s.compVillard) {
                    // Villard's figure: diagonals and corner-to-top-center lines cross at one third.
                    local("villard", 0, 0, cw, ch);
                    local("villard", cw, 0, 0, ch);
                    local("villard", 0, ch, cw / 2, 0);
                    local("villard", cw, ch, cw / 2, 0);
                    local("villard", 0, ch / 3, cw, ch / 3);
                    local("villard", cw / 3, 0, cw / 3, ch);
                    local("villard", cw * 2 / 3, 0, cw * 2 / 3, ch);
                }
            }
            if (s.compSpiral) {
                var spiral = goldenSpiral(content, s.spiralFocus, LIMITS.spiralSquares);
                shapes.curves.push(spiral.curve);
                for (i = 0; i < spiral.squares.length; i++) {
                    segments.push(spiral.squares[i]);
                }
                // The golden rectangle the spiral sits in, so the panel can say
                // where it is when the area isn't golden itself.
                metrics.spiral = spiral.box;
            }
        }

        if (s.type === "pattern") {
            // Patterns fill the content area, or the whole artboard when extended;
            // the frame still marks the margins either way.
            var patternArea = s.extendToEdges ? {
                left: spanLeft, right: spanRight, top: spanTop, bottom: spanBottom,
                width: spanRight - spanLeft, height: spanTop - spanBottom
            } : content;
            var patternError = buildPattern(s, patternArea, content, shapes, metrics, unit);
            if (patternError) {
                errors.push(patternError);
            }
        }

        if (errors.length) {
            return failure(errors);
        }

        shapes.segments = dedupeSegments(shapes.segments);
        var shapeCount = shapes.segments.length + shapes.boxes.length + shapes.polygons.length + shapes.curves.length + shapes.dots.length;
        if (shapeCount > LIMITS.maxShapes) {
            return failure([{
                field: gridField(s),
                message: "This grid needs " + shapeCount + " shapes. Reduce the count to stay at or under " + LIMITS.maxShapes + "."
            }]);
        }

        // Last line of defence: nothing leaves here with a coordinate that isn't
        // a number, whatever the arithmetic did on the way.
        if (!allFinite(shapes)) {
            return failure([brokenGeometry(gridField(s))]);
        }

        return {
            ok: true,
            errors: [],
            settings: s,
            artboard: {
                left: round(a.left), top: round(a.top), right: round(a.right), bottom: round(a.bottom),
                width: round(a.width), height: round(a.height)
            },
            content: {
                left: round(content.left), top: round(content.top), right: round(content.right), bottom: round(content.bottom),
                width: round(content.width), height: round(content.height)
            },
            metrics: metrics,
            tracks: tracks,
            segments: shapes.segments,
            boxes: shapes.boxes,
            polygons: shapes.polygons,
            curves: shapes.curves,
            dots: shapes.dots,
            shapeCount: shapeCount
        };
    }

    function pushUnique3(list, value) {
        for (var i = 0; i < list.length; i++) {
            if (Math.abs(list[i] - value) <= 1e-3) {
                return;
            }
        }
        list.push(value);
    }

    /*
     * Positions an object can align to, from a built grid: every vertical line's
     * X, every horizontal line's Y, box edges, and the content area's edges.
     * Returns { xs, ys } sorted ascending.
     */
    function snapLines(result) {
        var xs = [];
        var ys = [];
        var i;
        if (!result || !result.ok) {
            return { xs: xs, ys: ys };
        }
        pushUnique3(xs, result.content.left);
        pushUnique3(xs, result.content.right);
        pushUnique3(ys, result.content.top);
        pushUnique3(ys, result.content.bottom);
        for (i = 0; i < result.segments.length; i++) {
            var seg = result.segments[i];
            if (Math.abs(seg.x1 - seg.x2) <= 1e-6) {
                pushUnique3(xs, seg.x1);
            } else if (Math.abs(seg.y1 - seg.y2) <= 1e-6) {
                pushUnique3(ys, seg.y1);
            }
        }
        for (i = 0; i < result.boxes.length; i++) {
            var b = result.boxes[i];
            pushUnique3(xs, b.left);
            pushUnique3(xs, b.right);
            pushUnique3(ys, b.top);
            pushUnique3(ys, b.bottom);
        }
        xs.sort(function (p, q) { return p - q; });
        ys.sort(function (p, q) { return p - q; });
        return { xs: xs, ys: ys };
    }

    function nearestOffset(lines, value) {
        var best = null;
        for (var i = 0; i < lines.length; i++) {
            var d = lines[i] - value;
            if (best === null || Math.abs(d) < Math.abs(best)) {
                best = d;
            }
        }
        return best;
    }

    /*
     * How far an object must move to sit on the grid.
     *   rect: [left, top, right, bottom] (Illustrator coordinates)
     * Aligns whichever horizontal edge is closer to a vertical line, and whichever
     * vertical edge is closer to a horizontal line.
     * Returns { dx, dy, onGrid } with dy positive meaning up.
     */
    function snapRect(rect, lines, tolerance) {
        var tol = tolerance === undefined ? 0.01 : tolerance;
        var dx = 0;
        var dy = 0;
        if (lines.xs.length) {
            var dl = nearestOffset(lines.xs, rect[0]);
            var dr = nearestOffset(lines.xs, rect[2]);
            dx = Math.abs(dl) <= Math.abs(dr) ? dl : dr;
        }
        if (lines.ys.length) {
            var dt = nearestOffset(lines.ys, rect[1]);
            var db = nearestOffset(lines.ys, rect[3]);
            dy = Math.abs(dt) <= Math.abs(db) ? dt : db;
        }
        dx = round(dx);
        dy = round(dy);
        return { dx: dx, dy: dy, onGrid: Math.abs(dx) <= tol && Math.abs(dy) <= tol };
    }

    // ------------------------------------------------------------ construction

    function cubicPoint(p0, c1, c2, p3, t) {
        var m = 1 - t;
        var a = m * m * m;
        var b = 3 * m * m * t;
        var c = 3 * m * t * t;
        var d = t * t * t;
        return [a * p0[0] + b * c1[0] + c * c2[0] + d * p3[0], a * p0[1] + b * c1[1] + c * c2[1] + d * p3[1]];
    }

    // Parameters in (0, 1) where a cubic's coordinate on one axis turns around.
    function axisExtrema(p0, c1, c2, p3, axis) {
        var d0 = c1[axis] - p0[axis];
        var d1 = c2[axis] - c1[axis];
        var d2 = p3[axis] - c2[axis];
        var qa = d0 - 2 * d1 + d2;
        var qb = 2 * (d1 - d0);
        var qc = d0;
        var roots = [];
        if (Math.abs(qa) < 1e-9) {
            if (Math.abs(qb) > 1e-9) {
                roots.push(-qc / qb);
            }
        } else {
            var disc = qb * qb - 4 * qa * qc;
            if (disc >= 0) {
                var sq = Math.sqrt(disc);
                roots.push((-qb + sq) / (2 * qa), (-qb - sq) / (2 * qa));
            }
        }
        var out = [];
        for (var i = 0; i < roots.length; i++) {
            if (roots[i] > 1e-6 && roots[i] < 1 - 1e-6) {
                out.push(roots[i]);
            }
        }
        return out;
    }

    function circleThrough(a, b, c) {
        var d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
        if (Math.abs(d) < 1e-9) {
            return null;
        }
        var a2 = a[0] * a[0] + a[1] * a[1];
        var b2 = b[0] * b[0] + b[1] * b[1];
        var c2 = c[0] * c[0] + c[1] * c[1];
        var ux = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d;
        var uy = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
        return { x: ux, y: uy, r: Math.sqrt((a[0] - ux) * (a[0] - ux) + (a[1] - uy) * (a[1] - uy)) };
    }

    function mergeValue(list, value, tolerance) {
        for (var i = 0; i < list.length; i++) {
            if (Math.abs(list[i] - value) <= tolerance) {
                return;
            }
        }
        list.push(value);
    }

    /*
     * Construction lines for artwork, as used to present logo geometry.
     *   paths: [{ closed, points: [{ anchor, left, right }] }] in Illustrator
     *          coordinates (Y up); left/right are the incoming/outgoing handles
     *   rect:  artboard rectangle [left, top, right, bottom], for extending lines
     *   raw:   panel settings (construction options and appearance)
     * Draws the artwork's bounding box, key lines through anchors and curve
     * extremes, circles fitted to circular arcs, and optional center lines and
     * diagonals. Returns the same shape lists as buildGrid.
     * Segment kinds: "bounds", "keyline", "center", "diagonal"; curve kind "circle".
     */
    function buildConstruction(paths, rect, raw) {
        var i, j;
        // Construction lines borrow the appearance settings and nothing else, so
        // only those are validated: a column count the panel happens to be
        // holding has no bearing on lines drawn around a logo.
        var styleOnly = { type: "columns" };
        for (i = 0; i < CONSTRUCTION_STYLE_KEYS.length; i++) {
            if (isProvided(raw, CONSTRUCTION_STYLE_KEYS[i])) {
                styleOnly[CONSTRUCTION_STYLE_KEYS[i]] = raw[CONSTRUCTION_STYLE_KEYS[i]];
            }
        }
        var styled = normalizeSettings(styleOnly);
        var errors = styled.errors.slice();
        var s = styled.settings;
        // The artwork sets the extent of these lines; there are no margins to run past.
        s.extendToEdgesApplies = false;

        var any = false;
        for (i = 0; i < CONSTRUCTION_FLAGS.length; i++) {
            s[CONSTRUCTION_FLAGS[i]] = pick(raw, CONSTRUCTION_FLAGS[i]) === true;
            any = any || s[CONSTRUCTION_FLAGS[i]];
        }
        if (!any) {
            errors.push({ field: "construction", message: "Choose at least one kind of construction line." });
        }
        s.conExtend = pick(raw, "conExtend") === "bounds" ? "bounds" : "artboard";
        var padding = parseNumber(pick(raw, "conPadding"));
        if (!isProvided(raw, "conPadding")) {
            padding = fromPoints(DEFAULTS.conPadding, s.units);
        }
        if (!isFiniteNumber(padding) || padding < 0) {
            errors.push({ field: "conPadding", message: "Extension must be a number of 0 or more." });
        } else {
            s.conPadding = toPoints(padding, s.units);
        }
        if (s.output !== "guides") {
            s.kindColors = {};
            var colorFields = [["bounds", "conBoundsColor"], ["keyline", "conKeylineColor"], ["circle", "conCircleColor"]];
            for (i = 0; i < colorFields.length; i++) {
                var hex = pick(raw, colorFields[i][1]);
                if (!isHexColor(hex)) {
                    errors.push({ field: colorFields[i][1], message: FIELD_NAMES[colorFields[i][1]] + " must be a hex color such as #2F7CF6." });
                } else {
                    s.kindColors[colorFields[i][0]] = hex.toUpperCase();
                    s[colorFields[i][1]] = hex.toUpperCase();
                }
            }
            // Center lines and diagonals share the key line color.
            s.kindColors.center = s.kindColors.keyline;
            s.kindColors.diagonal = s.kindColors.keyline;
        }

        var board = readRect(rect);
        if (!board.ok) {
            errors.push({ field: "artboard", message: board.error });
        }

        // Measure every segment exactly for the bounds; collect anchors, curve
        // extremes, and arcs.
        var xs = [];
        var ys = [];
        var arcs = [];
        var minX = Infinity;
        var maxX = -Infinity;
        var minY = Infinity;
        var maxY = -Infinity;
        var pointCount = 0;
        var unreadable = false;
        function include(pt) {
            minX = Math.min(minX, pt[0]);
            maxX = Math.max(maxX, pt[0]);
            minY = Math.min(minY, pt[1]);
            maxY = Math.max(maxY, pt[1]);
        }
        function turningPoints(p0, c1, c2, p3, axis) {
            var ts = axisExtrema(p0, c1, c2, p3, axis);
            for (var t = 0; t < ts.length; t++) {
                include(cubicPoint(p0, c1, c2, p3, ts[t]));
            }
        }
        for (i = 0; paths && i < paths.length; i++) {
            // A path with no points, or with a point that isn't a pair of numbers,
            // can't be measured. The host sends these when the selection holds
            // something that isn't artwork, so it is a selection problem, not a crash.
            var pts = paths[i] ? paths[i].points : null;
            if (!pts || typeof pts.length !== "number") {
                unreadable = true;
                continue;
            }
            for (j = 0; j < pts.length; j++) {
                if (!pts[j] || !pointsFinite(pts[j].anchor)) {
                    unreadable = true;
                }
            }
            if (unreadable) {
                continue;
            }
            pointCount += pts.length;
            var segmentCount = paths[i].closed ? pts.length : pts.length - 1;
            for (j = 0; j < pts.length; j++) {
                include(pts[j].anchor);
            }
            for (j = 0; j < segmentCount; j++) {
                var from = pts[j];
                var to = pts[(j + 1) % pts.length];
                var p0 = from.anchor;
                var c1 = pointsFinite(from.right) ? from.right : from.anchor;
                var c2 = pointsFinite(to.left) ? to.left : to.anchor;
                var p3 = to.anchor;
                // Exactly where the curve turns around, the same points the key
                // lines use, so the box can never clip the artwork it encloses.
                turningPoints(p0, c1, c2, p3, 0);
                turningPoints(p0, c1, c2, p3, 1);
                var straight = Math.abs(c1[0] - p0[0]) + Math.abs(c1[1] - p0[1]) + Math.abs(c2[0] - p3[0]) + Math.abs(c2[1] - p3[1]) < 1e-6;
                if (!straight) {
                    arcs.push([p0, c1, c2, p3]);
                }
            }
        }
        if (unreadable || !pointCount || !(maxX - minX > EPSILON || maxY - minY > EPSILON)) {
            errors.push({ field: "selection", message: "Select artwork made of paths. Convert text to outlines first." });
        }
        if (errors.length) {
            return failure(errors);
        }

        var size = Math.max(maxX - minX, maxY - minY);
        var tolerance = Math.max(0.25, size * 0.002);
        for (i = 0; i < paths.length; i++) {
            for (j = 0; j < paths[i].points.length; j++) {
                mergeValue(xs, paths[i].points[j].anchor[0], tolerance);
                mergeValue(ys, paths[i].points[j].anchor[1], tolerance);
            }
        }
        for (i = 0; i < arcs.length; i++) {
            var arc = arcs[i];
            var tx = axisExtrema(arc[0], arc[1], arc[2], arc[3], 0);
            var ty = axisExtrema(arc[0], arc[1], arc[2], arc[3], 1);
            for (j = 0; j < tx.length; j++) {
                mergeValue(xs, cubicPoint(arc[0], arc[1], arc[2], arc[3], tx[j])[0], tolerance);
            }
            for (j = 0; j < ty.length; j++) {
                mergeValue(ys, cubicPoint(arc[0], arc[1], arc[2], arc[3], ty[j])[1], tolerance);
            }
        }

        var a = board.box;
        var extentLeft = s.conExtend === "artboard" ? a.left : minX - s.conPadding;
        var extentRight = s.conExtend === "artboard" ? a.right : maxX + s.conPadding;
        var extentTop = s.conExtend === "artboard" ? a.top : maxY + s.conPadding;
        var extentBottom = s.conExtend === "artboard" ? a.bottom : minY - s.conPadding;

        var segments = [];
        var curves = [];
        if (s.conBounds) {
            segments.push(horizontal("bounds", maxY, minX, maxX));
            segments.push(horizontal("bounds", minY, minX, maxX));
            segments.push(vertical("bounds", minX, maxY, minY));
            segments.push(vertical("bounds", maxX, maxY, minY));
        }
        if (s.conKeylines) {
            for (i = 0; i < xs.length; i++) {
                segments.push(vertical("keyline", xs[i], extentTop, extentBottom));
            }
            for (i = 0; i < ys.length; i++) {
                segments.push(horizontal("keyline", ys[i], extentLeft, extentRight));
            }
        }
        if (s.conCenter) {
            segments.push(vertical("center", (minX + maxX) / 2, extentTop, extentBottom));
            segments.push(horizontal("center", (minY + maxY) / 2, extentLeft, extentRight));
        }
        if (s.conDiagonals) {
            segments.push(segment("diagonal", minX, maxY, maxX, minY));
            segments.push(segment("diagonal", minX, minY, maxX, maxY));
        }

        var circles = [];
        if (s.conCircles) {
            for (i = 0; i < arcs.length; i++) {
                var q = arcs[i];
                var fit = circleThrough(q[0], cubicPoint(q[0], q[1], q[2], q[3], 0.5), q[3]);
                if (!fit || fit.r < tolerance * 2 || fit.r > size * 5) {
                    continue;
                }
                var round1 = cubicPoint(q[0], q[1], q[2], q[3], 0.25);
                var round3 = cubicPoint(q[0], q[1], q[2], q[3], 0.75);
                var dev1 = Math.abs(Math.sqrt((round1[0] - fit.x) * (round1[0] - fit.x) + (round1[1] - fit.y) * (round1[1] - fit.y)) - fit.r);
                var dev3 = Math.abs(Math.sqrt((round3[0] - fit.x) * (round3[0] - fit.x) + (round3[1] - fit.y) * (round3[1] - fit.y)) - fit.r);
                if (dev1 > fit.r * 0.015 + 0.05 || dev3 > fit.r * 0.015 + 0.05) {
                    continue; // Not a circular arc.
                }
                var duplicate = false;
                for (j = 0; j < circles.length; j++) {
                    if (Math.abs(circles[j].x - fit.x) <= tolerance * 2 && Math.abs(circles[j].y - fit.y) <= tolerance * 2 && Math.abs(circles[j].r - fit.r) <= tolerance * 2) {
                        duplicate = true;
                        break;
                    }
                }
                if (!duplicate) {
                    circles.push(fit);
                }
            }
            for (i = 0; i < circles.length; i++) {
                curves.push(circle("circle", circles[i].x, circles[i].y, circles[i].r));
            }
        }

        s.type = "construction";
        segments = dedupeSegments(segments);
        var shapeCount = segments.length + curves.length;
        if (shapeCount > LIMITS.maxShapes) {
            return failure([{ field: "selection", message: "That artwork needs " + shapeCount + " construction lines. Select fewer or simpler paths." }]);
        }
        // Same last line of defence as a grid: no broken coordinates go out.
        if (!allFinite({ segments: segments, boxes: [], polygons: [], curves: curves, dots: [] })) {
            return failure([brokenGeometry("selection")]);
        }
        return {
            ok: true,
            errors: [],
            settings: s,
            artboard: { left: round(a.left), top: round(a.top), right: round(a.right), bottom: round(a.bottom), width: round(a.width), height: round(a.height) },
            content: { left: round(minX), top: round(maxY), right: round(maxX), bottom: round(minY), width: round(maxX - minX), height: round(maxY - minY) },
            metrics: { keylines: s.conKeylines ? xs.length + ys.length : 0, circles: circles.length },
            tracks: { columns: [], rows: [] },
            segments: segments,
            boxes: [],
            polygons: [],
            curves: curves,
            dots: [],
            shapeCount: shapeCount
        };
    }

    /*
     * Dash pattern for a line style, scaled to the stroke width.
     * Returns { dashes: [dash, gap] or [], roundCaps }.
     */
    function dashPattern(style, strokeWidth) {
        if (style === "dashed") {
            return { dashes: [round(Math.max(2, strokeWidth * 4)), round(Math.max(1.5, strokeWidth * 3))], roundCaps: false };
        }
        if (style === "dotted") {
            // Zero-length dashes with round caps draw round dots.
            return { dashes: [0, round(Math.max(1.5, strokeWidth * 3))], roundCaps: true };
        }
        return { dashes: [], roundCaps: false };
    }

    // A deep copy: the caller gets its own blocks array, not the shared one.
    function copyDefaults() {
        return copyValue(DEFAULTS);
    }

    return {
        EPSILON: EPSILON,
        PHI: PHI,
        LIMITS: LIMITS,
        FIELD_NAMES: FIELD_NAMES,
        UNITS: ["pt", "px", "mm", "in"],
        SPIRAL_FOCI: ["top-left", "top-right", "bottom-left", "bottom-right"],
        PATTERNS: ["square", "dots", "isometric", "hexagon", "radial", "diagonal"],
        LINE_STYLES: ["solid", "dashed", "dotted"],
        COMPOSITION_FLAGS: COMPOSITION_FLAGS,
        CONSTRUCTION_FLAGS: CONSTRUCTION_FLAGS,
        defaults: copyDefaults,
        parseNumber: parseNumber,
        toPoints: toPoints,
        fromPoints: fromPoints,
        formatMeasure: formatMeasure,
        relevantFields: relevantFields,
        normalizeSettings: normalizeSettings,
        parseArtboardRange: parseArtboardRange,
        parseRatios: parseRatios,
        parseBlocks: parseBlocks,
        snapLines: snapLines,
        buildConstruction: buildConstruction,
        snapRect: snapRect,
        readRect: readRect,
        divideSpan: divideSpan,
        dedupeSegments: dedupeSegments,
        dashPattern: dashPattern,
        buildGrid: buildGrid
    };
}));
