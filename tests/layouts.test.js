"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../shared/grid-core.js");
const library = require("../shared/layouts.js");

const { CATEGORIES, LAYOUTS, find, resolveLayout, suggestLayouts, describeArtboard, describeShort } = library;

const SIZES = {
    letter: [0, 792, 612, 0],
    a6: [0, 419.53, 297.64, 0],
    a0: [0, 3370.39, 2383.94, 0],
    square: [0, 1080, 1080, 0],
    widescreen: [0, 1080, 1920, 0],
    story: [0, 1920, 1080, 0]
};
const APPEARANCE_KEYS = ["output", "strokeColor", "strokeWidth", "opacity", "lineStyle", "marginColorOn", "marginColor", "shadeGutters", "gutterColor", "gutterOpacity", "lockLayer"];

function rectFor(layout) {
    const a = layout.artboard;
    return [0, core.toPoints(a.height, a.units), core.toPoints(a.width, a.units), 0];
}

function build(layout, rect, units) {
    return core.buildGrid(rect, Object.assign(core.defaults(), { units: units || "pt" }, resolveLayout(layout, rect, units || "pt")));
}

function messages(result) {
    return result.errors.map((e) => e.message).join(" ");
}

test("the library has over a hundred layouts with unique ids in known categories", () => {
    assert.ok(LAYOUTS.length >= 120, `${LAYOUTS.length} layouts`);
    assert.equal(CATEGORIES[0], "Systems", "Systems opens first");
    const ids = LAYOUTS.map((l) => l.id);
    assert.equal(new Set(ids).size, ids.length, "ids are unique");
    for (const layout of LAYOUTS) {
        assert.ok(CATEGORIES.includes(layout.category), `${layout.id} category`);
        assert.ok(layout.name.length > 0 && layout.name.length <= 34, `${layout.id} name fits a tile (${layout.name.length})`);
    }
    for (const category of CATEGORIES) {
        assert.ok(LAYOUTS.some((l) => l.category === category), `${category} has layouts`);
    }
});

test("layouts made for a size build a valid grid on that size", () => {
    for (const layout of LAYOUTS.filter((l) => l.artboard)) {
        const result = build(layout, rectFor(layout));
        assert.equal(result.ok, true, `${layout.id}: ${messages(result)}`);
        assert.ok(result.shapeCount > 0);
    }
});

test("layouts for any page build on small, huge, square, wide, and tall artboards", () => {
    for (const layout of LAYOUTS.filter((l) => !l.artboard)) {
        for (const [name, rect] of Object.entries(SIZES)) {
            for (const units of ["pt", "mm"]) {
                const result = build(layout, rect, units);
                assert.equal(result.ok, true, `${layout.id} on ${name} in ${units}: ${messages(result)}`);
            }
        }
    }
});

test("relative layouts scale margins and gutters with the artboard", () => {
    const layout = find("columns-12");
    const letter = resolveLayout(layout, SIZES.letter, "pt");
    assert.equal(letter.marginTop, 36.7); // 6% of 612
    assert.equal(letter.columnGutter, 12.2); // 2% of 612
    const a0 = resolveLayout(layout, SIZES.a0, "pt");
    assert.equal(a0.marginTop, 143);
    const mm = resolveLayout(layout, SIZES.letter, "mm");
    assert.equal(mm.units, "mm");
    assert.equal(mm.marginLeft, 13); // 36.72 pt = 12.95 mm
});

test("the Van de Graaf canon scales margins by page width and height", () => {
    const right = resolveLayout(find("classic-van-de-graaf-right"), [0, 900, 630, 0], "pt");
    assert.deepEqual(
        [right.marginTop, right.marginBottom, right.marginLeft, right.marginRight],
        [100, 200, 70, 140]
    );
    const left = resolveLayout(find("classic-van-de-graaf-left"), [0, 900, 630, 0], "pt");
    assert.deepEqual([left.marginLeft, left.marginRight], [140, 70]);
});

test("fixed layouts keep their own units and values", () => {
    const web = resolveLayout(find("web-1440"), SIZES.letter, "mm");
    assert.equal(web.units, "px");
    assert.equal(web.marginLeft, 120);
    assert.equal(web.columns, 12);
    assert.equal(resolveLayout(find("baseline-12"), SIZES.letter, "mm").units, "pt", "baseline sizes stay in points");
});

test("layouts only set layout fields, never appearance", () => {
    const known = Object.keys(core.defaults());
    for (const layout of LAYOUTS) {
        const resolved = resolveLayout(layout, SIZES.letter, "pt");
        for (const key of Object.keys(resolved)) {
            assert.ok(known.includes(key), `${layout.id}: unknown setting ${key}`);
            assert.ok(!APPEARANCE_KEYS.includes(key), `${layout.id}: sets appearance field ${key}`);
        }
    }
});

