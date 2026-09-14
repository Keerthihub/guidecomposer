"use strict";

/*
 * A small in-memory stand-in for the Illustrator scripting DOM, just large
 * enough to run host/index.jsx and host/illustrator-adapter.jsx unmodified in
 * a Node vm context.
 *
 * It enforces the restrictions that matter for safety tests:
 *   - items inside locked or hidden layers/groups cannot be added, removed or moved;
 *   - locked or hidden items cannot be removed or moved;
 *   - layer.groupItems includes nested groups (the adapter must filter by parent).
 */

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..", "..");

const ENUMS = {
    DocumentColorSpace: { RGB: "DocumentColorSpace.RGB", CMYK: "DocumentColorSpace.CMYK" },
    ElementPlacement: {
        PLACEBEFORE: "ElementPlacement.PLACEBEFORE",
        PLACEAFTER: "ElementPlacement.PLACEAFTER",
        PLACEATBEGINNING: "ElementPlacement.PLACEATBEGINNING",
        PLACEATEND: "ElementPlacement.PLACEATEND",
        INSIDE: "ElementPlacement.INSIDE"
    },
    CoordinateSystem: {
        DOCUMENTCOORDINATESYSTEM: "CoordinateSystem.DOCUMENTCOORDINATESYSTEM",
        ARTBOARDCOORDINATESYSTEM: "CoordinateSystem.ARTBOARDCOORDINATESYSTEM"
    },
    ImageColorSpace: { RGB: "ImageColorSpace.RGB", CMYK: "ImageColorSpace.CMYK" },
    PointType: { SMOOTH: "PointType.SMOOTH", CORNER: "PointType.CORNER" },
    StrokeCap: { BUTTENDCAP: "StrokeCap.BUTTENDCAP", ROUNDENDCAP: "StrokeCap.ROUNDENDCAP", PROJECTINGENDCAP: "StrokeCap.PROJECTINGENDCAP" },
    ColorConvertPurpose: { defaultpurpose: "ColorConvertPurpose.defaultpurpose" }
};

class LockedError extends Error {
    constructor(what) {
        super(`Target ${what} cannot be modified`);
    }
}

function collection(items, add) {
    const out = items.slice();
    if (add) out.add = add;
    return out;
}

class Tag {
    constructor() {
        this.typename = "Tag";
        this.name = "";
        this.value = "";
    }
}

class PageItem {
    constructor(typename) {
        this.typename = typename;
        this.parent = null;
        this.name = "";
        this.note = "";
        this.opacity = 100;
        this._locked = false;
        this._hidden = false;
        this._tags = [];
        this._bounds = null; // [left, top, right, bottom] for items without points
        this.selected = false;
    }

    get geometricBounds() {
        return this._bounds ? this._bounds.slice() : null;
    }

    translate(dx, dy) {
        if (this._bounds) {
            this._bounds = [this._bounds[0] + dx, this._bounds[1] + dy, this._bounds[2] + dx, this._bounds[3] + dy];
        }
        this.translated = (this.translated || [0, 0]);
        this.translated = [this.translated[0] + dx, this.translated[1] + dy];
    }

    get tags() {
        return collection(this._tags, () => {
            const t = new Tag();
            this._tags.push(t);
            return t;
        });
    }

    get locked() { return this._locked; }
    set locked(v) { assertEditableContainer(this.parent); this._locked = !!v; }
    get hidden() { return this._hidden; }
    set hidden(v) { assertEditableContainer(this.parent); this._hidden = !!v; }

    get layer() {
        let p = this.parent;
        while (p && p.typename !== "Layer") p = p.parent;
        return p;
    }

    remove() {
        if (this._locked || this._hidden) throw new LockedError("item");
        assertEditableContainer(this.parent);
        detach(this);
    }

    move(relative, placement) {
        if (this._locked || this._hidden) throw new LockedError("item");
        assertEditableContainer(this.parent);
        if (placement !== ENUMS.ElementPlacement.PLACEBEFORE) {
            throw new Error("fake Illustrator only supports PLACEBEFORE");
        }
        const target = relative.parent;
        assertEditableContainer(target);
        detach(this);
        const index = target.children.indexOf(relative);
        target.children.splice(index, 0, this);
        this.parent = target;
        return this;
    }
}

