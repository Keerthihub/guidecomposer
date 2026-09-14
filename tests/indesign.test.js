"use strict";

/*
 * Runs host/index.jsx with the InDesign adapter against a strict fake InDesign DOM.
 * These tests cover the adapter's logic; the adapter still needs a check in
 * InDesign itself before release (see README).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { createInDesignHost, Rectangle, TextFrame } = require("./helpers/fake-indesign.js");

const OWNER = "com.mullion.panel";
const COLUMNS = {
    type: "columns", units: "pt", columns: 3, columnGutter: 12,
    marginTop: 36, marginRight: 36, marginBottom: 36, marginLeft: 36,
    output: "lines", strokeColor: "#E0457B", strokeWidth: 0.5, opacity: 80, lineStyle: "solid", lockLayer: false
};

function ready(docOptions) {
    const host = createInDesignHost();
    const doc = host.openDocument(docOptions);
    const booted = host.boot();
    assert.equal(booted.ok, true, JSON.stringify(booted));
    return { host, doc };
}

const plain = (v) => JSON.parse(JSON.stringify(v));
const grids = (doc) => doc.pageList.flatMap((p) => p.items).filter((i) => i.labels.MullionOwner === OWNER && i.labels.MullionKind);
const managedLayer = (doc) => doc.layerList.find((l) => l.name === "Mullion grids");

test("boot loads the InDesign adapter and status describes pages in points", () => {
    const { host, doc } = ready({ pages: [[0, 0, 792, 612], [0, 648, 792, 1260]] });
    host.setActivePage(doc, 1);
    const r = host.call("status");
    assert.equal(r.ok, true);
    assert.equal(r.data.host, "indesign");
    assert.equal(r.data.artboardCount, 2);
    assert.deepEqual(plain(r.data.artboard), { index: 1, name: "Page 2", rect: [648, 0, 1260, -792], width: 612, height: 792 });
    assert.equal(host.app.scriptPreferences.measurementUnit, "MeasurementUnits.PICAS", "user's units restored");
});

test("generate draws a labeled group of lines in InDesign coordinates, as one undo step", () => {
    const { host, doc } = ready({});
    const r = host.call("generate", { settings: COLUMNS });
    assert.equal(r.ok, true, r.ok ? "" : r.error.message);
    assert.equal(r.data.shapes, 8);

    const layer = managedLayer(doc);
    assert.ok(layer);
    assert.equal(layer.printable, false);
    assert.equal(doc.layerList[0], layer, "grid layer moved to the top");
    assert.equal(doc.activeLayer.name, "Layer 1", "active layer restored");

    const [group] = grids(doc);
    assert.equal(group.constructor.name, "Group");
    assert.deepEqual(group.labels, { MullionOwner: OWNER, MullionKind: "final", MullionArtboard: "0", MullionRegion: "artboard:0" });
    assert.equal(group.name, "Column grid, Page 1");
    assert.equal(group.transparencySettings.blendingSettings.opacity, 80);
    assert.ok(group.children.every((c) => c.labels.MullionOwner === OWNER));

    const firstColumn = group.children.find((c) => c.paths[0]._points[0][0] === 36 && c.paths[0]._points[1][0] === 36);
    assert.deepEqual(plain(firstColumn.paths[0]._points), [[36, 36], [36, 756]], "Y measured downward from the page top");
    assert.equal(firstColumn.strokeWeight, 0.5);
    assert.equal(firstColumn.strokeColor.name, "Mullion #E0457B");
    assert.deepEqual(plain(firstColumn.strokeColor.colorValue), [224, 69, 123]);
    assert.equal(doc.colorList.length, 1, "one shared swatch");

    assert.deepEqual(host.app.transactions.map((t) => [t.name, t.undoMode]), [["Mullion: Generate grid", "UndoModes.ENTIRE_SCRIPT"]]);
    assert.equal(host.app.scriptPreferences.measurementUnit, "MeasurementUnits.PICAS");
    assert.equal(host.app.scriptPreferences.enableRedraw, true);
});

test("grids land on the right page of a spread", () => {
    const { host, doc } = ready({ pages: [[0, 0, 792, 612], [0, 612, 792, 1224]] });
    host.setActivePage(doc, 1);
    host.call("generate", { settings: { ...COLUMNS, columns: 1 } });
    const group = grids(doc)[0];
    assert.equal(group.page, doc.pageList[1]);
    const xs = group.children.map((c) => c.paths[0]._points[0][0]);
    assert.ok(xs.includes(648) && xs.includes(1188), "margins measured from page 2's left edge at 612");
});

test("regenerating replaces, Add keeps, and Clear removes only Mullion grids", () => {
    const { host, doc } = ready({});
    const userArt = doc.pageList[0].addItem(new Rectangle(doc.pageList[0], doc.layerList[0]), {});
    host.call("generate", { settings: COLUMNS });
    assert.equal(host.call("generate", { settings: COLUMNS }).data.replaced, 1);
    assert.equal(grids(doc).length, 1);
    host.call("generate", { settings: { ...COLUMNS, type: "baseline", baselineSpacing: 24 }, mode: "add" });
    assert.equal(grids(doc).length, 2);
    assert.equal(host.call("clear").data.removed, 2);
    assert.equal(grids(doc).length, 0);
    assert.ok(doc.pageList[0].items.includes(userArt), "user rectangle untouched");
    assert.equal(managedLayer(doc), undefined, "emptied grid layer removed");
});

test("Clear ungroups a grid holding user artwork and keeps that artwork", () => {
    const { host, doc } = ready({});
    host.call("generate", { settings: COLUMNS });
    const group = grids(doc)[0];
    const art = new Rectangle(doc.pageList[0], group.itemLayer);
    art.name = "Photo";
    group.children.push(art);
    art.parent = group;
    const r = host.call("clear");
    assert.equal(r.data.rescued, 1);
    assert.ok(doc.pageList[0].items.includes(art), "artwork is back on the page");
    assert.ok(doc.pageList[0].items.every((item) => item.labels.MullionOwner !== OWNER), "no Mullion lines left");
    assert.ok(managedLayer(doc), "layer with user artwork is kept");
});

test("locked grid layers are unlocked for the change and relocked", () => {
    const { host, doc } = ready({});
    host.call("generate", { settings: { ...COLUMNS, lockLayer: true } });
    assert.equal(managedLayer(doc).locked, true);
    const r = host.call("generate", { settings: { ...COLUMNS, lockLayer: true } });
    assert.equal(r.ok, true, r.ok ? "" : r.error.message);
    assert.equal(managedLayer(doc).locked, true);
    assert.equal(host.call("clear").ok, true);
});

test("guides become page guides at every grid line", () => {
    const { host, doc } = ready({});
    const r = host.call("generate", { settings: { ...COLUMNS, output: "guides" } });
    assert.equal(r.ok, true, r.ok ? "" : r.error.message);
    const guides = doc.pageList[0].guideList;
    const vertical = guides.filter((g) => g.orientation === "HorizontalOrVertical.VERTICAL").map((g) => g._location);
    const horizontal = guides.filter((g) => g.orientation === "HorizontalOrVertical.HORIZONTAL").map((g) => g._location);
    assert.deepEqual(vertical, [36, 208, 220, 392, 404, 576]);
    assert.deepEqual(horizontal.sort((a, b) => a - b), [36, 756]);
    assert.ok(guides.every((g) => g.fitToPage && g.labels.MullionOwner === OWNER && g.labels.MullionKind === "final"));
    assert.equal(host.call("clear").data.removed, 8);
    assert.equal(doc.pageList[0].guideList.length, 0);
});

test("diagonals and curves can't be InDesign guides, and nothing is drawn", () => {
    const { host, doc } = ready({});
    const r = host.call("generate", { settings: { ...COLUMNS, type: "composition", compThirds: true, compDiagonals: true, output: "guides" } });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "GUIDES_UNSUPPORTED");
    assert.equal(doc.pageList[0].guideList.length, 0);
    assert.equal(grids(doc).length, 0);
});

test("previews hide the grid they replace and restore it", () => {
    const { host, doc } = ready({});
    host.call("generate", { settings: COLUMNS });
    const original = grids(doc)[0];
    const p = host.call("preview", { settings: { ...COLUMNS, columns: 4 } });
    assert.equal(p.data.hidden, 1);
    assert.equal(original.visible, false);
    host.call("clearPreview");
    assert.equal(original.visible, true);
    assert.equal(grids(doc).length, 1);
});

test("shapes: boxes, gutters, blocks, dots, hexagons, spiral, and rings", () => {
    const { host, doc } = ready({ pages: [[0, 0, 100, 161.8034]] });
    const golden = host.call("generate", {
        settings: { ...COLUMNS, type: "composition", compThirds: false, compSpiral: true, spiralFocus: "bottom-right", marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0 }
    });
    assert.equal(golden.ok, true, golden.ok ? "" : golden.error.message);
    const spiral = grids(doc)[0].children.find((c) => c.paths[0]._points.length === 11);
    assert.equal(spiral.constructor.name, "GraphicLine");
    assert.deepEqual(plain(spiral.paths[0]._points[0]), [[0, 100], [0, 100], [0, 44.7715]], "bottom-left start, handle pointing up");
    assert.deepEqual(plain(spiral.paths[0]._points[1][1]), [100, 0]);

    const page2 = ready({});
    const boxes = page2.host.call("generate", {
        settings: { ...COLUMNS, type: "modular", columns: 2, rows: 2, output: "boxes", shadeGutters: true, gutterColor: "#0000FF", gutterOpacity: 25, blocks: [{ column: 1, row: 1, columns: 2, rows: 1 }] }
    });
    assert.equal(boxes.ok, true, boxes.ok ? "" : boxes.error.message);
    const children = grids(page2.doc)[0].children;
    const gutterFills = children.filter((c) => c.fillColor && c.fillColor.name === "Mullion #0000FF");
    assert.ok(gutterFills.length >= 2 && gutterFills.every((c) => c.transparencySettings.blendingSettings.opacity === 25));
    const block = children.find((c) => c.transparencySettings.blendingSettings.opacity === 20);
    assert.ok(block && block.strokeWeight === 0);
    assert.ok(children.indexOf(gutterFills[0]) < children.indexOf(block), "gutters drawn before blocks");
    const module = children.find((c) => c.constructor.name === "Rectangle" && c.strokeWeight === 0.5);
    assert.deepEqual(plain(module._bounds), [36, 36, 390, 300], "first module [y1, x1, y2, x2]");

    const dots = ready({ pages: [[0, 0, 50, 50]] });
    dots.host.call("generate", { settings: { ...COLUMNS, type: "pattern", pattern: "dots", patternSize: 25, dotSize: 4, marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0 } });
    const ovals = grids(dots.doc)[0].children;
    assert.equal(ovals.length, 9);
    assert.deepEqual(plain(ovals[0]._bounds), [-2, -2, 2, 2]);
    assert.ok(ovals.every((o) => o.constructor.name === "Oval" && o.strokeWeight === 0));

    const hex = ready({ pages: [[0, 0, 100, 100]] });
    hex.host.call("generate", { settings: { ...COLUMNS, type: "pattern", pattern: "hexagon", patternSize: 10, marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0 } });
    const polygons = grids(hex.doc)[0].children.filter((c) => c.constructor.name === "Polygon");
    assert.equal(polygons.length, 30);
    assert.deepEqual(plain(polygons[0].paths[0]._points[0]), [11.0289, 2.5]);

    const radial = ready({ pages: [[0, 0, 200, 200]] });
    radial.host.call("generate", { settings: { ...COLUMNS, type: "pattern", pattern: "radial", rings: 2, spokes: 0, marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0 } });
    const rings = grids(radial.doc)[0].children.filter((c) => c.constructor.name === "Polygon");
    assert.equal(rings.length, 2);
    assert.ok(rings.every((r) => r.paths[0].pathType === "PathType.CLOSED_PATH" && r.paths[0]._points.length === 4));
});

test("dashed and dotted styles use InDesign stroke styles", () => {
    const { host, doc } = ready({});
    host.call("generate", { settings: { ...COLUMNS, lineStyle: "dotted", marginColorOn: true, marginColor: "#00FF00" } });
    const children = grids(doc)[0].children;
    assert.ok(children.every((c) => c.strokeType.name === "Dotted" && c.endCap === "EndCap.ROUND_END_CAP"));
    const margins = children.filter((c) => c.paths[0]._points[0][1] === c.paths[0]._points[1][1]);
    assert.ok(margins.length === 2 && margins.every((c) => c.strokeColor.name === "Mullion #00FF00"));
});

test("grids inside selected objects, and snapping objects to the grid", () => {
    const { host, doc } = ready({});
    const page = doc.pageList[0];
    const card = page.addItem(new Rectangle(page, doc.layerList[0]), {});
    card._bounds = [92, 100, 292, 300]; // y1, x1, y2, x2 in points
    doc.selection = [card];
    const status = host.call("status");
    assert.deepEqual(plain(status.data.selection.objects), [{ rect: [100, -92, 300, -292], artboard: 0 }]);
    const r = host.call("generate", { settings: { ...COLUMNS, columns: 2, columnGutter: 10, marginTop: 10, marginRight: 10, marginBottom: 10, marginLeft: 10 }, target: { mode: "selection" } });
    assert.equal(r.ok, true, r.ok ? "" : r.error.message);
    const group = grids(doc)[0];
    assert.equal(group.labels.MullionRegion, "object:100,-92,300,-292");
    assert.deepEqual([...new Set(group.children.map((c) => c.paths[0]._points[0][0]))].sort((a, b) => a - b), [110, 195, 205, 290]);

    const off = page.addItem(new Rectangle(page, doc.layerList[0]), {});
    off._bounds = [92, 40, 292, 205]; // left 40, right 205, top 92 (56 below the 36 margin)
    doc.selection = [off];
    const snap = host.call("alignSelection", { settings: COLUMNS, action: "snap" });
    assert.equal(snap.ok, true, snap.ok ? "" : snap.error.message);
    assert.equal(snap.data.moved, 1);
    assert.deepEqual(plain(off._bounds), [36, 43, 236, 208], "moved right 3 and up 56");
    doc.selection = [off, card];
    host.call("alignSelection", { settings: COLUMNS, action: "select" });
    assert.ok(doc.selection.length === 1 && doc.selection[0] === card, "only the off-grid card stays selected");
});

test("text metrics, page resize, and InDesign page margins", () => {
    const { host, doc } = ready({});
    const page = doc.pageList[0];
    const frame = page.addItem(new TextFrame(page, doc.layerList[0], { pointSize: 9, leading: 11, font: "Minion Pro" }), {});
    doc.selection = [frame];
    assert.deepEqual(host.call("textMetrics").data, { size: 9, leading: 11, autoLeading: false, font: "Minion Pro" });
    frame.texts[0]._leading = "Leading.AUTO";
    assert.deepEqual(host.call("textMetrics").data, { size: 9, leading: 10.8, autoLeading: true, font: "Minion Pro" });

    const resized = host.call("resizeArtboards", { width: 210, height: 297, units: "mm" });
    assert.equal(resized.ok, true, resized.ok ? "" : resized.error.message);
    assert.ok(Math.abs(page._bounds[3] - 595.2756) < 1e-3 && Math.abs(page._bounds[2] - 841.8898) < 1e-3);
    assert.equal(host.call("resizeArtboards", { width: 20000, height: 100, units: "pt" }).error.code, "RESIZE_FAILED");

    const margins = host.call("applyPageMargins", {
        settings: { ...COLUMNS, columns: 6, columnGutter: 4, units: "mm", marginTop: 20, marginRight: 15, marginBottom: 25, marginLeft: 15, addBaseline: true, baselineSpacing: 4, baselineOffset: 1 }
    });
    assert.equal(margins.ok, true, margins.ok ? "" : margins.error.message);
    const m = page.marginPreferences;
    assert.equal(m.columnCount, 6);
    assert.ok(Math.abs(m.top - 56.6929) < 1e-3 && Math.abs(m.columnGutter - 11.3386) < 1e-3, "millimeters converted to points");
    assert.ok(Math.abs(doc.gridPreferences.baselineDivision - 11.3386) < 1e-3);
    assert.ok(Math.abs(doc.gridPreferences.baselineStart - 59.5276) < 1e-3, "baseline starts at top margin plus offset");
    assert.equal(host.call("applyPageMargins", { settings: { ...COLUMNS, columnRatios: "2 1" } }).error.message, "InDesign page columns are equal widths. Clear Column widths to use them.");
});

test("Illustrator reports page margins as InDesign-only", () => {
    const { createHost } = require("./helpers/fake-illustrator.js");
    const host = createHost();
    host.boot();
    host.openDocument({});
    assert.equal(host.call("applyPageMargins", { settings: COLUMNS }).error.code, "UNSUPPORTED");
});
