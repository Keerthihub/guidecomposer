"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { GROUPS, FORMATS, find, toPoints, label } = require("../shared/formats.js");

test("formats have unique ids, known groups, and sizes Illustrator accepts", () => {
    assert.equal(new Set(FORMATS.map((f) => f.id)).size, FORMATS.length);
    for (const format of FORMATS) {
        assert.ok(GROUPS.includes(format.group), format.id);
        const pts = toPoints(format);
        assert.ok(pts.width > 0 && pts.height > 0, format.id);
        assert.ok(pts.width <= 16383 && pts.height <= 16383, `${format.id} fits a standard Illustrator canvas`);
    }
});

test("A-series sizes share the square-root-of-two proportion", () => {
    for (const id of ["a0", "a1", "a2", "a3", "a4", "a5", "a6"]) {
        const f = find(id);
        assert.ok(Math.abs(f.height / f.width - Math.SQRT2) < 0.01, id);
    }
});

test("labels show the size, optionally swapped", () => {
    assert.equal(label(find("a4")), "A4 (210 × 297 mm)");
    assert.equal(label(find("a4"), true), "A4 (297 × 210 mm)");
    assert.deepEqual(toPoints(find("letter")), { width: 612, height: 792 });
    assert.equal(find("nope"), null);
});
