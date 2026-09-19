"use strict";

/*
 * Runs the real ExtendScript host files against a fake Illustrator DOM.
 * Focus: the public API contract and proof that Preview and Clear only remove
 * objects GridComposer created.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createHost, PathItem, GroupItem, CompoundPathItem, TextFrame } = require("./helpers/fake-illustrator.js");

const OWNER = "com.keerthi.gridcomposer";

const COLUMNS = {
    type: "columns", units: "pt", columns: 12, columnGutter: 12,
    marginTop: 36, marginRight: 36, marginBottom: 36, marginLeft: 36,
    output: "lines", strokeColor: "#E0457B", strokeWidth: 0.5, opacity: 80, lockLayer: true
};

function ready(docOptions) {
    const host = createHost();
    assert.equal(host.boot().ok, true);
    const doc = docOptions === null ? null : host.openDocument(docOptions);
    return { host, doc };
}

function layerNamed(doc, name) {
    return doc._layers.find((l) => l.name === name);
}

function ownedGroups(doc) {
    const out = [];
    for (const layer of doc._layers) {
        for (const child of layer.children) {
            if (child.typename === "GroupItem" && child._tags.some((t) => t.name === "MullionOwner" && t.value === OWNER)) {
                out.push(child);
            }
        }
    }
    return out;
}

// Values created inside the vm sandbox have their own Array prototype.
// Grid counts for the active artboard; status also reports document-wide
// stray previews, which these assertions don't care about.
function counts(grids) {
    return { preview: grids.preview, generated: grids.generated };
}

function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

function tagsOf(item) {
    return Object.fromEntries(item._tags.map((t) => [t.name, t.value]));
}

function userPath(name) {
    const p = new PathItem();
    p.name = name;
    return p;
}

function place(container, item) {
    item.parent = container;
    container.children.unshift(item);
    return item;
}

// ------------------------------------------------------------ boot and API contract

test("API refuses calls before boot", () => {
    const host = createHost();
    const r = host.call("status");
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "NOT_READY");
});

test("boot reports a missing dependency instead of throwing", () => {
    const host = createHost();
    const r = host.boot(path.join(__dirname, "no-such-folder"));
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "MISSING_FILE");
    assert.match(r.error.message, /host\/vendor\/json2\.js/);
});

test("status without a document", () => {
    const { host } = ready(null);
    const status = host.call("status");
    assert.equal(status.ok, true);
    assert.equal(status.data.hasDocument, false);
    assert.equal(status.data.host, "illustrator");
    assert.equal(status.data.version, "0.1.0", "the panel can compare its version with the host's");
});

test("status describes the active artboard", () => {
    const { host, doc } = ready({
        artboards: [
            { name: "Cover", rect: [0, 792, 612, 0] },
            { name: "Spread", rect: [700, 792, 1924, 0] }
        ]
    });
    doc.activeArtboardIndex = 1;
    const r = host.call("status");
    assert.equal(r.ok, true);
    assert.deepEqual(r.data.artboard, { index: 1, name: "Spread", rect: [700, 792, 1924, 0], width: 1224, height: 792 });
    assert.equal(r.data.artboardCount, 2);
    assert.equal(r.data.colorSpace, "RGB");
    assert.deepEqual(counts(r.data.grids), { preview: 0, generated: 0 });
});

test("generate without a document returns NO_DOCUMENT", () => {
    const { host } = ready(null);
    const r = host.call("generate", { settings: COLUMNS });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "NO_DOCUMENT");
    assert.match(r.error.message, /Open or create a document/);
});

test("invalid settings return INVALID_SETTINGS with every field error", () => {
    const { host, doc } = ready({});
    const r = host.call("generate", { settings: { ...COLUMNS, columns: 0, marginTop: -3 } });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "INVALID_SETTINGS");
    assert.deepEqual(r.error.fields.map((f) => f.field).sort(), ["columns", "marginTop"]);
    assert.equal(ownedGroups(doc).length, 0, "nothing is drawn when validation fails");
    assert.equal(doc._layers.length, 1, "no layer is created when validation fails");
});

test("malformed payloads return BAD_PAYLOAD", () => {
    const { host } = ready({});
    for (const raw of ["%E0%A4%A", encodeURIComponent("{not json"), encodeURIComponent("42")]) {
        const r = JSON.parse(host.sandbox.Mullion.api.generate(raw));
        assert.equal(r.ok, false);
        assert.equal(r.error.code, "BAD_PAYLOAD", `payload ${raw}`);
    }
});

test("encoded payloads cannot break out of the evalScript string", () => {
    // The panel builds: Mullion.api.x("<encodeURIComponent(JSON)>").
    // encodeURIComponent never emits quotes, backslashes, or line breaks.
    const hostile = { settings: { type: '"); app.documents[0].close(); ("', note: "\\\n '`${x}`" } };
    const encoded = encodeURIComponent(JSON.stringify(hostile));
    assert.match(encoded, /^[A-Za-z0-9\-_.!~*'()%]*$/);
    assert.ok(!encoded.includes('"') && !encoded.includes("\\"));

    const { host, doc } = ready({});
    const r = host.call("generate", hostile);
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "INVALID_SETTINGS");
    assert.equal(host.app._documents.length, 1, "document is still open");
    assert.equal(doc._layers.length, 1);
});

test("unexpected DOM errors are captured as UNEXPECTED, not thrown", () => {
    const { host, doc } = ready({});
    Object.defineProperty(doc, "layers", { get() { throw new Error("boom"); } });
    const r = host.call("generate", { settings: COLUMNS });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "UNEXPECTED");
    assert.match(r.error.message, /boom/);
});

// ------------------------------------------------------------------------ drawing

test("generate draws tagged lines into a non-printing GridComposer layer", () => {
    const { host, doc } = ready({});
    const userLayer = doc._layers[0];
    const r = host.call("generate", { settings: COLUMNS });
    assert.equal(r.ok, true);
    assert.equal(r.data.shapes, 26);
    assert.equal(r.data.artboards, 1);
    assert.equal(r.data.metrics.columnWidth, 34);
    assert.deepEqual(counts(r.data.status.grids), { preview: 0, generated: 1 });

    const layer = layerNamed(doc, "GridComposer grids");
    assert.ok(layer);
    assert.equal(layer.printable, false);
    assert.equal(layer.locked, true, "lockLayer: true locks the layer after generating");
    assert.equal(doc.activeLayer, userLayer, "the user's active layer is restored");

    const [group] = ownedGroups(doc);
    const tags = tagsOf(group);
    assert.equal(tags.MullionOwner, OWNER);
    assert.equal(tags.MullionKind, "final");
    assert.equal(tags.MullionArtboard, "0");
    assert.equal(tags.MullionRegion, "artboard:0");
    assert.equal(tags.MullionSchema, "1", "grids record the schema that wrote them");
    assert.equal(tags.MullionShapes, "26", "grids record how many shapes they were drawn with");
    // The settings travel with the grid, so the document carries its recipe.
    const recorded = JSON.parse(tags.MullionSettings);
    assert.equal(recorded.schema, 1);
    assert.equal(recorded.settings.type, "columns");
    assert.equal(recorded.settings.columns, 12);
    assert.equal(group.name, "Column grid, Artboard 1");
    assert.equal(group.opacity, 80);
    assert.equal(group.children.length, 26);
    for (const p of group.children) {
        assert.equal(p.typename, "PathItem");
        assert.equal(p.note, OWNER);
        assert.equal(p.filled, false);
        assert.equal(p.stroked, true);
        assert.equal(p.strokeWidth, 0.5);
        assert.deepEqual([p.strokeColor.red, p.strokeColor.green, p.strokeColor.blue], [224, 69, 123]);
    }
    const xs = group.children.map((p) => p.points[0][0]).filter((x, i, a) => a.indexOf(x) === i);
    assert.ok(xs.includes(36) && xs.includes(70) && xs.includes(576));
    assert.equal(host.app.redrawCount > 0, true);
});

test("guides output creates guides with no stroke", () => {
    const { host, doc } = ready({});
    const r = host.call("generate", { settings: { ...COLUMNS, output: "guides", lockLayer: false } });
    assert.equal(r.ok, true);
    const [group] = ownedGroups(doc);
    for (const p of group.children) {
        assert.equal(p.guides, true);
        assert.equal(p.stroked, false);
        assert.equal(p.strokeColor, null);
    }
    assert.equal(layerNamed(doc, "GridComposer grids").locked, false);
});

test("CMYK documents receive a CMYK stroke color", () => {
    const { host, doc } = ready({ colorSpace: "CMYK" });
    assert.equal(host.call("generate", { settings: COLUMNS }).ok, true);
    const color = ownedGroups(doc)[0].children[0].strokeColor;
    assert.equal(color.typename, "CMYKColor");
    assert.deepEqual([color.cyan, color.magenta, color.yellow, color.black], [0, 80, 30, 0]);
});

test("generating into a locked, hidden GridComposer layer works and applies the lock setting", () => {
    const { host, doc } = ready({});
    assert.equal(host.call("generate", { settings: COLUMNS }).ok, true);
    const layer = layerNamed(doc, "GridComposer grids");
    layer.visible = false;
    assert.equal(layer.locked, true);
    const r = host.call("generate", { settings: { ...COLUMNS, type: "baseline", baselineSpacing: 12, lockLayer: true }, mode: "add" });
    assert.equal(r.ok, true);
    assert.equal(ownedGroups(doc).length, 2, "add mode keeps the earlier grid so types can be combined");
    assert.equal(layer.locked, true);
    assert.equal(layer.visible, true, "generating shows the grid layer so the result is visible");
});

test("the test line is an owned group that Clear removes", () => {
    const { host, doc } = ready({});
    const r = host.call("drawTestLine");
    assert.equal(r.ok, true);
    assert.deepEqual(r.data.line, [[0, 396], [612, 396]]);
    assert.equal(ownedGroups(doc).length, 1);
    assert.equal(host.call("clear").data.removed, 1);
    assert.equal(ownedGroups(doc).length, 0);
});

// ------------------------------------------------------------- preview safety

test("preview replaces only the previous preview and never a generated grid", () => {
    const { host, doc } = ready({});
    host.call("generate", { settings: COLUMNS });
    const finalGroup = ownedGroups(doc)[0];

    host.call("preview", { settings: { ...COLUMNS, columns: 6 } });
    host.call("preview", { settings: { ...COLUMNS, columns: 4 } });
    const r = host.call("preview", { settings: { ...COLUMNS, columns: 3 } });
    assert.equal(r.ok, true);
    assert.deepEqual(counts(r.data.status.grids), { preview: 1, generated: 1 });

    const groups = ownedGroups(doc);
    assert.equal(groups.length, 2);
    assert.ok(groups.includes(finalGroup), "the generated grid object is untouched");
    assert.equal(finalGroup.children.length, 26);
    const preview = groups.find((g) => tagsOf(g).MullionKind === "preview");
    assert.equal(preview.name, "Preview: Column grid, Artboard 1");
    assert.equal(preview.children.length, 8); // 3 columns with gutters: 6 edges + 2 margin lines
});

test("preview leaves the layer lock as it was; generate replaces the preview", () => {
    const { host, doc } = ready({});
    host.call("preview", { settings: { ...COLUMNS, lockLayer: true } });
    const layer = layerNamed(doc, "GridComposer grids");
    assert.equal(layer.locked, false, "preview does not lock a new layer");

    const r = host.call("generate", { settings: COLUMNS });
    assert.equal(r.ok, true);
    assert.deepEqual(counts(r.data.status.grids), { preview: 0, generated: 1 });
});

test("clearPreview removes previews on every artboard and nothing else", () => {
    const { host, doc } = ready({
        artboards: [{ name: "A", rect: [0, 792, 612, 0] }, { name: "B", rect: [700, 792, 1312, 0] }]
    });
    host.call("generate", { settings: COLUMNS });
    doc.activeArtboardIndex = 1;
    host.call("generate", { settings: COLUMNS });
    host.call("preview", { settings: COLUMNS });
    doc.activeArtboardIndex = 0; // the preview lives on artboard B, not the active one

    const r = host.call("clearPreview");
    assert.equal(r.ok, true);
    assert.equal(r.data.removed, 1);
    assert.deepEqual(ownedGroups(doc).map((g) => tagsOf(g).MullionKind), ["final", "final"]);
});

test("previews are swept from every open document, not just the active one", () => {
    const { host, doc } = ready({ name: "First" });
    host.call("generate", { settings: COLUMNS });
    host.call("preview", { settings: COLUMNS });
    const second = host.openDocument({ name: "Second" }); // becomes active

    const r = host.call("preview", { settings: COLUMNS });
    assert.equal(r.ok, true);
    assert.deepEqual(ownedGroups(doc).map((g) => tagsOf(g).MullionKind), ["final"], "old preview removed from First");
    assert.equal(ownedGroups(second).length, 1);

    assert.equal(host.call("clearPreview").data.removed, 1);
    assert.equal(ownedGroups(second).length, 0);
    assert.equal(ownedGroups(doc).length, 1, "First keeps its generated grid");
});

test("clearPreview without a document is a harmless no-op", () => {
    const { host } = ready(null);
    assert.deepEqual(host.call("clearPreview"), { ok: true, data: { hasDocument: false, removed: 0 } });
});

// --------------------------------------------------------------- clear safety

test("Clear never removes user artwork, even in the GridComposer layer or look-alike groups", () => {
    const { host, doc } = ready({});
    const userLayer = doc._layers[0];
    const art = place(userLayer, userPath("Logo"));
    host.call("generate", { settings: { ...COLUMNS, lockLayer: false } });
    const layer = layerNamed(doc, "GridComposer grids");

    // User content that only *looks* like GridComposer's.
    const stray = place(layer, userPath("Sketch"));
    const lookalike = place(layer, new GroupItem());
    lookalike.name = "Column grid, Artboard 1";
    const lookalikePath = place(lookalike, userPath("inner"));
    lookalikePath.note = OWNER; // even with a GridComposer note, the group is not tagged
    const wrongOwner = place(layer, new GroupItem());
    wrongOwner._tags.push(Object.assign({ typename: "Tag" }, { name: "MullionOwner", value: "com.someone.else" }));
    place(wrongOwner, userPath("theirs"));

    const r = host.call("clear");
    assert.equal(r.ok, true);
    assert.equal(r.data.removed, 1);
    assert.equal(r.data.rescued, 0);

    assert.ok(userLayer.children.includes(art));
    assert.ok(layer.children.includes(stray));
    assert.ok(layer.children.includes(lookalike));
    assert.ok(lookalike.children.includes(lookalikePath));
    assert.ok(layer.children.includes(wrongOwner));
    assert.ok(doc._layers.includes(layer), "a GridComposer layer holding user items is kept");
});

test("Clear moves user items out of a GridComposer group and keeps their lock and visibility", () => {
    const { host, doc } = ready({});
    host.call("generate", { settings: COLUMNS }); // lockLayer: true
    const layer = layerNamed(doc, "GridComposer grids");
    const group = ownedGroups(doc)[0];

    // Simulate a user dragging artwork into the generated group, then locking things.
    layer.locked = false;
    const lockedArt = place(group, userPath("locked art"));
    lockedArt._locked = true;
    const hiddenArt = place(group, userPath("hidden art"));
    hiddenArt._hidden = true;
    const nested = place(group, new GroupItem());
    const nestedChild = place(nested, userPath("nested child"));
    const impostor = place(group, userPath("compound path carrying a GridComposer note"));
    impostor.typename = "CompoundPathItem";
    impostor.note = OWNER;
    group._locked = true;
    layer.locked = true;
    layer.visible = false;

    const r = host.call("clear");
    assert.equal(r.ok, true);
    assert.equal(r.data.removed, 1);
    assert.equal(r.data.rescued, 4);

    assert.ok(!layer.children.includes(group), "the GridComposer group is gone");
    for (const item of [lockedArt, hiddenArt, nested, impostor]) {
        assert.equal(item.parent, layer, `${item.name || item.typename} was moved to the layer`);
    }
    assert.equal(nested.children[0], nestedChild);
    assert.equal(lockedArt.locked, true);
    assert.equal(hiddenArt.hidden, true);
    assert.equal(layer.locked, true, "layer lock restored");
    assert.equal(layer.visible, false, "layer visibility restored");
    assert.ok(doc._layers.includes(layer), "layer with rescued art is kept");
});

test("Clear finds GridComposer groups the user moved to another layer or grouped with their own artwork", () => {
    const { host, doc } = ready({});
    host.call("generate", { settings: { ...COLUMNS, lockLayer: false } });
    const group = ownedGroups(doc)[0];
    const userLayer = doc._layers.find((l) => l.name === "Layer 1");

    // Move the grid into the user's (locked) layer.
    group.parent.children.splice(group.parent.children.indexOf(group), 1);
    place(userLayer, group);
    userLayer.locked = true;

    // Pressing Cmd-G with a grid selected puts it inside a user group; it must
    // still be GridComposer's to clear, or the user could never remove it.
    host.call("generate", { settings: { ...COLUMNS, lockLayer: false }, mode: "add" });
    const second = ownedGroups(doc).find((g) => g !== group);
    const mullionLayer = layerNamed(doc, "GridComposer grids");
    const wrapper = place(userLayer, new GroupItem());
    mullionLayer.children.splice(mullionLayer.children.indexOf(second), 1);
    place(wrapper, second);

    const r = host.call("clear");
    assert.equal(r.ok, true);
    assert.equal(r.data.removed, 2, "both the moved grid and the grouped one are cleared");
    assert.ok(!userLayer.children.includes(group));
    assert.ok(!wrapper.children.includes(second), "a grid inside a user group is still cleared");
    assert.ok(userLayer.children.includes(wrapper), "the user's own group survives");
    assert.equal(userLayer.locked, true, "user layer lock restored");
});

test("Clear scopes to the target artboards", () => {
    const { host, doc } = ready({
        artboards: [{ name: "A", rect: [0, 792, 612, 0] }, { name: "B", rect: [700, 792, 1312, 0] }, { name: "C", rect: [1400, 792, 2012, 0] }]
    });
    host.call("generate", { settings: COLUMNS, target: { mode: "all" } });
    doc.activeArtboardIndex = 1;
    host.call("preview", { settings: COLUMNS });

    const r = host.call("clear");
    assert.equal(r.data.removed, 2, "active artboard B: generated + preview");
    assert.equal(r.data.clearedArtboards, 1);
    assert.deepEqual(ownedGroups(doc).map((g) => tagsOf(g).MullionArtboard).sort(), ["0", "2"]);

    const some = host.call("clear", { target: { mode: "range", range: "3" } });
    assert.equal(some.data.removed, 1);
    assert.deepEqual(ownedGroups(doc).map((g) => tagsOf(g).MullionArtboard), ["0"]);

    const all = host.call("clear", { target: { mode: "all" } });
    assert.equal(all.data.removed, 1);
    assert.equal(all.data.targetArtboards, 3);
    assert.equal(ownedGroups(doc).length, 0);
});

test("an emptied GridComposer layer is removed, but never the document's last layer", () => {
    const { host, doc } = ready({});
    host.call("generate", { settings: COLUMNS });
    assert.equal(doc._layers.length, 2);
    host.call("clear");
    assert.equal(doc._layers.length, 1);
    assert.equal(doc._layers[0].name, "Layer 1");

    // Document whose only layer is named like GridComposer's.
    const solo = ready({});
    solo.doc._layers[0].name = "GridComposer grids";
    solo.host.call("generate", { settings: COLUMNS });
    solo.host.call("clear");
    assert.equal(solo.doc._layers.length, 1, "last layer is kept");
});

test("Clear with nothing to remove leaves the document unchanged", () => {
    const { host, doc } = ready({});
    const before = doc._layers.slice();
    const r = host.call("clear");
    assert.equal(r.ok, true);
    assert.equal(r.data.removed, 0);
    assert.deepEqual(doc._layers, before);
});

test("the coordinate system is restored after drawing", () => {
    const { host } = ready({});
    host.app.coordinateSystem = "CoordinateSystem.ARTBOARDCOORDINATESYSTEM";
    assert.equal(host.call("generate", { settings: COLUMNS }).ok, true);
    assert.equal(host.app.coordinateSystem, "CoordinateSystem.ARTBOARDCOORDINATESYSTEM");
});

// ---------------------------------------------------------------- targets

// ------------------------------------------- ownership that survives editing

test("a grid belongs to the artboard it sits on, not to an artboard number", () => {
    const { host, doc } = ready({
        artboards: [
            { name: "One", rect: [0, 792, 612, 0] },
            { name: "Two", rect: [700, 792, 1312, 0] },
            { name: "Three", rect: [1400, 792, 2012, 0] }
        ]
    });
    host.call("generate", { settings: { ...COLUMNS, lockLayer: false }, target: { mode: "all" } });
    assert.equal(ownedGroups(doc).length, 3);

    // The user deletes the first artboard: every later artboard shifts down one.
    doc._artboards.splice(0, 1);
    doc.artboards.setActiveArtboardIndex(0);

    const r = host.call("clear", { target: { mode: "active" } });
    assert.equal(r.ok, true);
    assert.equal(r.data.removed, 1, "exactly one grid is cleared");
    const left = ownedGroups(doc).map((g) => g.children[0].points[0][0]);
    assert.ok(!left.some((x) => x >= 700 && x < 1312), "the grid on the current artboard is the one removed");
    assert.equal(ownedGroups(doc).length, 2);
});

test("regenerating after the artwork moves replaces its grid instead of stacking a second one", () => {
    const { host, doc } = ready({});
    const card = place(doc._layers[0], userPath("card"));
    card.setEntirePath([[100, 700], [300, 700], [300, 500], [100, 500]]);
    card.closed = true;
    card.selected = true;
    assert.equal(host.call("generate", { settings: { ...CARD, lockLayer: false }, target: { mode: "selection" } }).ok, true);
    assert.equal(ownedGroups(doc).length, 1);

    // The user nudges the card and generates again.
    card.setEntirePath([[105, 705], [305, 705], [305, 505], [105, 505]]);
    const again = host.call("generate", { settings: { ...CARD, lockLayer: false }, target: { mode: "selection" } });
    assert.equal(again.ok, true);
    assert.equal(again.data.replaced, 1, "the grid for the same object is replaced");
    assert.equal(ownedGroups(doc).length, 1, "one grid, not two");
});

test("a grid the user has edited is kept and handed back, never deleted", () => {
    const { host, doc } = ready({});
    host.call("generate", { settings: { ...COLUMNS, lockLayer: false } });
    const [group] = ownedGroups(doc);
    // The user deletes two of the grid's own lines.
    group.children.splice(0, 2);

    const r = host.call("clear");
    assert.equal(r.ok, true);
    assert.equal(r.data.removed, 0, "nothing is deleted");
    assert.equal(r.data.kept, 1, "the edited grid is reported as kept");
    const survivor = doc._layers.flatMap((l) => l.children).find((c) => c.typename === "GroupItem");
    assert.ok(survivor, "the edited grid is still in the document");
    assert.equal(tagsOf(survivor).MullionOwner, undefined, "and is no longer GridComposer's to remove");
    assert.equal(survivor.name, "Edited grid");
});

// -------------------------------------------------------- preview lifecycle

test("a preview left behind by a crash is swept when the panel next asks for status", () => {
    const { host, doc } = ready({});
    host.call("generate", { settings: { ...COLUMNS, lockLayer: false } });
    host.call("preview", { settings: { ...COLUMNS, columns: 6, lockLayer: false } });
    assert.equal(ownedGroups(doc).filter((g) => tagsOf(g).MullionKind === "preview").length, 1);
    assert.equal(ownedGroups(doc).find((g) => tagsOf(g).MullionKind === "final")._hidden, true);

    // Simulate a new session: the panel reloads, or the app was force-quit.
    host.sandbox.Mullion.previewing = false;

    const status = host.call("status");
    assert.equal(status.ok, true);
    assert.equal(status.data.recoveredPreviews, 1, "the stale preview is reported as recovered");
    assert.equal(ownedGroups(doc).filter((g) => tagsOf(g).MullionKind === "preview").length, 0);
    assert.equal(ownedGroups(doc).find((g) => tagsOf(g).MullionKind === "final")._hidden, false, "the real grid is visible again");
});

test("ending a preview puts back a grid layer the user had hidden", () => {
    const { host, doc } = ready({});
    host.call("generate", { settings: { ...COLUMNS, lockLayer: false } });
    const layer = layerNamed(doc, "GridComposer grids");
    layer.visible = false;

    host.call("preview", { settings: { ...COLUMNS, columns: 6, lockLayer: false } });
    assert.equal(layer.visible, true, "a preview has to be visible to be a preview");

    host.call("clearPreview");
    assert.equal(layer.visible, false, "the user's choice is restored when it ends");
});

// --------------------------------------------------------------- resilience

test("a grid that fails to draw leaves the previous grid intact", () => {
    const { host, doc } = ready({});
    host.call("generate", { settings: { ...COLUMNS, lockLayer: false } });
    const before = ownedGroups(doc);
    assert.equal(before.length, 1);
    const originalShapes = before[0].children.length;

    const adapter = host.sandbox.Mullion.adapter;
    const realDraw = adapter.drawGrid;
    adapter.drawGrid = () => { throw new Error("ran out of memory"); };
    const r = host.call("generate", { settings: { ...COLUMNS, columns: 6, lockLayer: false } });
    adapter.drawGrid = realDraw;

    assert.equal(r.ok, false);
    const after = ownedGroups(doc);
    assert.equal(after.length, 1, "the old grid is still there");
    assert.equal(after[0].children.length, originalShapes, "and is untouched");
});

test("every call runs in document coordinates, whatever the application was left on", () => {
    const { host, doc } = ready({});
    host.app.coordinateSystem = host.sandbox.CoordinateSystem.ARTBOARDCOORDINATESYSTEM;
    const r = host.call("generate", { settings: { ...COLUMNS, lockLayer: false } });
    assert.equal(r.ok, true);
    const xs = ownedGroups(doc)[0].children.map((p) => p.points[0][0]);
    assert.ok(xs.includes(36) && xs.includes(576), "geometry matches document coordinates");
    assert.equal(host.app.coordinateSystem, host.sandbox.CoordinateSystem.ARTBOARDCOORDINATESYSTEM, "and the user's setting is put back");
});

test("a document carries the settings that made its grid", () => {
    const { host } = ready({});
    assert.equal(host.call("documentGrid").data.found, false, "nothing to report before a grid exists");

    host.call("generate", { settings: { ...COLUMNS, columns: 7, lockLayer: false } });
    const r = host.call("documentGrid");
    assert.equal(r.ok, true);
    assert.equal(r.data.found, true);
    assert.equal(r.data.schema, 1);
    assert.equal(r.data.settings.columns, 7, "the panel can offer the settings that drew this grid");
    assert.equal(r.data.settings.type, "columns");
});

test("several grid types can be drawn over each other in one action", () => {
    const { host, doc } = ready({});
    const r = host.call("generate", { settings: { ...COLUMNS, lockLayer: false, overlayTypes: ["baseline"] } });
    assert.equal(r.ok, true, r.ok ? "" : r.error.message);
    assert.equal(r.data.artboards, 1, "one artboard, not one per overlay");
    assert.equal(r.data.layers, 2, "the main grid and one overlay");

    const groups = ownedGroups(doc);
    assert.equal(groups.length, 2);
    assert.deepEqual(groups.map((g) => g.name).sort(), ["Baseline grid, Artboard 1", "Column grid, Artboard 1"]);
    assert.equal(host.app.redrawCount > 0, true);

    // Both are GridComposer's, so both are replaced together next time.
    const again = host.call("generate", { settings: { ...COLUMNS, lockLayer: false, overlayTypes: ["baseline"] } });
    assert.equal(again.data.replaced, 2, "the whole stack is replaced, not added to");
    assert.equal(ownedGroups(doc).length, 2);

    // And cleared together.
    assert.equal(host.call("clear").data.removed, 2);
    assert.equal(ownedGroups(doc).length, 0);
});

test("an overlay that cannot be drawn stops the whole action, before anything is drawn", () => {
    const { host, doc } = ready({});
    const r = host.call("generate", {
        settings: { ...COLUMNS, lockLayer: false, overlayTypes: ["pattern"], pattern: "square", patternSize: 5000 }
    });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "INVALID_SETTINGS");
    assert.match(r.error.message, /Overlay/, "the message says which grid could not be drawn: " + r.error.message);
    assert.equal(ownedGroups(doc).length, 0, "nothing is drawn");
});

const THREE_BOARDS = {
    artboards: [
        { name: "Cover", rect: [0, 792, 612, 0] },
        { name: "Card", rect: [700, 300, 1000, 0] },
        { name: "Poster", rect: [1100, 1224, 1892, 0] }
    ]
};

test("generate on all artboards draws one tagged group per artboard", () => {
    const { host, doc } = ready(THREE_BOARDS);
    const r = host.call("generate", { settings: COLUMNS, target: { mode: "all" } });
    assert.equal(r.ok, true);
    assert.equal(r.data.artboards, 3);
    assert.equal(r.data.shapes, 78);
    const groups = ownedGroups(doc);
    assert.deepEqual(groups.map((g) => tagsOf(g).MullionArtboard).sort(), ["0", "1", "2"]);
    const poster = groups.find((g) => tagsOf(g).MullionArtboard === "2");
    assert.equal(poster.name, "Column grid, Poster");
    const minX = Math.min(...poster.children.map((p) => p.points[0][0]));
    assert.equal(minX, 1136, "poster grid starts at its own left margin");
});

test("generate on an artboard range uses 1-based numbers", () => {
    const { host, doc } = ready(THREE_BOARDS);
    const r = host.call("generate", { settings: COLUMNS, target: { mode: "range", range: "1, 3" } });
    assert.equal(r.ok, true);
    assert.deepEqual(ownedGroups(doc).map((g) => tagsOf(g).MullionArtboard).sort(), ["0", "2"]);
});

test("an invalid artboard range draws nothing and names the problem", () => {
    const { host, doc } = ready(THREE_BOARDS);
    const r = host.call("generate", { settings: COLUMNS, target: { mode: "range", range: "2-5" } });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "INVALID_TARGET");
    assert.match(r.error.message, /Artboard 5 doesn't exist/);
    assert.deepEqual(r.error.fields.map((f) => f.field), ["range"]);
    assert.equal(ownedGroups(doc).length, 0);
    assert.equal(host.call("clear", { target: { mode: "sideways" } }).error.code, "INVALID_TARGET");
});

test("if any target artboard can't fit the grid, nothing is drawn anywhere", () => {
    const { host, doc } = ready(THREE_BOARDS);
    // 12 columns with 24 pt gutters fit Cover and Poster, but not the 300 pt Card.
    const r = host.call("generate", { settings: { ...COLUMNS, columnGutter: 24 }, target: { mode: "all" } });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "INVALID_SETTINGS");
    assert.match(r.error.message, /^Card: Columns don't fit/);
    assert.equal(ownedGroups(doc).length, 0);
    assert.equal(doc._layers.length, 1, "no layer created");
});

test("requests that would draw too many shapes are refused", () => {
    const many = { artboards: Array.from({ length: 13 }, (_, i) => ({ name: `A${i + 1}`, rect: [i * 700, 792, i * 700 + 612, 0] })) };
    const { host, doc } = ready(many);
    const settings = { ...COLUMNS, type: "baseline", baselineSpacing: 1, marginTop: 0, marginBottom: 0 }; // 793 lines x 13 = 10309
    const r = host.call("generate", { settings, target: { mode: "all" } });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "TOO_MANY_SHAPES");
    assert.match(r.error.message, /10309 shapes across 13 areas/);
    assert.equal(ownedGroups(doc).length, 0);
});

test("preview on all artboards is replaced as a set", () => {
    const { host, doc } = ready(THREE_BOARDS);
    host.call("preview", { settings: COLUMNS, target: { mode: "all" } });
    assert.equal(ownedGroups(doc).length, 3);
    host.call("preview", { settings: COLUMNS });
    assert.deepEqual(ownedGroups(doc).map((g) => tagsOf(g).MullionArtboard), ["0"]);
});

// ------------------------------------------------------------- shapes

test("boxes are drawn as closed four-point paths", () => {
    const { host, doc } = ready({});
    const r = host.call("generate", { settings: { ...COLUMNS, columns: 3, output: "boxes" } });
    assert.equal(r.ok, true);
    assert.equal(r.data.shapes, 3);
    const paths = ownedGroups(doc)[0].children;
    assert.equal(paths.length, 3);
    const first = paths.find((p) => p.points[0][0] === 36);
    assert.equal(first.closed, true);
    assert.deepEqual(plain(first.points), [[36, 756], [208, 756], [208, 36], [36, 36]]);
    assert.equal(first.note, OWNER);
});

test("the golden spiral is drawn as one smooth curve with handles", () => {
    const { host, doc } = ready({ artboards: [{ name: "Golden", rect: [0, 100, 161.8034, 0] }] });
    const settings = {
        ...COLUMNS, type: "composition", compThirds: false, compSpiral: true, spiralFocus: "bottom-right",
        marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0
    };
    const r = host.call("generate", { settings });
    assert.equal(r.ok, true);
    const paths = ownedGroups(doc)[0].children;
    const spiral = paths.find((p) => p.pathPointList.length === 11);
    assert.ok(spiral, "an 11-point spiral path exists");
    assert.equal(spiral.closed, false);
    assert.deepEqual(plain(spiral.pathPointList[0].rightDirection), [0, 55.2285]);
    assert.deepEqual(plain(spiral.pathPointList[1].anchor), [100, 100]);
    assert.deepEqual(plain(spiral.pathPointList[1].leftDirection), [44.7715, 100]);
    assert.equal(spiral.pathPointList[1].pointType, "PointType.SMOOTH");
    assert.equal(spiral.pathPointList[0].pointType, "PointType.CORNER");
    assert.ok(paths.every((p) => p.note === OWNER));
});

// ---------------------------------------------------------- grid layer

test("setGridLayer hides, shows, locks and unlocks the GridComposer layer", () => {
    const { host, doc } = ready({});
    const none = host.call("setGridLayer", { visible: false });
    assert.equal(none.ok, true);
    assert.equal(none.data.changed, false, "no layer yet");
    assert.deepEqual(none.data.status.gridLayer, { exists: false, visible: true, locked: false });

    host.call("generate", { settings: { ...COLUMNS, lockLayer: false } });
    const hidden = host.call("setGridLayer", { visible: false, locked: true });
    assert.equal(hidden.data.changed, true);
    assert.deepEqual(hidden.data.status.gridLayer, { exists: true, visible: false, locked: true });
    const layer = layerNamed(doc, "GridComposer grids");
    assert.equal(layer.visible, false);
    assert.equal(layer.locked, true);

    const shown = host.call("setGridLayer", { visible: true });
    assert.deepEqual(shown.data.status.gridLayer, { exists: true, visible: true, locked: true }, "lock untouched when omitted");
    assert.equal(doc._layers[1].name, "Layer 1", "user layer untouched");
});

test("status lists every artboard for the panel's artboard picker", () => {
    const { host } = ready(THREE_BOARDS);
    const r = host.call("status");
    assert.deepEqual(r.data.artboards.map((a) => [a.index, a.name]), [[0, "Cover"], [1, "Card"], [2, "Poster"]]);
    assert.deepEqual(r.data.artboards[1].rect, [700, 300, 1000, 0]);
});

// ------------------------------------------------------ patterns and styles

function drawnGroup(host, doc, settings) {
    const r = host.call("generate", { settings: { ...COLUMNS, lockLayer: false, ...settings } });
    assert.equal(r.ok, true, r.ok ? "" : r.error.message);
    return { response: r, paths: ownedGroups(doc)[0].children };
}

test("dot grids draw filled circles with no stroke", () => {
    const { host, doc } = ready({ artboards: [{ name: "Dots", rect: [0, 50, 50, 0] }] });
    const { response, paths } = drawnGroup(host, doc, {
        type: "pattern", pattern: "dots", patternSize: 25, dotSize: 4,
        marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0
    });
    assert.equal(response.data.shapes, 9);
    assert.equal(paths.length, 9);
    const topLeft = paths.find((p) => p.ellipseBounds[0] === 52 && p.ellipseBounds[1] === -2);
    assert.ok(topLeft, "dot centered on (0, 50) with a 4 pt diameter");
    assert.deepEqual(plain(topLeft.ellipseBounds), [52, -2, 4, 4]);
    assert.equal(topLeft.filled, true);
    assert.equal(topLeft.stroked, false);
    assert.equal(topLeft.fillColor.red, 224);
    assert.ok(paths.every((p) => p.note === OWNER));
});

test("hexagons draw as closed six-point paths", () => {
    const { host, doc } = ready({ artboards: [{ name: "Hex", rect: [0, 100, 100, 0] }] });
    const { paths } = drawnGroup(host, doc, {
        type: "pattern", pattern: "hexagon", patternSize: 10,
        marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0
    });
    const hexes = paths.filter((p) => p.points.length === 6);
    assert.equal(hexes.length, 30);
    assert.ok(hexes.every((p) => p.closed === true && p.stroked === true));
});

test("radial rings draw as closed smooth curves", () => {
    const { host, doc } = ready({ artboards: [{ name: "Radial", rect: [0, 200, 200, 0] }] });
    const { paths } = drawnGroup(host, doc, {
        type: "pattern", pattern: "radial", rings: 2, spokes: 4,
        marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0
    });
    const rings = paths.filter((p) => p.pathPointList.length === 4 && p.closed);
    assert.equal(rings.length, 2);
    assert.ok(rings.every((ring) => ring.pathPointList.every((pt) => pt.pointType === "PointType.SMOOTH")));
    const outer = rings.find((ring) => ring.pathPointList[0].anchor[1] === 200);
    assert.deepEqual(plain(outer.pathPointList[0].rightDirection), [155.2285, 200]);
});

test("dashed and dotted line styles set stroke dashes and caps", () => {
    const dashed = ready({});
    const d = drawnGroup(dashed.host, dashed.doc, { lineStyle: "dashed", strokeWidth: 1 }).paths[0];
    assert.deepEqual(plain(d.strokeDashes), [4, 3]);
    assert.equal(d.strokeCap, "StrokeCap.BUTTENDCAP");

    const dotted = ready({});
    const o = drawnGroup(dotted.host, dotted.doc, { lineStyle: "dotted", strokeWidth: 1 }).paths[0];
    assert.deepEqual(plain(o.strokeDashes), [0, 3]);
    assert.equal(o.strokeCap, "StrokeCap.ROUNDENDCAP");

    const guides = ready({});
    const g = drawnGroup(guides.host, guides.doc, { lineStyle: "dashed", output: "guides" }).paths[0];
    assert.deepEqual(plain(g.strokeDashes), [], "guides have no dashes");
});

test("margin color applies only to margin lines", () => {
    const { host, doc } = ready({});
    const { paths } = drawnGroup(host, doc, { marginColorOn: true, marginColor: "#00FF00" });
    const margins = paths.filter((p) => p.points[0][1] === p.points[1][1]); // the two horizontal margin lines
    const columns = paths.filter((p) => p.points[0][0] === p.points[1][0]);
    assert.equal(margins.length, 2);
    assert.ok(margins.every((p) => p.strokeColor.green === 255 && p.strokeColor.red === 0));
    assert.ok(columns.every((p) => p.strokeColor.red === 224));
});

test("shaded gutters are filled, unstroked, semi-transparent, and drawn beneath the lines", () => {
    const { host, doc } = ready({});
    const { response, paths } = drawnGroup(host, doc, { columns: 3, shadeGutters: true, gutterColor: "#0000FF", gutterOpacity: 25 });
    assert.equal(response.data.shapes, 10); // 6 column edges + 2 margins + 2 gutters
    const gutters = paths.filter((p) => p.filled);
    assert.equal(gutters.length, 2);
    assert.ok(gutters.every((p) => p.closed && !p.stroked && p.opacity === 25 && p.fillColor.blue === 255));
    // Children are stored top-first, so gutters drawn first sit at the end.
    const group = ownedGroups(doc)[0];
    assert.ok(group.children.slice(-2).every((p) => p.filled), "gutters are at the bottom of the group");
});

// ------------------------------------------------------- replace and add

function hiddenTag(group) {
    return tagsOf(group).MullionHiddenByPreview;
}

test("generating again replaces the grid on that artboard instead of stacking", () => {
    const { host, doc } = ready({});
    host.call("generate", { settings: COLUMNS });
    host.call("generate", { settings: { ...COLUMNS, columns: 6 } });
    const r = host.call("generate", { settings: { ...COLUMNS, type: "baseline" } });
    assert.equal(r.ok, true);
    assert.equal(r.data.replaced, 1);
    const groups = ownedGroups(doc);
    assert.equal(groups.length, 1, "only the newest grid remains");
    assert.equal(groups[0].name, "Baseline grid, Artboard 1");
    assert.deepEqual(counts(r.data.status.grids), { preview: 0, generated: 1 });
});

test("add mode stacks grids so types can be combined", () => {
    const { host, doc } = ready({});
    host.call("generate", { settings: COLUMNS });
    const r = host.call("generate", { settings: { ...COLUMNS, type: "baseline" }, mode: "add" });
    assert.equal(r.data.replaced, 0);
    assert.deepEqual(ownedGroups(doc).map((g) => g.name).sort(), ["Baseline grid, Artboard 1", "Column grid, Artboard 1"]);
});

test("replacing touches only the target artboards and keeps the layer", () => {
    const { host, doc } = ready(THREE_BOARDS);
    host.call("generate", { settings: COLUMNS, target: { mode: "all" } });
    const layer = layerNamed(doc, "GridComposer grids");
    const r = host.call("generate", { settings: { ...COLUMNS, type: "baseline" }, target: { mode: "range", range: "2" } });
    assert.equal(r.data.replaced, 1);
    assert.equal(layerNamed(doc, "GridComposer grids"), layer, "the same layer is reused, not deleted and recreated");
    const byBoard = Object.fromEntries(ownedGroups(doc).map((g) => [tagsOf(g).MullionArtboard, g.name]));
    assert.deepEqual(byBoard, { 0: "Column grid, Cover", 1: "Baseline grid, Card", 2: "Column grid, Poster" });
});

test("replacing still rescues artwork dragged into the old grid", () => {
    const { host, doc } = ready({});
    host.call("generate", { settings: { ...COLUMNS, lockLayer: false } });
    const art = place(ownedGroups(doc)[0], userPath("Dragged in"));
    const r = host.call("generate", { settings: COLUMNS });
    assert.equal(r.data.rescued, 1);
    assert.equal(art.parent, layerNamed(doc, "GridComposer grids"));
});

test("a replacing preview hides the grid it would replace, and ending it shows the grid again", () => {
    const { host, doc } = ready({});
    host.call("generate", { settings: COLUMNS }); // locked layer
    const original = ownedGroups(doc)[0];

    const p = host.call("preview", { settings: { ...COLUMNS, columns: 4 } });
    assert.equal(p.ok, true);
    assert.equal(p.data.hidden, 1);
    assert.equal(original.hidden, true, "old grid hidden while previewing");
    assert.equal(hiddenTag(original), "1");
    assert.equal(layerNamed(doc, "GridComposer grids").locked, true, "layer lock restored");

    // Previewing again doesn't lose track of the hidden grid.
    host.call("preview", { settings: { ...COLUMNS, columns: 5 } });
    assert.equal(original.hidden, true);

    host.call("clearPreview");
    assert.equal(original.hidden, false, "grid shown again");
    assert.equal(hiddenTag(original), "0");
    assert.ok(ownedGroups(doc).includes(original));
});

test("generate removes grids hidden by the preview instead of showing them again", () => {
    const { host, doc } = ready({});
    host.call("generate", { settings: COLUMNS });
    host.call("preview", { settings: { ...COLUMNS, columns: 4 } });
    const r = host.call("generate", { settings: { ...COLUMNS, columns: 4 } });
    assert.equal(r.data.replaced, 1);
    const groups = ownedGroups(doc);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].hidden, false);
    assert.equal(groups[0].children.length, 10);
});

test("add-mode previews hide nothing", () => {
    const { host, doc } = ready({});
    host.call("generate", { settings: COLUMNS });
    const p = host.call("preview", { settings: { ...COLUMNS, type: "baseline" }, mode: "add" });
    assert.equal(p.data.hidden, 0);
    assert.ok(ownedGroups(doc).every((g) => !g.hidden));
});

test("grids the user hid stay hidden when a preview ends", () => {
    const { host, doc } = ready({});
    host.call("generate", { settings: { ...COLUMNS, lockLayer: false } });
    const mine = ownedGroups(doc)[0];
    mine._hidden = true; // hidden by the user in the Layers panel
    host.call("preview", { settings: COLUMNS });
    host.call("clearPreview");
    assert.equal(mine.hidden, true);
});

test("switching documents while previewing restores the first document's hidden grid", () => {
    const { host, doc } = ready({ name: "First" });
    host.call("generate", { settings: COLUMNS });
    host.call("preview", { settings: { ...COLUMNS, columns: 3 } });
    const first = ownedGroups(doc).find((g) => tagsOf(g).MullionKind === "final");
    assert.equal(first.hidden, true);

    const second = host.openDocument({ name: "Second" });
    host.call("preview", { settings: COLUMNS });
    assert.equal(first.hidden, false, "first document's grid is visible again");
    assert.equal(ownedGroups(second).length, 1);
});

// ------------------------------------------------------- grids inside objects

function selectedBox(doc, bounds, name) {
    const item = place(doc._layers[doc._layers.length - 1], userPath(name || "Card"));
    item._bounds = bounds;
    item.selected = true;
    return item;
}

const CARD = { ...COLUMNS, columns: 2, columnGutter: 10, marginTop: 10, marginRight: 10, marginBottom: 10, marginLeft: 10 };

test("status reports selected objects that can hold a grid", () => {
    const { host, doc } = ready({});
    selectedBox(doc, [100, 700, 300, 500]);
    const r = host.call("status");
    assert.equal(r.data.selection.count, 1);
    assert.deepEqual(plain(r.data.selection.objects), [{ rect: [100, 700, 300, 500], artboard: 0 }]);
});

test("the selection target draws one grid inside each selected object", () => {
    const { host, doc } = ready({});
    selectedBox(doc, [100, 700, 300, 500], "Card A");
    selectedBox(doc, [320, 700, 520, 500], "Card B");
    const r = host.call("generate", { settings: CARD, target: { mode: "selection" } });
    assert.equal(r.ok, true, r.ok ? "" : r.error.message);
    assert.equal(r.data.artboards, 2);
    const groups = ownedGroups(doc);
    assert.deepEqual(groups.map((g) => tagsOf(g).MullionRegion).sort(), ["object:100,700,300,500", "object:320,700,520,500"]);
    assert.ok(groups.every((g) => g.name === "Column grid, Object on Artboard 1"));
    const cardA = groups.find((g) => tagsOf(g).MullionRegion === "object:100,700,300,500");
    const xsA = [...new Set(cardA.children.map((p) => p.points[0][0]))].sort((a, b) => a - b);
    assert.deepEqual(xsA, [110, 195, 205, 290], "2 columns inside the 200 pt card with 10 pt margins");
});

test("regenerating inside an object replaces only that object's grid, not the artboard grid", () => {
    const { host, doc } = ready({});
    host.call("generate", { settings: COLUMNS });
    const card = selectedBox(doc, [100, 700, 300, 500]);
    host.call("generate", { settings: CARD, target: { mode: "selection" } });
    const r = host.call("generate", { settings: { ...CARD, columns: 3 }, target: { mode: "selection" } });
    assert.equal(r.data.replaced, 1);
    const regions = ownedGroups(doc).map((g) => tagsOf(g).MullionRegion).sort();
    assert.deepEqual(regions, ["artboard:0", "object:100,700,300,500"]);
    assert.ok(card.parent, "the user's object is untouched");
});

test("clearing the selection target removes only grids inside the selected objects", () => {
    const { host, doc } = ready({});
    host.call("generate", { settings: COLUMNS });
    selectedBox(doc, [100, 700, 300, 500]);
    host.call("generate", { settings: CARD, target: { mode: "selection" } });
    const r = host.call("clear", { target: { mode: "selection" } });
    assert.equal(r.data.removed, 1);
    assert.deepEqual(ownedGroups(doc).map((g) => tagsOf(g).MullionRegion), ["artboard:0"]);
});

test("clearing an artboard also removes grids inside objects on it", () => {
    const { host, doc } = ready({});
    host.call("generate", { settings: COLUMNS });
    selectedBox(doc, [100, 700, 300, 500]);
    host.call("generate", { settings: CARD, target: { mode: "selection" } });
    assert.equal(host.call("clear").data.removed, 2);
});

test("the selection target needs a selection and ignores GridComposer's own grids", () => {
    const { host, doc } = ready({});
    const none = host.call("generate", { settings: CARD, target: { mode: "selection" } });
    assert.equal(none.error.code, "NO_SELECTION");
    host.call("generate", { settings: COLUMNS, lockLayer: false });
    ownedGroups(doc)[0].children[0].selected = true; // a grid line
    assert.equal(host.call("status").data.selection.count, 0);
});

test("objects too small for the margins are named in the error", () => {
    const { host, doc } = ready({});
    selectedBox(doc, [100, 700, 115, 500]);
    const r = host.call("generate", { settings: CARD, target: { mode: "selection" } });
    assert.equal(r.error.code, "INVALID_SETTINGS");
    assert.match(r.error.message, /less than the object width of 15 pt/);
});

// ----------------------------------------------------------------- resizing

test("resizeArtboards keeps the top-left corner and converts units", () => {
    const { host, doc } = ready(THREE_BOARDS);
    doc.activeArtboardIndex = 1;
    const r = host.call("resizeArtboards", { width: 210, height: 297, units: "mm" });
    assert.equal(r.ok, true, r.ok ? "" : r.error.message);
    assert.equal(r.data.resized, 1);
    const [left, top, right, bottom] = doc._artboards[1].artboardRect;
    assert.deepEqual([left, top], [700, 300], "top-left corner stays put");
    assert.ok(Math.abs(right - left - 595.2756) < 1e-3 && Math.abs(top - bottom - 841.8898) < 1e-3, "210 x 297 mm in points");
    assert.deepEqual(plain(doc._artboards[0].artboardRect), [0, 792, 612, 0], "other artboards untouched");
});

test("resizeArtboards applies to all artboards and validates sizes", () => {
    const { host, doc } = ready(THREE_BOARDS);
    const r = host.call("resizeArtboards", { width: 1080, height: 1080, units: "px", target: { mode: "all" } });
    assert.equal(r.data.resized, 3);
    assert.deepEqual(doc._artboards.map((a) => a.artboardRect[2] - a.artboardRect[0]), [1080, 1080, 1080]);
    assert.equal(host.call("resizeArtboards", { width: 0, height: 10, units: "pt" }).error.code, "INVALID_SIZE");
    assert.equal(host.call("resizeArtboards", { width: 10, height: 10, units: "cm" }).error.code, "INVALID_SIZE");
    assert.equal(host.call("resizeArtboards", { width: 10, height: 10, units: "pt", target: { mode: "selection" } }).error.code, "INVALID_TARGET");
});

// ------------------------------------------------------------------ alignment

test("alignSelection reports, selects, and snaps off-grid objects", () => {
    const { host, doc } = ready({});
    const settings = { ...COLUMNS, columns: 3, columnGutter: 12 }; // column edges 36, 208, 220, 392, 404, 576
    const onGrid = selectedBox(doc, [36, 756, 208, 600], "On grid");
    const offGrid = selectedBox(doc, [40, 700, 205, 500], "Off grid"); // right edge 3 pt from 208; top 56 below 756

    const check = host.call("alignSelection", { settings, action: "check" });
    assert.equal(check.ok, true, check.ok ? "" : check.error.message);
    assert.deepEqual([check.data.checked, check.data.offGrid, check.data.maxOffset], [2, 1, 56]);

    host.call("alignSelection", { settings, action: "select" });
    assert.equal(onGrid.selected, false);
    assert.equal(offGrid.selected, true);

    onGrid.selected = true;
    const snap = host.call("alignSelection", { settings, action: "snap" });
    assert.equal(snap.data.moved, 1);
    assert.deepEqual(plain(offGrid.geometricBounds), [43, 756, 208, 556]);
    assert.equal(host.call("alignSelection", { settings, action: "check" }).data.offGrid, 0);
});

test("snapping skips locked objects and needs a selection", () => {
    const { host, doc } = ready({});
    const locked = selectedBox(doc, [40, 700, 205, 500]);
    locked._locked = true;
    const r = host.call("alignSelection", { settings: COLUMNS, action: "snap" });
    assert.equal(r.data.moved, 0);
    assert.equal(r.data.skipped, 1);
    doc.selection = null;
    assert.equal(host.call("alignSelection", { settings: COLUMNS }).error.code, "NO_SELECTION");
});

// ------------------------------------------------------------- text metrics

test("textMetrics reads leading from a selected text frame or edited text", () => {
    const { host, doc } = ready({});
    const frame = place(doc._layers[0], new TextFrame({ size: 11, leading: 14, font: "Helvetica Neue" }));
    frame.selected = true;
    assert.deepEqual(host.call("textMetrics").data, { size: 11, leading: 14, autoLeading: false, font: "Helvetica Neue" });

    doc.selection = new TextFrame({ size: 10, autoLeading: true, autoLeadingAmount: 125 }).textRange;
    assert.deepEqual(host.call("textMetrics").data, { size: 10, leading: 12.5, autoLeading: true, font: "Helvetica" });

    doc.selection = null;
    assert.equal(host.call("textMetrics").error.code, "NO_TEXT");
});

// -------------------------------------------------- baseline, ratios, blocks

test("blocks are drawn as filled translucent rectangles beneath the lines", () => {
    const { host, doc } = ready({});
    const r = host.call("generate", {
        settings: { ...COLUMNS, type: "modular", columns: 4, rows: 4, blocks: [{ column: 1, row: 1, columns: 2, rows: 1 }] }
    });
    assert.equal(r.ok, true, r.ok ? "" : r.error.message);
    const group = ownedGroups(doc)[0];
    const blocks = group.children.filter((p) => p.filled);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].opacity, 20);
    assert.equal(blocks[0].stroked, false);
    assert.equal(group.children[group.children.length - 1], blocks[0], "block sits beneath the lines");
});

test("column grids with a baseline and unequal widths draw in one group", () => {
    const { host, doc } = ready({});
    const r = host.call("generate", {
        settings: { ...COLUMNS, columnRatios: "2 1", addBaseline: true, baselineSpacing: 24, baselineOffset: 0 }
    });
    assert.equal(r.ok, true, r.ok ? "" : r.error.message);
    assert.deepEqual(plain(r.data.metrics.columnWidths), [352, 176]);
    assert.equal(r.data.metrics.baselineCount, 31);
    assert.equal(ownedGroups(doc).length, 1);
});

// ------------------------------------------------------------ construction

const KAPPA = 0.5522847498307936;
function circleItem(cx, cy, r) {
    const path = new PathItem();
    const k = KAPPA * r;
    path.setEntirePath([[cx, cy + r], [cx + r, cy], [cx, cy - r], [cx - r, cy]]);
    const handles = [
        [[cx - k, cy + r], [cx + k, cy + r]],
        [[cx + r, cy + k], [cx + r, cy - k]],
        [[cx + k, cy - r], [cx - k, cy - r]],
        [[cx - r, cy - k], [cx - r, cy + k]]
    ];
    path.pathPointList.forEach((pt, i) => { pt.leftDirection = handles[i][0]; pt.rightDirection = handles[i][1]; });
    path.closed = true;
    return path;
}

const CONSTRUCT = {
    ...COLUMNS, conBounds: true, conKeylines: true, conCircles: true, conExtend: "artboard",
    conBoundsColor: "#888888", conKeylineColor: "#0000FF", conCircleColor: "#FF0000"
};

test("construction lines for a selected mark: bounds, key lines, fitted circle, colored by kind", () => {
    const { host, doc } = ready({});
    const mark = place(doc._layers[0], circleItem(306, 396, 100));
    mark.selected = true;
    const geometry = host.call("selectionGeometry");
    assert.equal(geometry.data.paths.length, 1);
    assert.equal(geometry.data.paths[0].points.length, 4);

    const r = host.call("generate", { settings: CONSTRUCT, kind: "construction" });
    assert.equal(r.ok, true, r.ok ? "" : r.error.message);
    const [group] = ownedGroups(doc);
    assert.equal(group.name, "Construction lines, Artwork on Artboard 1");
    assert.equal(tagsOf(group).MullionRegion, "construction:206,496,406,296");
    const ring = group.children.find((p) => p.closed && p.pathPointList.length === 4);
    assert.ok(ring, "fitted circle drawn");
    assert.deepEqual([ring.strokeColor.red, ring.strokeColor.blue], [255, 0]);
    const keyline = group.children.find((p) => !p.closed && p.points[0][0] === 306 && p.points[1][0] === 306);
    assert.deepEqual(plain(keyline.points), [[306, 792], [306, 0]], "vertical key line through the center, across the artboard");
    assert.equal(keyline.strokeColor.blue, 255);
    assert.ok(doc._layers.some((l) => l.children.includes(mark)), "the mark itself is untouched");
});

test("construction reads groups and compound paths, replaces itself, and clears without touching grids", () => {
    const { host, doc } = ready({});
    host.call("generate", { settings: COLUMNS });
    const outer = circleItem(306, 396, 120);
    const inner = circleItem(306, 396, 60);
    const logo = place(doc._layers[doc._layers.length - 1], new GroupItem());
    const donut = new CompoundPathItem([outer, inner]);
    donut.parent = logo;
    logo.children.push(donut);
    logo._bounds = [186, 516, 426, 276];
    logo.selected = true;

    const first = host.call("generate", { settings: CONSTRUCT, kind: "construction" });
    assert.equal(first.ok, true, first.ok ? "" : first.error.message);
    const construction = ownedGroups(doc).find((g) => tagsOf(g).MullionRegion.startsWith("construction:"));
    assert.equal(construction.children.filter((p) => p.closed).length, 2, "both circles found inside the group");
    assert.equal(host.call("generate", { settings: CONSTRUCT, kind: "construction" }).data.replaced, 1);

    const cleared = host.call("clear", { kind: "construction" });
    assert.equal(cleared.data.removed, 1);
    assert.deepEqual(ownedGroups(doc).map((g) => tagsOf(g).MullionRegion), ["artboard:0"], "the column grid stays");
});

test("construction explains text and empty selections", () => {
    const { host, doc } = ready({});
    assert.match(host.call("generate", { settings: CONSTRUCT, kind: "construction" }).error.message, /Select a logo or artwork/);
    const text = place(doc._layers[0], new TextFrame({}));
    text._bounds = [100, 700, 300, 650];
    text.selected = true;
    assert.match(host.call("generate", { settings: CONSTRUCT, kind: "construction" }).error.message, /Convert the text to outlines/);
});
