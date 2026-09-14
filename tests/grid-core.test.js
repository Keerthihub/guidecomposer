"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../shared/grid-core.js");

// Illustrator 2026 reports a new US Letter artboard as [0, 792, 612, 0].
const LETTER = [0, 792, 612, 0];

function settings(overrides) {
    return Object.assign(
        {
            type: "columns",
            units: "pt",
            columns: 12,
            rows: 8,
            columnGutter: 12,
            rowGutter: 12,
            marginTop: 36,
            marginRight: 36,
            marginBottom: 36,
            marginLeft: 36,
            baselineSpacing: 12,
            baselineOffset: 0,
            extendToEdges: false,
            output: "lines",
            strokeColor: "#e0457b",
            strokeWidth: 0.5,
            opacity: 100,
            lockLayer: true
        },
        overrides
    );
}

function build(rect, overrides) {
    return core.buildGrid(rect, settings(overrides));
}

function ofKind(result, kind) {
    return result.segments.filter((s) => s.kind === kind);
}

function xs(segments) {
    return segments.map((s) => s.x1);
}

function ys(segments) {
    return segments.map((s) => s.y1);
}

function fieldsOf(result) {
    return result.errors.map((e) => e.field);
}

// ---------------------------------------------------------------- units

test("converts every supported unit to points", () => {
    assert.equal(core.toPoints(10, "pt"), 10);
    assert.equal(core.toPoints(10, "px"), 10);
    assert.equal(core.toPoints(1, "in"), 72);
    assert.equal(core.toPoints(25.4, "mm"), 72);
    assert.ok(Math.abs(core.toPoints(10, "mm") - 28.346456692913385) < 1e-12);
    assert.equal(core.fromPoints(72, "in"), 1);
    assert.equal(core.fromPoints(72, "mm"), 25.4);
    assert.throws(() => core.toPoints(1, "cm"), /Unknown unit/);
});

test("formats measurements in the user's unit", () => {
    assert.equal(core.formatMeasure(72, "in"), "1 in");
    assert.equal(core.formatMeasure(36, "mm"), "12.7 mm");
    assert.equal(core.formatMeasure(34, "pt"), "34 pt");
});

test("parses numbers strictly", () => {
    assert.equal(core.parseNumber("12"), 12);
    assert.equal(core.parseNumber(" 12.5 "), 12.5);
    assert.equal(core.parseNumber(".5"), 0.5);
    assert.equal(core.parseNumber("-3"), -3);
    assert.equal(core.parseNumber(7), 7);
    assert.ok(Number.isNaN(core.parseNumber("")));
    assert.ok(Number.isNaN(core.parseNumber("12pt")));
    assert.ok(Number.isNaN(core.parseNumber("abc")));
    assert.ok(Number.isNaN(core.parseNumber(null)));
    assert.ok(Number.isNaN(core.parseNumber(true)));
});

// -------------------------------------------------------------- columns

test("12-column grid on US Letter has exact edges", () => {
    const r = build(LETTER, {});
    assert.equal(r.ok, true);
    assert.equal(r.metrics.columnWidth, 34); // (540 - 11 * 12) / 12
    assert.deepEqual(r.content, { left: 36, top: 756, right: 576, bottom: 36, width: 540, height: 720 });

    const columns = ofKind(r, "column");
    assert.equal(columns.length, 24);
    assert.deepEqual(xs(columns), [
        36, 70, 82, 116, 128, 162, 174, 208, 220, 254, 266, 300,
        312, 346, 358, 392, 404, 438, 450, 484, 496, 530, 542, 576
    ]);
    // Column lines run from the top margin down to the bottom margin.
    assert.deepEqual(columns[0], { kind: "column", x1: 36, y1: 756, x2: 36, y2: 36 });

    assert.deepEqual(ofKind(r, "margin"), [
        { kind: "margin", x1: 36, y1: 756, x2: 576, y2: 756 },
        { kind: "margin", x1: 36, y1: 36, x2: 576, y2: 36 }
    ]);
    assert.equal(r.segments.length, 26);
});

test("one column produces only the content box", () => {
    const r = build(LETTER, { columns: 1, columnGutter: 99 });
    assert.equal(r.ok, true);
    assert.equal(r.metrics.columnWidth, 540);
    assert.deepEqual(xs(ofKind(r, "column")), [36, 576]);
    assert.equal(r.segments.length, 4);
});

test("zero gutter merges coincident column edges", () => {
    const r = build(LETTER, { columns: 3, columnGutter: 0 });
    assert.equal(r.ok, true);
    assert.deepEqual(xs(ofKind(r, "column")), [36, 216, 396, 576]);
});

test("fractional column widths are rounded to 1/10000 pt", () => {
    const r = build(LETTER, { columns: 7, columnGutter: 0, marginLeft: 0, marginRight: 0 });
    assert.equal(r.ok, true);
    assert.equal(r.metrics.columnWidth, 87.4286);
    assert.deepEqual(xs(ofKind(r, "column")), [0, 87.4286, 174.8571, 262.2857, 349.7143, 437.1429, 524.5714, 612]);
});