class PathItem extends PageItem {
    constructor() {
        super("PathItem");
        this.points = [];
        this.pathPointList = [];
        this.closed = false;
        this.filled = true;
        this.stroked = true;
        this.guides = false;
        this.strokeColor = null;
        this.strokeWidth = 1;
        this.strokeDashes = [];
        this.strokeCap = ENUMS.StrokeCap.BUTTENDCAP;
        this.fillColor = null;
        this.ellipseBounds = null;
    }

    setEntirePath(points) {
        this.points = points.map((p) => [p[0], p[1]]);
        this.pathPointList = this.points.map((anchor) => ({
            typename: "PathPoint",
            anchor: anchor.slice(),
            leftDirection: anchor.slice(),
            rightDirection: anchor.slice(),
            pointType: ENUMS.PointType.CORNER
        }));
    }

    get pathPoints() {
        return collection(this.pathPointList);
    }

    get geometricBounds() {
        if (this._bounds || !this.points.length) {
            return super.geometricBounds;
        }
        const xs = this.points.map((p) => p[0]);
        const ys = this.points.map((p) => p[1]);
        return [Math.min(...xs), Math.max(...ys), Math.max(...xs), Math.min(...ys)];
    }

    translate(dx, dy) {
        this.points = this.points.map((p) => [p[0] + dx, p[1] + dy]);
        super.translate(dx, dy);
    }
}

class CompoundPathItem extends PageItem {
    constructor(paths) {
        super("CompoundPathItem");
        this.children = paths;
        paths.forEach((p) => { p.parent = this; });
    }
    get pathItems() { return collection(this.children); }
    get geometricBounds() {
        const b = this.children.map((c) => c.geometricBounds);
        return [Math.min(...b.map((x) => x[0])), Math.max(...b.map((x) => x[1])), Math.max(...b.map((x) => x[2])), Math.min(...b.map((x) => x[3]))];
    }
}

class TextFrame extends PageItem {
    constructor({ size = 10, leading = 12, autoLeading = false, autoLeadingAmount = 120, font = "Helvetica" } = {}) {
        super("TextFrame");
        const characterAttributes = { size, leading, autoLeading, textFont: { name: font } };
        const paragraphAttributes = { autoLeadingAmount };
        this.textRange = { typename: "TextRange", characterAttributes, paragraphAttributes };
    }
}

class GroupItem extends PageItem {
    constructor() {
        super("GroupItem");
        this.children = [];
    }

    get pageItems() { return collection(this.children); }
    get pathItems() {
        const list = collection(this.children.filter((c) => c.typename === "PathItem"), () => addChild(this, new PathItem()));
        // ellipse(top, left, width, height): a closed four-point circle.
        list.ellipse = (top, left, width, height) => {
            const p = addChild(this, new PathItem());
            p.setEntirePath([[left + width / 2, top], [left + width, top - height / 2], [left + width / 2, top - height], [left, top - height / 2]]);
            p.closed = true;
            p.ellipseBounds = [top, left, width, height];
            return p;
        };
        return list;
    }
    get groupItems() { return collection(this.children.filter((c) => c.typename === "GroupItem"), () => addChild(this, new GroupItem())); }
}

class Layer {
    constructor(doc) {
        this.typename = "Layer";
        this.document = doc;
        this.parent = doc;
        this.name = "Layer";
        this.locked = false;
        this.visible = true;
        this.printable = true;
        this.children = [];
        this.sublayers = [];
    }

    get pageItems() { return collection(this.children); }
    get pathItems() { return collection(this.children.filter((c) => c.typename === "PathItem"), () => addChild(this, new PathItem())); }
    // Like Illustrator, include nested groups so callers must check parent.
    get groupItems() {
        const all = [];
        const visit = (container) => {
            for (const child of container.children) {
                if (child.typename === "GroupItem") {
                    all.push(child);
                    visit(child);
                }
            }
        };
        visit(this);
        return collection(all, () => addChild(this, new GroupItem()));
    }
    get layers() { return collection(this.sublayers); }

    remove() {
        if (this.locked) throw new LockedError("layer");
        const list = this.document._layers;
        list.splice(list.indexOf(this), 1);
        if (this.document._activeLayer === this) this.document._activeLayer = list[0] || null;
    }
}

function assertEditableContainer(container) {
    let c = container;
    while (c && c.typename !== "Document") {
        if (c.typename === "Layer" && (c.locked || !c.visible)) throw new LockedError("layer");
        if (c.typename === "GroupItem" && (c._locked || c._hidden)) throw new LockedError("group");
        c = c.parent;
    }
}

