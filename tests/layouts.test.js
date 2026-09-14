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

test("the library has about a hundred layouts with unique ids in known categories", () => {
    assert.ok(LAYOUTS.length >= 100, `${LAYOUTS.length} layouts`);
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

test("descriptions", () => {
    assert.equal(describeArtboard(find("web-1440")), "Made for a 1440 × 1024 px artboard.");
    assert.equal(describeArtboard(find("columns-3")), "");
    assert.equal(describeShort(find("web-1440")), "1440 × 1024 px");
    assert.equal(describeShort(find("modular-4x6")), "24 modules");
    assert.equal(describeShort(find("columns-3")), "Fits any page");
    assert.equal(find("nope"), null);
});