test("suggestions match the artboard's shape, exact sizes first", () => {
    const square = suggestLayouts(SIZES.square).map((l) => l.id);
    assert.deepEqual(square.slice(0, 2).sort(), ["square-post", "square-post-2x2"]);

    const wide = suggestLayouts(SIZES.widescreen).map((l) => l.id);
    assert.deepEqual(wide.slice(0, 2).sort(), ["desktop-1920", "slide-16x9"]);
    assert.ok(wide.includes("video-thumbnail"), "same 16:9 proportions, different size");

    const letter = suggestLayouts(SIZES.letter).map((l) => l.id);
    assert.ok(letter.includes("letter-3"));
    assert.ok(letter.includes("dots-quarter-in"));
    assert.ok(!letter.includes("a4-12"), "A4 proportions differ from Letter by more than 2.5%");
    assert.ok(!letter.includes("poster-5x7"), "18 × 24 in differs from Letter by 3%");

    const a4 = suggestLayouts([0, 841.89, 595.28, 0]).map((l) => l.id);
    assert.ok(a4.includes("a4-12") && a4.includes("a3-8x12"), "A-series sizes share proportions");

    assert.ok(suggestLayouts(SIZES.story).map((l) => l.id).includes("story-safe"));
    assert.deepEqual(suggestLayouts([0, 100, 700, 0]), [], "no layouts for a 7:1 strip");
    assert.equal(suggestLayouts(SIZES.letter, 2).length, 2);
});

test("descriptions tell a layout that scales apart from one that keeps its sizes", () => {
    assert.equal(describeArtboard(find("web-1440")), "Made for a 1440 × 1024 px artboard.");
    assert.equal(describeArtboard(find("columns-3")), "");
    assert.equal(describeShort(find("web-1440")), "1440 × 1024 px");
    assert.equal(describeShort(find("modular-4x6")), "24 modules");
    assert.equal(describeShort(find("columns-3")), "Scales to any page");
    // These three used to be "Fits any page" and "Any page": three characters
    // apart, opposite meanings.
    assert.equal(describeShort(find("swiss-12")), "Fixed sizes, any page");
    assert.equal(describeShort(find("isometric-24")), "Fixed sizes, any page");
    assert.equal(describeShort(find("photo-thirds")), "Proportions only, any page");
    for (const layout of LAYOUTS.filter((l) => !l.artboard && !l.detail)) {
        const label = describeShort(layout);
        assert.equal(label === "Scales to any page", !!layout.relative, `${layout.id}: ${label}`);
    }
    assert.equal(find("nope"), null);
});

test("suggestions know an artboard turned sideways is the same page", () => {
    const portrait = suggestLayouts(SIZES.letter).map((l) => l.id);
    const landscape = suggestLayouts([0, 612, 792, 0]).map((l) => l.id);
    assert.ok(portrait.length >= 6);
    assert.deepEqual(landscape.slice().sort(), portrait.slice().sort(), "the same layouts, either way up");

    // A layout facing the right way still outranks the same layout turned.
    const wide = suggestLayouts(SIZES.widescreen).map((l) => l.id);
    assert.deepEqual(wide.slice(0, 2).sort(), ["desktop-1920", "slide-16x9"]);
    assert.ok(wide.indexOf("story-safe") > 1, "the 1080 × 1920 story ranks below the 1920 × 1080 screens");
    assert.deepEqual(suggestLayouts([0, 100, 700, 0]), [], "still nothing for a 7:1 strip");
});

// A panel that has been used: every grid field set to something a layout must clear.
const MESSY = {
    columns: 7, rows: 9, columnRatios: "2 1 1", rowRatios: "3 1",
    blocks: [{ column: 1, row: 1, columns: 2, rows: 2 }],
    columnGutter: 31, rowGutter: 29, marginTop: 41, marginRight: 43, marginBottom: 47, marginLeft: 53,
    addBaseline: true, baselineSpacing: 21, baselineOffset: 7, overlayColumns: 5, squareModules: true,
    extendToEdges: true, compThirds: true, compFifths: true, compGolden: true, compDiagonals: true,
    compCenter: true, compArmature: true, compDynamic: true, compVillard: true, compSpiral: true,
    spiralFocus: "top-left", pattern: "hexagon", patternSize: 41, patternAngle: 71, dotSize: 4, rings: 3, spokes: 5
};

test("a layout applied over another layout's settings draws exactly its own tile", () => {
    for (const layout of LAYOUTS) {
        const rect = layout.artboard ? rectFor(layout) : SIZES.letter;
        const tile = core.buildGrid(rect, Object.assign(core.defaults(), { units: "pt" }, resolveLayout(layout, rect, "pt")));
        const applied = core.buildGrid(rect, Object.assign(core.defaults(), { units: "pt" }, MESSY, resolveLayout(layout, rect, "pt")));
        assert.equal(tile.ok, true, `${layout.id} tile: ${messages(tile)}`);
        assert.equal(applied.ok, true, `${layout.id} applied: ${messages(applied)}`);
        assert.deepEqual(applied.segments, tile.segments, `${layout.id} lines`);
        assert.deepEqual(applied.boxes, tile.boxes, `${layout.id} boxes`);
        assert.deepEqual(applied.polygons, tile.polygons, `${layout.id} polygons`);
        assert.deepEqual(applied.curves, tile.curves, `${layout.id} curves`);
        assert.deepEqual(applied.dots, tile.dots, `${layout.id} dots`);
        assert.deepEqual(applied.metrics, tile.metrics, `${layout.id} metrics`);
    }
});

test("layouts hand back their own copy of a block list", () => {
    const layout = find("system-hierarchical");
    const blocks = resolveLayout(layout, SIZES.letter, "pt").blocks;
    assert.equal(blocks.length, 3);
    blocks.push({ column: 1, row: 1, columns: 1, rows: 1 });
    blocks[0].columns = 99;
    assert.equal(resolveLayout(layout, SIZES.letter, "pt").blocks.length, 3);
    assert.equal(layout.settings.blocks[0].columns, 4);
});
