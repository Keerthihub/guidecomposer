"use strict";

/*
 * Runs host/index.jsx with the InDesign adapter against a strict fake InDesign DOM.
 * These tests cover the adapter's logic; the adapter still needs a check in
 * InDesign itself before release (see README).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { createInDesignHost, Rectangle, TextFrame, TextSelection, Group } = require("./helpers/fake-indesign.js");

const OWNER = "com.keerthi.guidecomposer";
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
const managedLayer = (doc) => doc.layerList.find((l) => l.name === "GuideComposer grids");

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
    assert.equal(group.labels.MullionOwner, OWNER);
    assert.equal(group.labels.MullionKind, "final");
    assert.equal(group.labels.MullionArtboard, "0");
    assert.equal(group.labels.MullionRegion, "artboard:0");
    assert.equal(group.labels.MullionSchema, "1", "grids record the schema that wrote them");
    assert.equal(group.labels.MullionShapes, "8", "grids record how many items they were drawn with");
    const recorded = JSON.parse(group.labels.MullionSettings);
    assert.equal(recorded.settings.type, "columns", "the settings travel with the grid");
    assert.equal(group.name, "Column grid, Page 1");
    assert.equal(group.transparencySettings.blendingSettings.opacity, 80);
    assert.ok(group.children.every((c) => c.labels.MullionOwner === OWNER));

    const firstColumn = group.children.find((c) => c.paths[0]._points[0][0] === 36 && c.paths[0]._points[1][0] === 36);
    assert.deepEqual(plain(firstColumn.paths[0]._points), [[36, 36], [36, 756]], "Y measured downward from the page top");
    assert.equal(firstColumn.strokeWeight, 0.5);
    assert.equal(firstColumn.strokeColor.name, "GuideComposer #E0457B");
    assert.deepEqual(plain(firstColumn.strokeColor.colorValue), [224, 69, 123]);
    assert.equal(doc.colorList.length, 1, "one shared swatch");

    assert.deepEqual(host.app.transactions.map((t) => [t.name, t.undoMode]), [["GuideComposer: Generate grid", "UndoModes.ENTIRE_SCRIPT"]]);
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

test("regenerating replaces, Add keeps, and Clear removes only GuideComposer grids", () => {
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
    assert.ok(doc.pageList[0].items.every((item) => item.labels.MullionOwner !== OWNER), "no GuideComposer lines left");
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
    const gutterFills = children.filter((c) => c.fillColor && c.fillColor.name === "GuideComposer #0000FF");
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
    assert.ok(margins.length === 2 && margins.every((c) => c.strokeColor.name === "GuideComposer #00FF00"));
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

test("InDesign construction lines read page item paths in page coordinates", () => {
    const { host, doc } = ready({});
    const page = doc.pageList[0];
    const { Rectangle } = require("./helpers/fake-indesign.js");
    const mark = page.addItem(new Rectangle(page, doc.layerList[0]), {});
    // A circle of radius 100 centered at (306, 396) in InDesign coordinates (Y down).
    const k = 0.5522847498307936 * 100;
    mark.paths[0].pathType = "PathType.CLOSED_PATH";
    // Stored directly in points; the fake reports them in picas unless the adapter switches units.
    mark.paths[0]._points = [
        [[306 - k, 296], [306, 296], [306 + k, 296]],
        [[406, 396 - k], [406, 396], [406, 396 + k]],
        [[306 + k, 496], [306, 496], [306 - k, 496]],
        [[206, 396 + k], [206, 396], [206, 396 - k]]
    ];
    mark._bounds = [296, 206, 496, 406];
    doc.selection = [mark];
    const r = host.call("generate", { settings: { ...COLUMNS, conBounds: true, conKeylines: true, conCircles: true, conCircleColor: "#FF0000", conKeylineColor: "#0000FF", conBoundsColor: "#888888" }, kind: "construction" });
    assert.equal(r.ok, true, r.ok ? "" : r.error.message);
    const group = grids(doc)[0];
    assert.equal(group.name, "Construction lines, Artwork on Page 1");
    const rings = group.children.filter((c) => c.constructor.name === "Polygon" && c.paths[0].pathType === "PathType.CLOSED_PATH");
    assert.equal(rings.length, 1);
    assert.equal(rings[0].strokeColor.name, "GuideComposer #FF0000");
    const line = group.children.find((c) => c.constructor.name === "GraphicLine" && c.paths[0]._points[0][0] === 306 && c.paths[0]._points[1][0] === 306);
    assert.deepEqual(plain(line.paths[0]._points), [[306, 0], [306, 792]], "vertical key line through the center, across the page");
    assert.equal(line.strokeColor.name, "GuideComposer #0000FF");
});

// ------------------------------------------------- InDesign's own hard cases

test("the cursor sitting in text never breaks a call", () => {
    const { host, doc } = ready({});
    // InDesign's most common selection state: an insertion point in a story.
    doc.selection = [new TextSelection()];

    const status = host.call("status");
    assert.equal(status.ok, true, status.ok ? "" : status.error.message);
    assert.equal(status.data.selection.count, 0, "text is not an object a grid can go inside");

    const geometry = host.call("selectionGeometry");
    assert.equal(geometry.ok, true, geometry.ok ? "" : geometry.error.message);
    assert.deepEqual(geometry.data.paths, []);
    assert.equal(geometry.data.hasText, true, "and the panel can say so");

    const align = host.call("alignSelection", { settings: COLUMNS, action: "check" });
    assert.equal(align.ok, false);
    assert.equal(align.error.code, "NO_SELECTION", "with guidance, not an unexpected error");
});

test("facing pages mirror the inside and outside margins", () => {
    const { host, doc } = ready({ pages: [[0, 0, 792, 612], [0, 648, 792, 1260]] });
    doc.documentPreferences.facingPages = true;
    const settings = { ...COLUMNS, marginLeft: 100, marginRight: 50 };

    const r = host.call("applyPageMargins", { settings, target: { mode: "all" } });
    assert.equal(r.ok, true, r.ok ? "" : r.error.message);
    assert.equal(r.data.facingPages, true);
    assert.equal(r.data.mirroredPages, 1);

    const right = doc.pageList[0].marginPreferences;
    const left = doc.pageList[1].marginPreferences;
    assert.equal(right.left, 100, "a right-hand page keeps the inside margin on the left");
    assert.equal(left.left, 50, "a left-hand page mirrors it");
    assert.equal(left.right, 100);
});

test("the baseline grid follows the document's own reference point", () => {
    const { host, doc } = ready({});
    const settings = { ...COLUMNS, type: "baseline", baselineSpacing: 14, baselineOffset: 4, marginTop: 36 };

    host.call("applyPageMargins", { settings, target: { mode: "active" } });
    assert.equal(doc.gridPreferences.baselineStart, 40, "measured from the top of the page: margin + offset");

    doc.gridPreferences.baselineGridRelativeOption = "BaselineGridRelativeOption.TOP_OF_MARGIN";
    host.call("applyPageMargins", { settings, target: { mode: "active" } });
    assert.equal(doc.gridPreferences.baselineStart, 4, "measured from the margin: the margin is not counted twice");
});

test("a grid the user grouped with their own artwork is still GuideComposer's to clear", () => {
    const { host, doc } = ready({});
    host.call("generate", { settings: COLUMNS });
    const [grid] = grids(doc);
    const page = doc.pageList[0];

    // The user selects the grid with a frame of their own and presses Cmd-G.
    const frame = page.addItem(new Rectangle(page, doc.layerList[0]), {});
    frame.geometricBounds = [100, 100, 200, 200];
    const wrapper = page.groups.add([grid, frame], doc.layerList[0]);

    const r = host.call("clear");
    assert.equal(r.ok, true, r.ok ? "" : r.error.message);
    assert.equal(r.data.removed, 1, "the grid inside the user's group is cleared");
    assert.ok(page.items.includes(wrapper), "the user's group stays");
    assert.equal(grids(doc).length, 0);
});

test("a grid the user has edited is handed back, not deleted", () => {
    const { host, doc } = ready({});
    host.call("generate", { settings: COLUMNS });
    const [grid] = grids(doc);
    // The user deletes one of the grid's own lines.
    grid.children.splice(0, 1);

    const r = host.call("clear");
    assert.equal(r.ok, true, r.ok ? "" : r.error.message);
    assert.equal(r.data.removed, 0);
    assert.equal(r.data.kept, 1, "reported as kept, not cleared");
    assert.equal(grid.labels.MullionOwner, "", "and no longer GuideComposer's");
});

test("a preview left behind is swept when the panel next asks for status", () => {
    const { host, doc } = ready({});
    host.call("generate", { settings: COLUMNS });
    host.call("preview", { settings: { ...COLUMNS, columns: 6 } });
    assert.equal(grids(doc).filter((g) => g.labels.MullionKind === "preview").length, 1);
    assert.equal(grids(doc).find((g) => g.labels.MullionKind === "final").visible, false);

    host.sandbox.Mullion.previewing = false; // a new session, after a crash
    const status = host.call("status");
    assert.equal(status.ok, true);
    assert.equal(status.data.recoveredPreviews, 1);
    assert.equal(grids(doc).filter((g) => g.labels.MullionKind === "preview").length, 0);
    assert.equal(grids(doc).find((g) => g.labels.MullionKind === "final").visible, true);
});

test("a grid that fails to draw is rolled back by InDesign, not committed", () => {
    const { host, doc } = ready({});
    host.call("generate", { settings: COLUMNS });
    const before = grids(doc).length;

    const adapter = host.sandbox.Mullion.adapter;
    const realDraw = adapter.drawGrid;
    adapter.drawGrid = () => { throw new Error("ran out of memory"); };
    const r = host.call("generate", { settings: { ...COLUMNS, columns: 6 } });
    adapter.drawGrid = realDraw;

    assert.equal(r.ok, false);
    assert.equal(grids(doc).length, before, "the previous grid is untouched");
    // The failure has to escape doScript for ENTIRE_SCRIPT to roll the step back.
    const last = host.app.transactions[host.app.transactions.length - 1];
    assert.equal(last.undoMode, "UndoModes.ENTIRE_SCRIPT");
    assert.equal(last.threw, true, "the error was not swallowed inside the transaction");
});

test("dashed lines are refused when the document has no dashed stroke style", () => {
    const { host, doc } = ready({});
    doc.strokeStyles = { itemByName: (n) => (n === "Solid" ? { name: n, isValid: true } : { isValid: false }) };
    const r = host.call("generate", { settings: { ...COLUMNS, lineStyle: "dashed" } });
    assert.equal(r.ok, false, "better to say so than to draw solid lines silently");
    assert.match(r.error.message, /dashed/);
});