test("asymmetric margins on an artboard with negative Y coordinates", () => {
    // Second artboard placed below the first: left 100, top -800, 600 x 800.
    const rect = [100, -800, 700, -1600];
    const r = build(rect, {
        columns: 2,
        columnGutter: 30,
        marginTop: 10,
        marginRight: 50,
        marginBottom: 30,
        marginLeft: 20
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.content, { left: 120, top: -810, right: 650, bottom: -1570, width: 530, height: 760 });
    assert.equal(r.metrics.columnWidth, 250);
    assert.deepEqual(ofKind(r, "column"), [
        { kind: "column", x1: 120, y1: -810, x2: 120, y2: -1570 },
        { kind: "column", x1: 370, y1: -810, x2: 370, y2: -1570 },
        { kind: "column", x1: 400, y1: -810, x2: 400, y2: -1570 },
        { kind: "column", x1: 650, y1: -810, x2: 650, y2: -1570 }
    ]);
    assert.deepEqual(ofKind(r, "margin"), [
        { kind: "margin", x1: 120, y1: -810, x2: 650, y2: -810 },
        { kind: "margin", x1: 120, y1: -1570, x2: 650, y2: -1570 }
    ]);
});

test("extend to edges runs lines across the whole artboard", () => {
    const r = build(LETTER, { columns: 2, columnGutter: 0, extendToEdges: true });
    assert.equal(r.ok, true);
    assert.deepEqual(ofKind(r, "column")[0], { kind: "column", x1: 36, y1: 792, x2: 36, y2: 0 });
    assert.deepEqual(ofKind(r, "margin")[0], { kind: "margin", x1: 0, y1: 756, x2: 612, y2: 756 });
});

test("inch settings match the same grid in points", () => {
    const inches = build(LETTER, {
        units: "in",
        columnGutter: 1 / 6,
        marginTop: 0.5,
        marginRight: 0.5,
        marginBottom: 0.5,
        marginLeft: 0.5
    });
    const points = build(LETTER, {});
    assert.equal(inches.ok, true);
    assert.deepEqual(inches.segments, points.segments);
});

test("millimetre margins on an A4 artboard", () => {
    const a4 = [0, 841.8898, 595.2756, 0];
    const r = build(a4, {
        units: "mm",
        columns: 2,
        columnGutter: 5,
        marginTop: 20,
        marginRight: 15,
        marginBottom: 20,
        marginLeft: 15
    });
    assert.equal(r.ok, true);
    // 15 mm = 42.5197 pt; 5 mm gutter = 14.1732 pt.
    assert.deepEqual(xs(ofKind(r, "column")), [42.5197, 290.5512, 304.7244, 552.7559]);
    assert.deepEqual(ys(ofKind(r, "margin")), [785.1969, 56.6929]);
});

// -------------------------------------------------------------- modular

test("modular grid produces column and row edges measured downward", () => {
    const rect = [0, 0, 400, -300];
    const r = build(rect, {
        type: "modular",
        columns: 2,
        columnGutter: 0,
        rows: 3,
        rowGutter: 15,
        marginTop: 0,
        marginRight: 0,
        marginBottom: 0,
        marginLeft: 0
    });
    assert.equal(r.ok, true);
    assert.equal(r.metrics.rowHeight, 90); // (300 - 2 * 15) / 3
    assert.deepEqual(xs(ofKind(r, "column")), [0, 200, 400]);
    assert.deepEqual(ofKind(r, "row"), [
        { kind: "row", x1: 0, y1: 0, x2: 400, y2: 0 },
        { kind: "row", x1: 0, y1: -90, x2: 400, y2: -90 },
        { kind: "row", x1: 0, y1: -105, x2: 400, y2: -105 },
        { kind: "row", x1: 0, y1: -195, x2: 400, y2: -195 },
        { kind: "row", x1: 0, y1: -210, x2: 400, y2: -210 },
        { kind: "row", x1: 0, y1: -300, x2: 400, y2: -300 }
    ]);
    assert.equal(ofKind(r, "margin").length, 0);
    assert.deepEqual(r.tracks, {
        columns: [{ left: 0, right: 200 }, { left: 200, right: 400 }],
        rows: [{ top: 0, bottom: -90 }, { top: -105, bottom: -195 }, { top: -210, bottom: -300 }]
    });
});

test("modular grid on US Letter with margins", () => {
    const r = build(LETTER, { type: "modular", columns: 6, rows: 8, rowGutter: 12 });
    assert.equal(r.ok, true);
    assert.equal(r.metrics.columnWidth, 80); // (540 - 5 * 12) / 6
    assert.equal(r.metrics.rowHeight, 79.5); // (720 - 7 * 12) / 8
    assert.equal(ofKind(r, "column").length, 12);
    assert.equal(ofKind(r, "row").length, 16);
    const rows = ys(ofKind(r, "row"));
    assert.equal(rows[0], 756);
    assert.equal(rows[1], 676.5);
    assert.equal(rows[rows.length - 1], 36);
});

// ------------------------------------------------------------- baseline

test("baseline grid fills the content area including the last line", () => {
    const r = build(LETTER, { type: "baseline" });
    assert.equal(r.ok, true);
    assert.equal(r.metrics.baselineCount, 61);
    const lines = ofKind(r, "baseline");
    assert.equal(lines.length, 61);
    assert.deepEqual(lines[0], { kind: "baseline", x1: 36, y1: 756, x2: 576, y2: 756 });
    assert.equal(lines[60].y1, 36);
});

test("baseline offset shifts the first baseline down", () => {
    const r = build(LETTER, { type: "baseline", baselineOffset: 6 });
    assert.equal(r.ok, true);
    assert.equal(r.metrics.baselineCount, 60);
    const lines = ys(ofKind(r, "baseline"));
    assert.equal(lines[0], 750);
    assert.equal(lines[59], 42);
});

test("baseline count tolerates floating-point spacing", () => {
    // 1 / 0.1 is 9.999999999999998 in floating point; the bottom line must survive.
    const r = build([0, 1, 100, 0], {
        type: "baseline",
        baselineSpacing: 0.1,
        marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0
    });
    assert.equal(r.ok, true);
    assert.equal(r.metrics.baselineCount, 11);
    assert.equal(ofKind(r, "baseline")[10].y1, 0);
});

test("baseline offset equal to the content height leaves one line on the bottom margin", () => {
    const r = build(LETTER, { type: "baseline", baselineOffset: 720 });
    assert.equal(r.ok, true);
    assert.deepEqual(ys(ofKind(r, "baseline")), [36]);
});

// ----------------------------------------------------- invalid settings

test("gutters wider than the available space are rejected", () => {
    const r = build(LETTER, { columns: 12, columnGutter: 50 });
    assert.equal(r.ok, false);
    assert.deepEqual(fieldsOf(r), ["columnGutter"]);
    assert.match(r.errors[0].message, /Columns don't fit/);
    assert.equal(r.segments.length, 0);
});

test("gutters that leave exactly zero column width are rejected", () => {
    // 540 pt split by 2 columns with a 540 pt gutter leaves 0 pt per column.
    const r = build(LETTER, { columns: 2, columnGutter: 540 });
    assert.equal(r.ok, false);
    assert.deepEqual(fieldsOf(r), ["columnGutter"]);
});

test("row gutters wider than the available space are rejected", () => {
    const r = build(LETTER, { type: "modular", rows: 10, rowGutter: 90 });
    assert.equal(r.ok, false);
    assert.deepEqual(fieldsOf(r), ["rowGutter"]);
});

test("margins that consume the artboard are rejected with the artboard size", () => {
    const wide = build(LETTER, { marginLeft: 300, marginRight: 312 });
    assert.equal(wide.ok, false);
    assert.deepEqual(fieldsOf(wide), ["marginLeft"]);
    assert.match(wide.errors[0].message, /612 pt/);

    const tall = build(LETTER, { units: "in", marginTop: 6, marginBottom: 6, marginLeft: 0.5, marginRight: 0.5 });
    assert.equal(tall.ok, false);
    assert.deepEqual(fieldsOf(tall), ["marginTop"]);
    assert.match(tall.errors[0].message, /11 in/);
});

test("zero, negative, fractional, and non-numeric counts are rejected", () => {
    for (const bad of [0, -1, 1.5, 101, "abc", "", "12pt"]) {
        const r = build(LETTER, { columns: bad });
        assert.equal(r.ok, false, `columns=${JSON.stringify(bad)} should fail`);
        assert.deepEqual(fieldsOf(r), ["columns"]);
    }
    assert.equal(build(LETTER, { columns: "4" }).ok, true);
    assert.equal(build(LETTER, { columns: 100, columnGutter: 0 }).ok, true);
});

test("negative margins and gutters are rejected; zero is allowed", () => {
    const r = build(LETTER, { marginTop: -1, columnGutter: -2 });
    assert.equal(r.ok, false);
    assert.deepEqual(fieldsOf(r).sort(), ["columnGutter", "marginTop"]);
    assert.equal(build(LETTER, { marginTop: 0, columnGutter: 0 }).ok, true);
});

test("baseline spacing and offset are validated", () => {
    assert.deepEqual(fieldsOf(build(LETTER, { type: "baseline", baselineSpacing: 0 })), ["baselineSpacing"]);
    assert.deepEqual(fieldsOf(build(LETTER, { type: "baseline", baselineOffset: -1 })), ["baselineOffset"]);
    const deep = build(LETTER, { type: "baseline", baselineOffset: 721 });
    assert.deepEqual(fieldsOf(deep), ["baselineOffset"]);
    const dense = build(LETTER, { type: "baseline", baselineSpacing: 0.5 });
    assert.deepEqual(fieldsOf(dense), ["baselineSpacing"]);
    assert.match(dense.errors[0].message, /1441 baselines/);
});

test("only fields used by the chosen grid type are validated", () => {
    const r = build(LETTER, { type: "baseline", columns: "abc", rowGutter: -5 });
    assert.equal(r.ok, true);
});

test("type, units, output, and style are validated", () => {
    assert.deepEqual(fieldsOf(build(LETTER, { type: "diagonal" })), ["type"]);
    assert.deepEqual(fieldsOf(build(LETTER, { units: "cm" })), ["units"]);
    assert.deepEqual(fieldsOf(build(LETTER, { output: "shapes" })), ["output"]);
    assert.deepEqual(fieldsOf(build(LETTER, { strokeColor: "red" })), ["strokeColor"]);
    assert.deepEqual(fieldsOf(build(LETTER, { strokeWidth: 0 })), ["strokeWidth"]);
    assert.deepEqual(fieldsOf(build(LETTER, { opacity: 101 })), ["opacity"]);
});

test("stroke settings are ignored when the output is guides", () => {
    const r = build(LETTER, { output: "guides", strokeWidth: 0, strokeColor: "nope", opacity: -4 });
    assert.equal(r.ok, true);
    assert.equal(r.settings.output, "guides");
});

test("normalized style is uppercase hex and lengths are in points", () => {
    const r = core.normalizeSettings(settings({ units: "in", marginLeft: 1, strokeColor: "#abcdef" }));
    assert.equal(r.ok, true);
    assert.equal(r.settings.marginLeft, 72);
    assert.equal(r.settings.strokeColor, "#ABCDEF");
    assert.equal(r.settings.lockLayer, true);
});

test("missing settings fall back to defaults", () => {
    const r = core.buildGrid(LETTER, {});
    assert.equal(r.ok, true);
    assert.equal(r.settings.type, "columns");
    assert.equal(r.segments.length, 26);
    assert.equal(core.buildGrid(LETTER, null).ok, true);
});

// ------------------------------------------------------------- artboard

test("invalid artboard rectangles are rejected", () => {
    const flipped = core.buildGrid([0, 0, 612, 792], settings({}));
    assert.equal(flipped.ok, false);
    assert.deepEqual(fieldsOf(flipped), ["artboard"]);

    assert.equal(core.buildGrid([0, 792, 612], settings({})).ok, false);
    assert.equal(core.buildGrid([0, 792, "612", 0], settings({})).ok, false);
    assert.equal(core.buildGrid(null, settings({})).ok, false);
    assert.equal(core.buildGrid([10, 10, 10, 0], settings({})).ok, false);
});

test("very small artboards still produce a valid grid", () => {
    const r = build([0, 1, 1, 0], {
        columns: 2, columnGutter: 0.1,
        marginTop: 0.1, marginRight: 0.1, marginBottom: 0.1, marginLeft: 0.1
    });
    assert.equal(r.ok, true);
    assert.equal(r.metrics.columnWidth, 0.35);
    assert.deepEqual(xs(ofKind(r, "column")), [0.1, 0.45, 0.55, 0.9]);
});

// --------------------------------------------------------------- helpers

test("dedupeSegments removes duplicates in either direction", () => {
    const out = core.dedupeSegments([
        { kind: "a", x1: 0, y1: 0, x2: 10, y2: 0 },
        { kind: "b", x1: 10, y1: 0, x2: 0, y2: 0 },
        { kind: "c", x1: 0.00001, y1: 0, x2: 10, y2: 0 },
        { kind: "d", x1: 0, y1: 1, x2: 10, y2: 1 }
    ]);
    assert.deepEqual(out.map((s) => s.kind), ["a", "d"]);
});

test("no output coordinate is negative zero", () => {
    const r = build([-36, 36, 576, -756], { type: "modular" });
    assert.equal(r.ok, true);
    for (const s of r.segments) {
        for (const v of [s.x1, s.y1, s.x2, s.y2]) {
            assert.ok(!Object.is(v, -0), "found -0");
        }
    }
});

test("missing length fields use point defaults converted to the chosen unit", () => {
    const r = core.buildGrid(LETTER, { units: "in", columns: 12 });
    assert.equal(r.ok, true);
    assert.equal(r.settings.marginLeft, 36);
    assert.equal(r.settings.columnGutter, 12);
    assert.deepEqual(r.segments, core.buildGrid(LETTER, {}).segments);
});

test("defaults() returns an independent copy", () => {
    const a = core.defaults();
    a.columns = 99;
    assert.equal(core.defaults().columns, 12);
});

// ---------------------------------------------------------- composition

const NO_MARGINS = { marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0 };
const COMP_OFF = { compThirds: false, compGolden: false, compDiagonals: false, compCenter: false, compSpiral: false };

function composition(rect, overrides) {
    return build(rect, Object.assign({ type: "composition" }, COMP_OFF, overrides));
}

test("composition always includes the frame of the content area", () => {
    const r = composition([0, 300, 600, 0], { compCenter: true });
    assert.equal(r.ok, true);
    assert.deepEqual(ofKind(r, "margin"), [
        { kind: "margin", x1: 36, y1: 264, x2: 564, y2: 264 },
        { kind: "margin", x1: 36, y1: 36, x2: 564, y2: 36 },
        { kind: "margin", x1: 36, y1: 264, x2: 36, y2: 36 },
        { kind: "margin", x1: 564, y1: 264, x2: 564, y2: 36 }
    ]);
    assert.deepEqual(ofKind(r, "center"), [
        { kind: "center", x1: 300, y1: 264, x2: 300, y2: 36 },
        { kind: "center", x1: 36, y1: 150, x2: 564, y2: 150 }
    ]);
});

test("rule of thirds divides the content area into thirds", () => {
    const r = composition([0, 300, 600, 0], Object.assign({ compThirds: true }, NO_MARGINS));
    assert.equal(r.ok, true);
    assert.deepEqual(ofKind(r, "thirds"), [
        { kind: "thirds", x1: 200, y1: 300, x2: 200, y2: 0 },
        { kind: "thirds", x1: 0, y1: 200, x2: 600, y2: 200 },
        { kind: "thirds", x1: 400, y1: 300, x2: 400, y2: 0 },
        { kind: "thirds", x1: 0, y1: 100, x2: 600, y2: 100 }
    ]);
});

test("golden sections sit at 0.382 and 0.618 of each side", () => {
    const r = composition([0, 1000, 1000, 0], Object.assign({ compGolden: true }, NO_MARGINS));
    assert.equal(r.ok, true);
    assert.deepEqual(ofKind(r, "golden").map((s) => [s.x1, s.y1, s.x2, s.y2]), [
        [381.966, 1000, 381.966, 0],
        [618.034, 1000, 618.034, 0],
        [0, 618.034, 1000, 618.034],
        [0, 381.966, 1000, 381.966]
    ]);
});

test("diagonals run corner to corner, even with negative coordinates", () => {
    const r = composition([100, -800, 700, -1600], Object.assign({ compDiagonals: true }, NO_MARGINS));
    assert.equal(r.ok, true);
    assert.deepEqual(ofKind(r, "diagonal"), [
        { kind: "diagonal", x1: 100, y1: -800, x2: 700, y2: -1600 },
        { kind: "diagonal", x1: 100, y1: -1600, x2: 700, y2: -800 }
    ]);
});

test("composition needs at least one guide, and boxes are not allowed", () => {
    assert.deepEqual(fieldsOf(composition(LETTER, {})), ["composition"]);
    assert.deepEqual(fieldsOf(composition(LETTER, { compThirds: true, output: "boxes" })), ["output"]);
    assert.deepEqual(fieldsOf(build(LETTER, { type: "baseline", output: "boxes" })), ["output"]);
    assert.deepEqual(fieldsOf(composition(LETTER, { compSpiral: true, spiralFocus: "middle" })), ["spiralFocus"]);
});

test("golden spiral in a golden rectangle has exact quarter-circle arcs", () => {
    const r = composition([0, 100, 161.8034, 0], Object.assign({ compSpiral: true, spiralFocus: "bottom-right" }, NO_MARGINS));
    assert.equal(r.ok, true);
    assert.equal(r.curves.length, 1);
    const points = r.curves[0].points;
    assert.equal(points.length, core.LIMITS.spiralSquares + 1);
    // First arc: centre (100, 0), radius 100, from the bottom-left corner to the top edge.
    assert.deepEqual(points[0], { anchor: [0, 0], left: [0, 0], right: [0, 55.2285] });
    assert.deepEqual(points[1], { anchor: [100, 100], left: [44.7715, 100], right: [134.1331, 100] });
    // Second arc: centre (100, 38.1966), radius 61.8034.
    assert.deepEqual(points[2].anchor, [161.8034, 38.1966]);
    // The first square's edge is the golden section line x = 100.
    assert.deepEqual(ofKind(r, "spiral")[0], { kind: "spiral", x1: 100, y1: 100, x2: 100, y2: 0 });
});

test("spiral focus lands in the requested quadrant for landscape and portrait areas", () => {
    for (const rect of [[0, 400, 900, 0], [0, 900, 400, 0], [50, -20, 650, -620]]) {
        for (const focus of core.SPIRAL_FOCI) {
            const r = composition(rect, Object.assign({ compSpiral: true, spiralFocus: focus }, NO_MARGINS));
            assert.equal(r.ok, true);
            const pts = r.curves[0].points;
            const eye = pts[pts.length - 1].anchor;
            const [left, top, right, bottom] = rect;
            const inLeft = eye[0] < (left + right) / 2;
            const inTop = eye[1] > (top + bottom) / 2;
            assert.equal(inLeft, focus.endsWith("left"), `${focus} x in ${rect}`);
            assert.equal(inTop, focus.startsWith("top"), `${focus} y in ${rect}`);
            for (const p of pts) {
                for (const v of [p.anchor, p.left, p.right]) {
                    assert.ok(v[0] >= left - 1e-3 && v[0] <= right + 1e-3 && v[1] <= top + 1e-3 && v[1] >= bottom - 1e-3, "spiral stays inside the area");
                }
            }
        }
    }
});

test("spiral anchors are smooth: handles are collinear through each anchor", () => {
    const r = composition([0, 500, 800, 0], Object.assign({ compSpiral: true, spiralFocus: "top-left" }, NO_MARGINS));
    const pts = r.curves[0].points;
    for (let i = 1; i < pts.length - 1; i++) {
        // Smooth point: incoming and outgoing handles are collinear with the anchor.
        const [ax, ay] = pts[i].anchor;
        const cross = (pts[i].left[0] - ax) * (pts[i].right[1] - ay) - (pts[i].left[1] - ay) * (pts[i].right[0] - ax);
        assert.ok(Math.abs(cross) < 0.05, `point ${i} is smooth (cross ${cross})`);
    }
});

test("spiral squares that coincide with golden sections are not drawn twice", () => {
    const r = composition([0, 100, 161.8034, 0], Object.assign({ compSpiral: true, compGolden: true, spiralFocus: "bottom-right" }, NO_MARGINS));
    const at100 = r.segments.filter((s) => s.x1 === s.x2 && Math.abs(s.x1 - 100) < 0.01);
    assert.equal(at100.length, 1);
});

// ---------------------------------------------------------------- boxes

test("column boxes span the content height, or the artboard when extended", () => {
    const r = build(LETTER, { columns: 3, columnGutter: 12, output: "boxes" });
    assert.equal(r.ok, true);
    assert.equal(r.segments.length, 0);
    assert.deepEqual(r.boxes, [
        { kind: "column", left: 36, top: 756, right: 208, bottom: 36 },
        { kind: "column", left: 220, top: 756, right: 392, bottom: 36 },
        { kind: "column", left: 404, top: 756, right: 576, bottom: 36 }
    ]);
    const extended = build(LETTER, { columns: 1, output: "boxes", extendToEdges: true });
    assert.deepEqual(extended.boxes, [{ kind: "column", left: 36, top: 792, right: 576, bottom: 0 }]);
});

test("modular boxes are one rectangle per module, row by row", () => {
    const r = build([0, 0, 400, -300], Object.assign({ type: "modular", columns: 2, columnGutter: 0, rows: 3, rowGutter: 15, output: "boxes" }, NO_MARGINS));
    assert.equal(r.ok, true);
    assert.equal(r.shapeCount, 6);
    assert.deepEqual(r.boxes.slice(0, 3), [
        { kind: "module", left: 0, top: 0, right: 200, bottom: -90 },
        { kind: "module", left: 200, top: 0, right: 400, bottom: -90 },
        { kind: "module", left: 0, top: -105, right: 200, bottom: -195 }
    ]);
});

test("box counts above the shape limit are rejected", () => {
    const r = build(LETTER, { type: "modular", columns: 100, rows: 100, columnGutter: 0, rowGutter: 0, output: "boxes" });
    assert.equal(r.ok, false);
    assert.deepEqual(fieldsOf(r), ["columns"]);
    assert.match(r.errors[0].message, /10000 boxes/);
    assert.equal(build(LETTER, { type: "modular", columns: 50, rows: 50, columnGutter: 0, rowGutter: 0, output: "boxes" }).ok, true);
});

test("boxes use stroke settings", () => {
    assert.deepEqual(fieldsOf(build(LETTER, { output: "boxes", strokeWidth: 0 })), ["strokeWidth"]);
});

// --------------------------------------------------------- artboard ranges

test("parses artboard ranges like Illustrator's dialogs", () => {
    assert.deepEqual(core.parseArtboardRange("1-3, 5", 6), { ok: true, indices: [0, 1, 2, 4] });
    assert.deepEqual(core.parseArtboardRange(" 5 , 2-1 ,2 ", 6), { ok: true, indices: [0, 1, 4] });
    assert.deepEqual(core.parseArtboardRange("4", 4), { ok: true, indices: [3] });
    assert.deepEqual(core.parseArtboardRange("1,,2,", 2), { ok: true, indices: [0, 1] });
});

test("rejects empty, malformed, zero, and out-of-range artboard lists", () => {
    assert.match(core.parseArtboardRange("", 3).error, /Enter artboard numbers/);
    assert.match(core.parseArtboardRange(" , ", 3).error, /Enter artboard numbers/);
    assert.match(core.parseArtboardRange("1-", 3).error, /isn't an artboard number/);
    assert.match(core.parseArtboardRange("a", 3).error, /isn't an artboard number/);
    assert.match(core.parseArtboardRange("0-2", 3).error, /start at 1/);
    assert.match(core.parseArtboardRange("2-9", 3).error, /Artboard 9 doesn't exist. This document has 3 artboards/);
    assert.match(core.parseArtboardRange("2", 1).error, /has 1 artboard\./);
    assert.equal(core.parseArtboardRange(null, 3).ok, false);
});

// ---------------------------------------------------------------- patterns

function pattern(rect, overrides) {
    return build(rect, Object.assign({ type: "pattern" }, NO_MARGINS, overrides));
}

function segmentSet(segments) {
    return segments.map((s) => {
        const a = [s.x1, s.y1];
        const b = [s.x2, s.y2];
        return (a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? [a, b] : [b, a]).flat().join(",");
    }).sort();
}

test("square pattern: frame plus interior lines every cell", () => {
    const r = pattern([0, 100, 100, 0], { pattern: "square", patternSize: 25 });
    assert.equal(r.ok, true);
    assert.equal(r.segments.length, 10);
    assert.deepEqual(xs(ofKind(r, "pattern").filter((s) => s.x1 === s.x2)).sort((a, b) => a - b), [25, 50, 75]);
    assert.deepEqual(ys(ofKind(r, "pattern").filter((s) => s.y1 === s.y2)).sort((a, b) => a - b), [25, 50, 75]);
    assert.equal(r.metrics.cellSize, 25);
});

test("diagonal pattern: 45 and 135 degree lines clipped to the area", () => {
    const r = pattern([0, 100, 100, 0], { pattern: "diagonal", patternSize: 50 });
    assert.equal(r.ok, true);
    assert.deepEqual(segmentSet(ofKind(r, "pattern")), segmentSet([
        { x1: 0, y1: 50, x2: 50, y2: 100 }, { x1: 0, y1: 0, x2: 100, y2: 100 }, { x1: 50, y1: 0, x2: 100, y2: 50 },
        { x1: 0, y1: 50, x2: 50, y2: 0 }, { x1: 0, y1: 100, x2: 100, y2: 0 }, { x1: 50, y1: 100, x2: 100, y2: 50 }
    ]));
});

test("isometric pattern: verticals and 30 degree lines share one triangle lattice", () => {
    const r = pattern([0, 100, 173.2051, 0], { pattern: "isometric", patternSize: 24 });
    assert.equal(r.ok, true);
    const lines = ofKind(r, "pattern");
    const verticals = lines.filter((s) => s.x1 === s.x2).map((s) => s.x1).sort((a, b) => a - b);
    assert.deepEqual(verticals.slice(0, 3), [20.7846, 41.5692, 62.3538]); // 24 * sqrt(3) / 2 apart
    for (const s of lines.filter((l) => l.x1 !== l.x2)) {
        const slope = (s.y2 - s.y1) / (s.x2 - s.x1);
        assert.ok(Math.abs(Math.abs(slope) - Math.tan(Math.PI / 6)) < 1e-3, `slope ${slope}`);
    }
    // The line from the top-left corner reaches the bottom-right corner of a 100 x 100*sqrt(3) area.
    assert.ok(segmentSet(lines).includes(segmentSet([{ x1: 0, y1: 100, x2: 173.2051, y2: 0 }])[0]));
});

test("dot pattern: one dot per intersection, including the edges", () => {
    const r = pattern([0, 50, 50, 0], { pattern: "dots", patternSize: 25, dotSize: 3 });
    assert.equal(r.ok, true);
    assert.equal(r.segments.length, 0, "no frame for dots");
    assert.equal(r.dots.length, 9);
    assert.deepEqual(r.dots[0], { kind: "dot", x: 0, y: 50, d: 3 });
    assert.deepEqual(r.dots[8], { kind: "dot", x: 50, y: 0, d: 3 });
    assert.equal(r.metrics.dotCount, 9);
});

test("dot pattern limits and rules", () => {
    const dense = build(LETTER, { type: "pattern", pattern: "dots", patternSize: 1 });
    assert.deepEqual(fieldsOf(dense), ["patternSize"]);
    assert.match(dense.errors[0].message, /dots/);
    assert.deepEqual(fieldsOf(pattern(LETTER, { pattern: "dots", output: "guides" })), ["output"]);
    assert.deepEqual(fieldsOf(pattern(LETTER, { pattern: "dots", dotSize: 0 })), ["dotSize"]);
    assert.deepEqual(fieldsOf(pattern(LETTER, { pattern: "square", patternSize: 0 })), ["patternSize"]);
    assert.deepEqual(fieldsOf(pattern(LETTER, { pattern: "weave" })), ["pattern"]);
});

test("hexagon pattern: whole pointy-top hexagons centered in the area", () => {
    const r = pattern([0, 100, 100, 0], { pattern: "hexagon", patternSize: 10 });
    assert.equal(r.ok, true);
    assert.equal(r.polygons.length, 30); // 6 rows of 5
    assert.equal(r.metrics.hexagonCount, 30);
    assert.deepEqual(r.polygons[0].points[0], [11.0289, 97.5]);
    for (const hex of r.polygons) {
        assert.equal(hex.points.length, 6);
        for (const [x, y] of hex.points) {
            assert.ok(x >= -1e-3 && x <= 100.001 && y >= -1e-3 && y <= 100.001, "hexagon inside the area");
        }
    }
    const big = pattern([0, 100, 100, 0], { pattern: "hexagon", patternSize: 60 });
    assert.deepEqual(fieldsOf(big), ["patternSize"]);
    assert.match(big.errors[0].message, /don't fit/);
});

test("radial pattern: evenly spaced rings and spokes from the center", () => {
    const r = pattern([0, 200, 200, 0], { pattern: "radial", rings: 2, spokes: 4 });
    assert.equal(r.ok, true);
    assert.equal(r.curves.length, 2);
    assert.equal(r.curves[0].closed, true);
    assert.deepEqual(r.curves[0].points[0], { anchor: [100, 150], left: [72.3858, 150], right: [127.6142, 150] });
    assert.deepEqual(r.curves[1].points[1].anchor, [200, 100]);
    assert.deepEqual(segmentSet(ofKind(r, "spoke")), segmentSet([
        { x1: 100, y1: 100, x2: 100, y2: 200 }, { x1: 100, y1: 100, x2: 200, y2: 100 },
        { x1: 100, y1: 100, x2: 100, y2: 0 }, { x1: 100, y1: 100, x2: 0, y2: 100 }
    ]));
    assert.equal(r.metrics.ringSpacing, 50);
    assert.equal(pattern(LETTER, { pattern: "radial", spokes: 0 }).ok, true);
    assert.deepEqual(fieldsOf(pattern(LETTER, { pattern: "radial", rings: 0, spokes: 73 })).sort(), ["rings", "spokes"]);
});

test("patterns can be guides but not boxes", () => {
    assert.equal(pattern(LETTER, { pattern: "isometric", output: "guides" }).ok, true);
    assert.deepEqual(fieldsOf(pattern(LETTER, { pattern: "square", output: "boxes" })), ["output"]);
});

// ------------------------------------------------------------ line styles

test("dash patterns scale with stroke width", () => {
    assert.deepEqual(core.dashPattern("solid", 1), { dashes: [], roundCaps: false });
    assert.deepEqual(core.dashPattern("dashed", 0.5), { dashes: [2, 1.5], roundCaps: false });
    assert.deepEqual(core.dashPattern("dashed", 2), { dashes: [8, 6], roundCaps: false });
    assert.deepEqual(core.dashPattern("dotted", 2), { dashes: [0, 6], roundCaps: true });
});

test("line style, margin color, and gutter settings are validated", () => {
    assert.deepEqual(fieldsOf(build(LETTER, { lineStyle: "wavy" })), ["lineStyle"]);
    assert.equal(build(LETTER, { marginColor: "nope" }).ok, true, "margin color ignored while off");
    assert.deepEqual(fieldsOf(build(LETTER, { marginColorOn: true, marginColor: "nope" })), ["marginColor"]);
    assert.deepEqual(fieldsOf(build(LETTER, { shadeGutters: true, gutterOpacity: 150 })), ["gutterOpacity"]);
    assert.deepEqual(fieldsOf(build(LETTER, { shadeGutters: true, gutterColor: "#12" })), ["gutterColor"]);
    const guides = build(LETTER, { output: "guides", lineStyle: "wavy", shadeGutters: true, marginColorOn: true, marginColor: "x" });
    assert.equal(guides.ok, true, "styling is ignored for guides");
    assert.equal(guides.boxes.length, 0);
});

test("shaded gutters: column gutters full height, row gutters split around them", () => {
    const r = build(LETTER, { type: "modular", columns: 3, rows: 2, shadeGutters: true, gutterColor: "#00ff00", gutterOpacity: 20 });
    assert.equal(r.ok, true);
    assert.deepEqual(r.boxes, [
        { kind: "gutter", left: 208, top: 756, right: 220, bottom: 36 },
        { kind: "gutter", left: 392, top: 756, right: 404, bottom: 36 },
        { kind: "gutter", left: 36, top: 402, right: 208, bottom: 390 },
        { kind: "gutter", left: 220, top: 402, right: 392, bottom: 390 },
        { kind: "gutter", left: 404, top: 402, right: 576, bottom: 390 }
    ]);
    assert.equal(r.settings.gutterColor, "#00FF00");
    assert.equal(r.settings.gutterOpacity, 20);
    const noGutters = build(LETTER, { columns: 3, columnGutter: 0, shadeGutters: true });
    assert.equal(noGutters.boxes.length, 0, "zero-width gutters draw nothing");
    assert.equal(build(LETTER, { type: "baseline", shadeGutters: true }).boxes.length, 0);
});

test("shaded gutters combine with boxes output", () => {
    const r = build(LETTER, { columns: 2, output: "boxes", shadeGutters: true });
    assert.deepEqual(r.boxes.map((b) => b.kind), ["gutter", "column", "column"]);
    assert.equal(r.shapeCount, 3);
});

// ------------------------------------------------------ baseline inside grids

test("column grids can include a baseline grid", () => {
    const r = build(LETTER, { addBaseline: true, baselineSpacing: 12, baselineOffset: 0 });
    assert.equal(r.ok, true);
    assert.equal(ofKind(r, "column").length, 24);
    assert.equal(r.metrics.baselineCount, 61);
    // The top and bottom baselines coincide with the margin lines, which are kept once, as margins.
    assert.equal(ofKind(r, "margin").length, 2);
    assert.equal(ofKind(r, "baseline").length, 59);
    assert.equal(r.segments.length, 24 + 2 + 59);
});

test("modular grids can include a baseline grid, validated like a baseline grid", () => {
    const r = build(LETTER, { type: "modular", columns: 6, rows: 8, addBaseline: true, baselineSpacing: 18, baselineOffset: 6 });
    assert.equal(r.ok, true);
    assert.equal(ofKind(r, "baseline")[0].y1, 750);
    assert.deepEqual(fieldsOf(build(LETTER, { addBaseline: true, baselineSpacing: 0 })), ["baselineSpacing"]);
    assert.equal(build(LETTER, { addBaseline: false, baselineSpacing: 0 }).ok, true, "baseline fields ignored when off");
});

// ---------------------------------------------------------- unequal columns

test("column ratios divide the space by proportion and set the column count", () => {
    const r = build(LETTER, { columns: 12, columnRatios: "2 1 1", columnGutter: 12, marginLeft: 36, marginRight: 36 });
    assert.equal(r.ok, true);
    // 540 - 2 gutters = 516 pt shared 2:1:1 -> 258, 129, 129
    assert.deepEqual(r.metrics.columnWidths, [258, 129, 129]);
    assert.equal(r.metrics.columnWidth, null);
    assert.deepEqual(xs(ofKind(r, "column")), [36, 294, 306, 435, 447, 576]);
    assert.equal(r.settings.columns, 3);
});

test("ratios accept colons, commas, and arrays; empty means equal", () => {
    assert.deepEqual(core.parseRatios("2:1:1", "Widths"), { ok: true, values: [2, 1, 1] });
    assert.deepEqual(core.parseRatios("1, 1, 2, 3, 5", "Widths"), { ok: true, values: [1, 1, 2, 3, 5] });
    assert.deepEqual(core.parseRatios([1.5, 1], "Widths"), { ok: true, values: [1.5, 1] });
    assert.deepEqual(core.parseRatios("  ", "Widths"), { ok: true, values: null });
    assert.equal(core.parseRatios("2 x 1", "Widths").ok, false);
    assert.equal(core.parseRatios("2 0 1", "Widths").ok, false);
    assert.deepEqual(fieldsOf(build(LETTER, { columnRatios: "a b" })), ["columnRatios"]);
    assert.equal(build(LETTER, { columns: 0, columnRatios: "1 1" }).ok, true, "column count comes from the ratios");
});

test("row ratios shape modular rows", () => {
    const r = build([0, 300, 400, 0], {
        type: "modular", columns: 2, columnGutter: 0, rows: 5, rowRatios: "1 2", rowGutter: 0,
        marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.metrics.rowHeights, [100, 200]);
    assert.deepEqual(r.tracks.rows, [{ top: 300, bottom: 200 }, { top: 200, bottom: 0 }]);
});

// ------------------------------------------------------------------ blocks

test("blocks span modules and are drawn as block boxes", () => {
    const r = build([0, 0, 400, -300], {
        type: "modular", columns: 4, columnGutter: 0, rows: 3, rowGutter: 0,
        marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0,
        blocks: [{ column: 1, row: 1, columns: 4, rows: 1 }, { column: 2, row: 2, columns: 2, rows: 2 }]
    });
    assert.equal(r.ok, true);
    assert.deepEqual(ofKind({ segments: r.boxes }, "block"), [
        { kind: "block", left: 0, top: 0, right: 400, bottom: -100 },
        { kind: "block", left: 100, top: -100, right: 300, bottom: -300 }
    ]);
    assert.equal(r.metrics.blockCount, 2);
});

test("blocks are clipped to the grid, and column-grid blocks span the full height", () => {
    const modular = build([0, 0, 400, -300], {
        type: "modular", columns: 4, columnGutter: 0, rows: 3, rowGutter: 0,
        marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0,
        blocks: [{ column: 3, row: 3, columns: 5, rows: 5 }, { column: 9, row: 1, columns: 1, rows: 1 }]
    });
    assert.deepEqual(modular.boxes, [{ kind: "block", left: 200, top: -200, right: 400, bottom: -300 }]);
    assert.equal(modular.metrics.blockCount, 1);

    const columns = build(LETTER, { columns: 3, columnGutter: 12, blocks: [{ column: 2, row: 7, columns: 2, rows: 1 }] });
    assert.deepEqual(columns.boxes, [{ kind: "block", left: 220, top: 756, right: 576, bottom: 36 }]);
});

test("invalid blocks are reported", () => {
    assert.deepEqual(fieldsOf(build(LETTER, { type: "modular", blocks: [{ column: 0, row: 1, columns: 1, rows: 1 }] })), ["blocks"]);
    assert.deepEqual(fieldsOf(build(LETTER, { type: "modular", blocks: "1 1 2 2" })), ["blocks"]);
    assert.equal(core.parseBlocks([]).ok, true);
});

// ------------------------------------------------------------------ snapping

test("snap lines collect grid positions and the content edges", () => {
    const r = build(LETTER, { columns: 3, columnGutter: 12 });
    const lines = core.snapLines(r);
    assert.deepEqual(lines.xs, [36, 208, 220, 392, 404, 576]);
    assert.deepEqual(lines.ys, [36, 756]);
    const baseline = core.snapLines(build(LETTER, { type: "baseline", baselineSpacing: 360 }));
    assert.deepEqual(baseline.xs, [36, 576], "baseline grids still snap to the margins");
    assert.deepEqual(baseline.ys, [36, 396, 756]);
    assert.deepEqual(core.snapLines({ ok: false }), { xs: [], ys: [] });
});

test("snapRect moves an object by its nearer edges", () => {
    const lines = { xs: [36, 208, 220], ys: [36, 396, 756] };
    // Left edge 40 is 4 from 36; right edge 205 is 3 from 208 -> align the right edge.
    assert.deepEqual(core.snapRect([40, 700, 205, 500], lines), { dx: 3, dy: 56, onGrid: false });
    assert.deepEqual(core.snapRect([36, 756, 100, 400], lines), { dx: 0, dy: 0, onGrid: true });
    assert.deepEqual(core.snapRect([36.005, 756, 100, 400], lines).onGrid, true, "within tolerance");
    assert.deepEqual(core.snapRect([10, 10, 20, 5], { xs: [], ys: [] }), { dx: 0, dy: 0, onGrid: true });
});

test("messages can name the area being divided", () => {
    const r = core.buildGrid([0, 100, 50, 0], settings({ marginLeft: 30, marginRight: 30 }), { areaLabel: "object" });
    assert.match(r.errors[0].message, /less than the object width of 50 pt/);
});

// ------------------------------------------------------------ grid systems

test("rule of fifths divides each side into fifths", () => {
    const r = composition([0, 500, 500, 0], Object.assign({ compFifths: true }, NO_MARGINS));
    assert.equal(r.ok, true);
    assert.deepEqual(ofKind(r, "fifths").filter((s) => s.x1 === s.x2).map((s) => s.x1), [100, 200, 300, 400]);
});

test("harmonic armature: diagonals, four reciprocals, and eight corner-to-midpoint lines", () => {
    // A 300 x 200 area: reciprocal from the top-left corner ends on the bottom edge at u = h*h/w = 133.3333.
    const r = composition([0, 200, 300, 0], Object.assign({ compArmature: true }, NO_MARGINS));
    assert.equal(r.ok, true);
    const lines = ofKind(r, "armature");
    assert.equal(lines.length, 14);
    const set = segmentSet(lines);
    assert.ok(set.includes(segmentSet([{ x1: 0, y1: 200, x2: 133.3333, y2: 0 }])[0]), "reciprocal from top-left");
    assert.ok(set.includes(segmentSet([{ x1: 0, y1: 200, x2: 300, y2: 100 }])[0]), "top-left to right midpoint");
    assert.ok(set.includes(segmentSet([{ x1: 300, y1: 0, x2: 150, y2: 200 }])[0]), "bottom-right to top midpoint");
});

test("reciprocals are perpendicular to the opposite diagonal", () => {
    const r = composition([0, 200, 300, 0], Object.assign({ compDynamic: true }, NO_MARGINS));
    const reciprocal = ofKind(r, "dynamic").find((s) => s.x1 === 0 && s.y1 === 200);
    const rx = reciprocal.x2 - reciprocal.x1;
    const ry = reciprocal.y2 - reciprocal.y1;
    // The other diagonal runs from (300, 200) to (0, 0).
    assert.ok(Math.abs(rx * -300 + ry * -200) < 0.1, "dot product is zero");
});

test("dynamic rectangle adds lines through the eyes", () => {
    const r = composition([0, 200, 300, 0], Object.assign({ compDynamic: true }, NO_MARGINS));
    assert.equal(r.ok, true);
    // eye at u = w*h*h/(w*w+h*h) = 92.3077, v = w*w*h/(w*w+h*h) = 138.4615 from the top
    const verticals = ofKind(r, "dynamic").filter((s) => s.x1 === s.x2).map((s) => s.x1).sort((a, b) => a - b);
    assert.deepEqual(verticals, [92.3077, 207.6923]);
    const horizontals = ofKind(r, "dynamic").filter((s) => s.y1 === s.y2).map((s) => s.y1).sort((a, b) => a - b);
    assert.deepEqual(horizontals, [61.5385, 138.4615]);
});

test("Villard's figure crosses at one third", () => {
    const r = composition([0, 900, 600, 0], Object.assign({ compVillard: true }, NO_MARGINS));
    assert.equal(r.ok, true);
    const lines = ofKind(r, "villard");
    assert.ok(lines.some((s) => s.y1 === 600 && s.y2 === 600), "horizontal at one third from the top");
    assert.ok(lines.some((s) => s.x1 === 200 && s.x2 === 200) && lines.some((s) => s.x1 === 400 && s.x2 === 400), "verticals at thirds");
    assert.equal(lines.length, 7);
});

test("compound grids overlay a second, gutterless column count", () => {
    const r = build([0, 100, 120, 0], Object.assign({ columns: 3, columnGutter: 0, overlayColumns: 4 }, NO_MARGINS));
    assert.equal(r.ok, true);
    assert.deepEqual(xs(ofKind(r, "overlay")), [30, 60, 90]);
    assert.deepEqual(xs(ofKind(r, "column")), [0, 40, 80, 120]);
    assert.deepEqual(fieldsOf(build(LETTER, { overlayColumns: 49 })), ["overlayColumns"]);
    assert.equal(build(LETTER, { overlayColumns: 0 }).segments.some((s) => s.kind === "overlay"), false);
});

test("square modules make rows as tall as the columns are wide", () => {
    const r = build(LETTER, { type: "modular", columns: 6, columnGutter: 12, rowGutter: 12, squareModules: true, rows: 99 });
    assert.equal(r.ok, true);
    assert.equal(r.metrics.columnWidth, 80);
    assert.equal(r.metrics.rowHeight, 80);
    assert.equal(r.tracks.rows.length, 7); // floor((720 + 12) / 92)
    assert.deepEqual(r.tracks.rows[1], { top: 664, bottom: 584 });
    assert.deepEqual(fieldsOf(build(LETTER, { type: "modular", columnRatios: "2 1", squareModules: true })), ["squareModules"]);
});

test("angled grids tilt the diagonal pattern", () => {
    const r = pattern([0, 100, 100, 0], { pattern: "diagonal", patternSize: 50, patternAngle: 30 });
    assert.equal(r.ok, true);
    for (const s of ofKind(r, "pattern")) {
        const angle = Math.abs(Math.atan2(s.y2 - s.y1, s.x2 - s.x1) * 180 / Math.PI);
        assert.ok(Math.abs(angle - 30) < 0.05 || Math.abs(angle - 150) < 0.05, `angle ${angle}`);
    }
    assert.deepEqual(fieldsOf(pattern(LETTER, { pattern: "diagonal", patternAngle: 90 })), ["patternAngle"]);
});

// ------------------------------------------------------------ construction

const K = 0.5522847498307936;
function circlePath(cx, cy, r) {
    const k = K * r;
    return {
        closed: true,
        points: [
            { anchor: [cx, cy + r], left: [cx - k, cy + r], right: [cx + k, cy + r] },
            { anchor: [cx + r, cy], left: [cx + r, cy + k], right: [cx + r, cy - k] },
            { anchor: [cx, cy - r], left: [cx + k, cy - r], right: [cx - k, cy - r] },
            { anchor: [cx - r, cy], left: [cx - r, cy - k], right: [cx - r, cy + k] }
        ]
    };
}
function boxPath(left, top, right, bottom) {
    const corner = (x, y) => ({ anchor: [x, y], left: [x, y], right: [x, y] });
    return { closed: true, points: [corner(left, top), corner(right, top), corner(right, bottom), corner(left, bottom)] };
}
const CON = { conBounds: true, conKeylines: true, conCircles: true, conCenter: false, conDiagonals: false, conExtend: "artboard", output: "lines", strokeColor: "#E0457B", strokeWidth: 0.5, opacity: 100 };

test("construction finds the circle, its extremes, and the bounds of a circular mark", () => {
    const r = core.buildConstruction([circlePath(300, 400, 100)], LETTER, CON);
    assert.equal(r.ok, true, r.ok ? "" : r.errors[0].message);
    assert.equal(r.curves.length, 1);
    const [top] = r.curves[0].points;
    assert.deepEqual(top.anchor, [300, 500], "fitted circle has radius 100 around (300, 400)");
    assert.deepEqual(r.content, { left: 200, top: 500, right: 400, bottom: 300, width: 200, height: 200 });
    assert.deepEqual(xs(ofKind(r, "keyline").filter((s) => s.x1 === s.x2)).sort((a, b) => a - b), [200, 300, 400]);
    const vertical = ofKind(r, "keyline").find((s) => s.x1 === 300);
    assert.deepEqual([vertical.y1, vertical.y2], [792, 0], "key lines run across the artboard");
    assert.equal(ofKind(r, "bounds").length, 4);
    assert.deepEqual(r.settings.kindColors, { bounds: "#8C93A1", keyline: "#2F7CF6", circle: "#E0457B" });
});

test("construction keylines follow curve extremes even without anchors there", () => {
    // One cubic from (0, 0) to (0, 100) bulging right: its X extreme (75) has no anchor.
    const s = { closed: false, points: [{ anchor: [0, 0], left: [0, 0], right: [100, 50] }, { anchor: [0, 100], left: [100, 50], right: [0, 100] }] };
    const r = core.buildConstruction([s], LETTER, Object.assign({}, CON, { conCircles: false }));
    const xsFound = xs(ofKind(r, "keyline").filter((l) => l.x1 === l.x2));
    assert.ok(xsFound.some((x) => Math.abs(x - 75) < 0.01), "bulge extreme at x = 75: " + xsFound);
});

test("straight artwork gets no circles; mixed artwork merges duplicate circles", () => {
    assert.equal(core.buildConstruction([boxPath(100, 700, 300, 500)], LETTER, CON).curves.length, 0);
    const two = core.buildConstruction([circlePath(300, 400, 100), circlePath(300, 400, 100.1), circlePath(100, 100, 40)], LETTER, CON);
    assert.equal(two.curves.length, 2);
});

test("construction options: extend around the artwork, centers, diagonals, and validation", () => {
    const around = core.buildConstruction([boxPath(100, 700, 300, 500)], LETTER, Object.assign({}, CON, { conExtend: "bounds", conPadding: 20, conCenter: true, conDiagonals: true }));
    const left = ofKind(around, "keyline").find((s) => s.x1 === 100);
    assert.deepEqual([left.y1, left.y2], [720, 480], "lines extend 20 pt past the artwork");
    assert.equal(ofKind(around, "center").length, 2);
    assert.equal(ofKind(around, "diagonal").length, 2);

    assert.deepEqual(fieldsOf(core.buildConstruction([boxPath(1, 2, 3, 1)], LETTER, Object.assign({}, CON, { conBounds: false, conKeylines: false, conCircles: false }))), ["construction"]);
    assert.deepEqual(fieldsOf(core.buildConstruction([], LETTER, CON)), ["selection"]);
    assert.deepEqual(fieldsOf(core.buildConstruction([boxPath(1, 2, 3, 1)], LETTER, Object.assign({}, CON, { conKeylineColor: "blue" }))), ["conKeylineColor"]);
    assert.equal(core.buildConstruction([boxPath(1, 2, 3, 1)], LETTER, Object.assign({}, CON, { output: "guides", conKeylineColor: "blue" })).ok, true, "colors ignored for guides");
});