function addChild(container, item) {
    assertEditableContainer(container);
    item.parent = container;
    container.children.unshift(item);
    return item;
}

function detach(item) {
    const siblings = item.parent.children;
    siblings.splice(siblings.indexOf(item), 1);
    item.parent = null;
}

class Document {
    constructor({ name = "Untitled-1", colorSpace = "RGB", artboards } = {}) {
        this.typename = "Document";
        this.name = name;
        this.documentColorSpace = ENUMS.DocumentColorSpace[colorSpace];
        this._layers = [];
        const first = new Layer(this);
        first.name = "Layer 1";
        this._layers.push(first);
        this._activeLayer = first;
        this._artboards = (artboards || [{ name: "Artboard 1", rect: [0, 792, 612, 0] }]).map((a) => ({
            typename: "Artboard",
            name: a.name,
            artboardRect: a.rect.slice()
        }));
        this.activeArtboardIndex = 0;
    }

    get layers() {
        return collection(this._layers, () => {
            const layer = new Layer(this);
            layer.name = `Layer ${this._layers.length + 1}`;
            this._layers.unshift(layer);
            this._activeLayer = layer;
            return layer;
        });
    }

    get selection() {
        if (this._textSelection) return this._textSelection;
        const found = [];
        const visit = (container) => {
            for (const child of container.children) {
                if (child.selected) found.push(child);
                if (child.children) visit(child);
            }
        };
        this._layers.forEach(visit);
        return found;
    }

    set selection(value) {
        this._textSelection = null;
        const visit = (container) => {
            for (const child of container.children) {
                child.selected = false;
                if (child.children) visit(child);
            }
        };
        this._layers.forEach(visit);
        if (value && value.typename === "TextRange") {
            this._textSelection = value;
        } else if (value && value.length) {
            value.forEach((item) => { item.selected = true; });
        }
    }

    get activeLayer() { return this._activeLayer; }
    set activeLayer(layer) { this._activeLayer = layer; }

    get artboards() {
        const list = collection(this._artboards);
        list.getActiveArtboardIndex = () => this.activeArtboardIndex;
        return list;
    }

    close() {
        const docs = this.app._documents;
        docs.splice(docs.indexOf(this), 1);
    }
}

class RGBColor { constructor() { this.typename = "RGBColor"; this.red = 0; this.green = 0; this.blue = 0; } }
class CMYKColor { constructor() { this.typename = "CMYKColor"; this.cyan = 0; this.magenta = 0; this.yellow = 0; this.black = 0; } }

/*
 * Creates a vm context with a fake Illustrator and loads host/index.jsx.
 * Returns { context, app, openDocument, boot, call }.
 */
function createHost() {
    const app = {
        name: "Adobe Illustrator",
        _documents: [],
        coordinateSystem: ENUMS.CoordinateSystem.DOCUMENTCOORDINATESYSTEM,
        redrawCount: 0,
        get documents() { return collection(this._documents); },
        get activeDocument() { return this._documents[0]; },
        redraw() { this.redrawCount++; },
        convertSampleColor() { return [0, 80, 30, 0]; }
    };

    const sandbox = {};
    const context = vm.createContext(sandbox);

    class File {
        constructor(p) { this.fsName = p; }
        get exists() { return fs.existsSync(this.fsName); }
    }

    Object.assign(sandbox, ENUMS, {
        app,
        File,
        RGBColor,
        CMYKColor,
        $: {
            global: sandbox,
            evalFile(file) {
                const p = typeof file === "string" ? file : file.fsName;
                return vm.runInContext(fs.readFileSync(p, "utf8"), context, { filename: p });
            }
        }
    });

    sandbox.$.evalFile(path.join(ROOT, "host/index.jsx"));

    function openDocument(options) {
        const doc = new Document(options);
        doc.app = app;
        app._documents.unshift(doc);
        return doc;
    }

    function boot(root = ROOT) {
        return JSON.parse(sandbox.Mullion.boot(encodeURIComponent(root)));
    }

    // Calls a public API method the same way the panel does: with a URI-encoded JSON payload.
    function call(method, payload) {
        const encoded = payload === undefined ? undefined : encodeURIComponent(JSON.stringify(payload));
        const raw = sandbox.Mullion.api[method](encoded);
        return JSON.parse(raw);
    }

    return { context, sandbox, app, openDocument, boot, call, classes: { PathItem, GroupItem, Layer } };
}

module.exports = { createHost, PathItem, GroupItem, CompoundPathItem, TextFrame, ROOT };
