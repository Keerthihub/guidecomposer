"use strict";

/*
 * A small in-memory stand-in for InDesign's scripting DOM, enough to run
 * host/index.jsx with host/indesign-adapter.jsx unmodified in a Node vm.
 *
 * Deliberately strict where mistakes would be silent in InDesign:
 *   - measurements come back in picas unless app.scriptPreferences.measurementUnit
 *     is POINTS, so forgetting to switch units breaks every coordinate test;
 *   - Y grows downward and bounds are [y1, x1, y2, x2];
 *   - locked layers and locked items refuse changes;
 *   - app.doScript records each transaction and its undo mode.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..", "..");

const ENUMS = {
    MeasurementUnits: { POINTS: "MeasurementUnits.POINTS", PICAS: "MeasurementUnits.PICAS" },
    ScriptLanguage: { JAVASCRIPT: "ScriptLanguage.JAVASCRIPT" },
    UndoModes: { ENTIRE_SCRIPT: "UndoModes.ENTIRE_SCRIPT", SCRIPT_REQUEST: "UndoModes.SCRIPT_REQUEST" },
    LocationOptions: { AT_BEGINNING: "LocationOptions.AT_BEGINNING", AT_END: "LocationOptions.AT_END" },
    HorizontalOrVertical: { HORIZONTAL: "HorizontalOrVertical.HORIZONTAL", VERTICAL: "HorizontalOrVertical.VERTICAL" },
    ColorModel: { PROCESS: "ColorModel.PROCESS" },
    SaveOptions: { NO: "SaveOptions.NO", YES: "SaveOptions.YES", ASK: "SaveOptions.ASK" },
    ColorSpace: { RGB: "ColorSpace.RGB", CMYK: "ColorSpace.CMYK" },
    EndCap: { BUTT_END_CAP: "EndCap.BUTT_END_CAP", ROUND_END_CAP: "EndCap.ROUND_END_CAP" },
    PathType: { OPEN_PATH: "PathType.OPEN_PATH", CLOSED_PATH: "PathType.CLOSED_PATH" },
    CoordinateSpaces: { INNER_COORDINATES: "CoordinateSpaces.INNER_COORDINATES" },
    AnchorPoint: { TOP_LEFT_ANCHOR: "AnchorPoint.TOP_LEFT_ANCHOR" },
    ResizeMethods: { REPLACING_CURRENT_DIMENSIONS_WITH: "ResizeMethods.REPLACING_CURRENT_DIMENSIONS_WITH" },
    SelectionOptions: { ADD_TO: "SelectionOptions.ADD_TO", REPLACE_WITH: "SelectionOptions.REPLACE_WITH" },
    NothingEnum: { NOTHING: "NothingEnum.NOTHING" },
    Leading: { AUTO: "Leading.AUTO" },
    RulerOrigin: {
        PAGE_ORIGIN: "RulerOrigin.PAGE_ORIGIN",
        SPREAD_ORIGIN: "RulerOrigin.SPREAD_ORIGIN",
        RULER_PER_PAGE: "RulerOrigin.RULER_PER_PAGE"
    },
    UserInteractionLevels: {
        INTERACT_WITH_ALL: "UserInteractionLevels.INTERACT_WITH_ALL",
        NEVER_INTERACT: "UserInteractionLevels.NEVER_INTERACT"
    },
    BaselineGridRelativeOption: {
        TOP_OF_PAGE: "BaselineGridRelativeOption.TOP_OF_PAGE",
        TOP_OF_MARGIN: "BaselineGridRelativeOption.TOP_OF_MARGIN"
    }
};

let currentApp = null;

// Points per current script unit.
function unitSize() {
    return currentApp.scriptPreferences.measurementUnit === ENUMS.MeasurementUnits.POINTS ? 1 : 12;
}
const toUnits = (points) => points / unitSize();
const fromUnits = (value) => value * unitSize();

class LockedError extends Error {}

function collection(list, extras) {
    const out = list.slice();
    out.everyItem = () => ({ getElements: () => list.slice() });
    return Object.assign(out, extras || {});
}

class Labeled {
    constructor() {
        this.labels = {};
        this.isValid = true;
    }
    insertLabel(key, value) { this.labels[key] = String(value); }
    extractLabel(key) { return Object.prototype.hasOwnProperty.call(this.labels, key) ? this.labels[key] : ""; }
}

class PageItemBase extends Labeled {
    constructor(page, layer) {
        super();
        this.page = page;
        this.parent = page;
        this.itemLayer = layer;
        this.locked = false;
        this.visible = true;
        this.name = "";
        this.strokeWeight = 1;
        this.strokeColor = null;
        this.fillColor = null;
        this.strokeType = null;
        this.endCap = ENUMS.EndCap.BUTT_END_CAP;
        this.transparencySettings = { blendingSettings: { opacity: 100 } };
        this._bounds = [0, 0, 0, 0]; // points, [y1, x1, y2, x2]
        this.paths = [new PathData(this)];
    }

    get geometricBounds() { return this._bounds.map(toUnits); }
    set geometricBounds(value) { this._bounds = value.map(fromUnits); }
    get parentPage() { return this.page; }

    assertEditable() {
        if (this.locked) throw new LockedError("The object is locked");
        if (this.itemLayer && this.itemLayer.locked) throw new LockedError("The layer is locked");
    }

    remove() {
        this.assertEditable();
        // An item inside a group leaves the group, as in InDesign.
        if (this.parent && this.parent !== this.page && Array.isArray(this.parent.children)) {
            const index = this.parent.children.indexOf(this);
            if (index !== -1) this.parent.children.splice(index, 1);
        }
        this.page.detach(this);
        this.removed = true;
    }

    move(to, by) {
        this.assertEditable();
        const [dx, dy] = by.map(fromUnits);
        this._bounds = [this._bounds[0] + dy, this._bounds[1] + dx, this._bounds[2] + dy, this._bounds[3] + dx];
        this.movedBy = [(this.movedBy || [0, 0])[0] + dx, (this.movedBy || [0, 0])[1] + dy];
    }
}

class PathData {
    constructor(owner) {
        this.owner = owner;
        this._points = [];
        this.pathType = ENUMS.PathType.OPEN_PATH;
    }
    // Points in points; each entry is [x, y] or [[lx, ly], [x, y], [rx, ry]].
    get entirePath() {
        return this._points.map((p) => (typeof p[0] === "number" ? p.map(toUnits) : p.map((q) => q.map(toUnits))));
    }
    get pathPoints() {
        return this._points.map((p) => {
            const [left, anchor, right] = typeof p[0] === "number" ? [p, p, p] : p;
            return { anchor: anchor.map(toUnits), leftDirection: left.map(toUnits), rightDirection: right.map(toUnits) };
        });
    }
    set entirePath(value) {
        this.owner.assertEditable();
        this._points = value.map((p) => (typeof p[0] === "number" ? p.map(fromUnits) : p.map((q) => q.map(fromUnits))));
        const anchors = this._points.map((p) => (typeof p[0] === "number" ? p : p[1]));
        const xs = anchors.map((a) => a[0]);
        const ys = anchors.map((a) => a[1]);
        this.owner._bounds = [Math.min(...ys), Math.min(...xs), Math.max(...ys), Math.max(...xs)];
    }
}

class GraphicLine extends PageItemBase {}
class Rectangle extends PageItemBase {}
class Polygon extends PageItemBase {
    constructor(page, layer) {
        super(page, layer);
        this.paths[0].pathType = ENUMS.PathType.CLOSED_PATH;
    }
}
class Oval extends PageItemBase {}

class InsertionPointRef {
    constructor(frame) {
        this.frame = frame;
        this.contents = "";
    }
    get geometricBounds() { throw new Error("Object does not support the property or method 'geometricBounds'"); }
    get paths() { throw new Error("Object does not support the property or method 'paths'"); }
    extractLabel() { throw new Error("Object does not support the property or method 'extractLabel'"); }
}

class TextFrame extends PageItemBase {
    constructor(page, layer, { pointSize = 10, leading = 12, autoLeading = 120, font = "Minion Pro" } = {}) {
        super(page, layer);
        this.texts = [new Text({ pointSize, leading, autoLeading, font })];
        this.contents = "";
        this._insertionPoints = [new InsertionPointRef(this)];
    }

    get insertionPoints() { return collection(this._insertionPoints); }
}

class Text {
    constructor({ pointSize, leading, autoLeading, font }) {
        this._pointSize = pointSize;
        this._leading = leading;
        this.autoLeading = autoLeading;
        this.appliedFont = { name: font };
    }
    get pointSize() { return this._pointSize; } // type sizes are always points in InDesign
    get leading() { return this._leading === ENUMS.Leading.AUTO ? ENUMS.Leading.AUTO : this._leading; }
}

class Group extends PageItemBase {
    constructor(page, layer, items) {
        super(page, layer);
        this.children = items;
        items.forEach((item) => { item.parent = this; });
    }
    get pageItems() { return collection(this.children); }
    get geometricBounds() {
        const b = this.children.map((c) => c._bounds);
        return [Math.min(...b.map((x) => x[0])), Math.min(...b.map((x) => x[1])), Math.max(...b.map((x) => x[2])), Math.max(...b.map((x) => x[3]))].map(toUnits);
    }
    ungroup() {
        this.assertEditable();
        this.page.detach(this);
        this.children.forEach((child) => {
            child.parent = this.page;
            this.page.items.push(child);
        });
        return this.children.slice();
    }
    remove() {
        this.assertEditable();
        this.children.forEach((child) => { child.removed = true; });
        super.remove();
    }
}

class Guide extends Labeled {
    constructor(page, layer, props) {
        super();
        this.page = page;
        this.parent = page;
        this.itemLayer = layer;
        this.orientation = props.orientation;
        this._location = fromUnits(props.location);
        this.fitToPage = props.fitToPage === true;
        this.locked = false;
    }
    get parentPage() { return this.page; }   // as in InDesign: a guide knows its page
    get location() { return toUnits(this._location); }
    remove() {
        if (this.itemLayer && this.itemLayer.locked) throw new LockedError("The layer is locked");
        const list = this.page.guideList;
        list.splice(list.indexOf(this), 1);
        this.removed = true;
    }
}

/*
 * The cursor sitting in text. InDesign raises an error when you read a property
 * this doesn't have, rather than returning nothing, which is the trap the
 * adapter has to survive.
 */
class InsertionPoint {
    constructor() {
        this.contents = "Heading";
    }

    get geometricBounds() { throw new Error("Object does not support the property or method 'geometricBounds'"); }
    get paths() { throw new Error("Object does not support the property or method 'paths'"); }
    extractLabel() { throw new Error("Object does not support the property or method 'extractLabel'"); }
}

class Page {
    constructor(doc, index, bounds) {
        this.doc = doc;
        this.documentOffset = index;
        this.name = String(index + 1);
        this._bounds = bounds; // points, [y1, x1, y2, x2]
        this.items = [];
        this.guideList = [];
        this.isValid = true;
        this.marginPreferences = { top: 36, bottom: 36, left: 36, right: 36, columnCount: 1, columnGutter: 12 };
        // On facing pages, odd pages are right-hand and even ones left-hand.
        this.side = index % 2 === 0 ? "PageSideOptions.RIGHT_HAND" : "PageSideOptions.LEFT_HAND";
        const adder = (Klass) => (layer, at, reference, props) => this.addItem(new Klass(this, layer || doc.activeLayer), props);
        this.rectangles = { add: adder(Rectangle) };
        this.graphicLines = { add: adder(GraphicLine) };
        this.polygons = { add: adder(Polygon) };
        this.ovals = { add: adder(Oval) };
        this.textFrames = { add: (layer, at, reference, props) => this.addItem(new TextFrame(this, layer || doc.activeLayer, props), {}) };
        this.groups = {
            add: (items, layer) => {
                if (!items || items.length < 2) throw new Error("Groups need at least two items");
                items.forEach((item) => {
                    if (item.page !== this) throw new Error("All grouped items must be on the same page");
                    this.detach(item);
                });
                const group = new Group(this, layer || items[0].itemLayer, items);
                this.items.push(group);
                return group;
            }
        };
    }

    get bounds() { return this._bounds.map(toUnits); }

    get guides() {
        return collection(this.guideList, {
            add: (layer, props) => {
                if (layer && layer.locked) throw new LockedError("The layer is locked");
                const guide = new Guide(this, layer, props);
                this.guideList.push(guide);
                return guide;
            }
        });
    }

    addItem(item, props) {
        if (item.itemLayer && item.itemLayer.locked) throw new LockedError("The layer is locked");
        if (props && props.geometricBounds) item.geometricBounds = props.geometricBounds;
        this.items.push(item);
        return item;
    }

    detach(item) {
        const i = this.items.indexOf(item);
        if (i !== -1) this.items.splice(i, 1);
    }

    resize(space, anchor, method, size) {
        if (method !== ENUMS.ResizeMethods.REPLACING_CURRENT_DIMENSIONS_WITH || anchor !== ENUMS.AnchorPoint.TOP_LEFT_ANCHOR) {
            throw new Error("unexpected resize arguments");
        }
        const [w, h] = size.map(fromUnits);
        if (w > 15552 || h > 15552) throw new Error("Invalid value");
        this._bounds = [this._bounds[0], this._bounds[1], this._bounds[0] + h, this._bounds[1] + w];
    }
}

class Layer {
    constructor(doc, name) {
        this.doc = doc;
        this.name = name;
        this.visible = true;
        this.locked = false;
        this.printable = true;
        this.isValid = true;
    }
    get pageItems() {
        return collection(this.doc.pageList.flatMap((p) => p.items).filter((item) => item.itemLayer === this));
    }
    move(where) {
        const list = this.doc.layerList;
        list.splice(list.indexOf(this), 1);
        if (where === ENUMS.LocationOptions.AT_BEGINNING) list.unshift(this);
        else list.push(this);
    }
    remove() {
        if (this.locked) throw new LockedError("The layer is locked");
        const list = this.doc.layerList;
        list.splice(list.indexOf(this), 1);
    }
}

class Document {
    constructor({ name = "Untitled-1", pages = [[0, 0, 792, 612]] } = {}) {
        this.name = name;
        this.pageList = pages.map((bounds, i) => new Page(this, i, bounds));
        this.layerList = [new Layer(this, "Layer 1")];
        this.activeLayer = this.layerList[0];
        this.colorList = [];
        this.selectionList = [];
        this.gridPreferences = {
            baselineDivision: 12,
            baselineStart: 36,
            baselineGridRelativeOption: ENUMS.BaselineGridRelativeOption.TOP_OF_PAGE
        };
        this.documentPreferences = { facingPages: false, pageWidth: "612pt", pageHeight: "792pt" };
        this._undoStack = [];
        // Master spreads exist so tests can prove GuideComposer leaves them alone.
        this.masterSpreadList = [{ pages: collection([new Page(this, 0, [0, 0, 792, 612])]) }];
        this.swatches = { itemByName: (n) => (n === "None" ? { name: "None", isValid: true } : { isValid: false }) };
        // A document's view settings: GuideComposer pins these while it reads geometry.
        this.viewPreferences = { rulerOrigin: "RulerOrigin.PAGE_ORIGIN" };
        this.zeroPoint = [0, 0];
        this.strokeStyleList = ["Solid", "Dashed", "Dotted"].map((name) => ({ name, isValid: true }));
        this.strokeStyles = {
            itemByName: (n) => this.strokeStyleList.find((st) => st.name === n) || { isValid: false },
            everyItem: () => ({ getElements: () => this.strokeStyleList.slice() })
        };
    }

    get pages() {
        const list = collection(this.pageList);
        list.add = (location) => {
            const page = new Page(this, this.pageList.length, [0, 0, 792, 612]);
            if (location === ENUMS.LocationOptions.AT_BEGINNING) {
                this.pageList.unshift(page);
            } else {
                this.pageList.push(page);
            }
            // InDesign renumbers every page after an insertion.
            this.pageList.forEach((p, i) => { p.documentOffset = i; p.name = String(i + 1); });
            return page;
        };
        return list;
    }

    get masterSpreads() { return collection(this.masterSpreadList); }

    // What the tests use to check a transaction can be undone.
    recordUndoPoint() {
        this._undoStack.push(this.pageList.map((page) => page.items.slice()));
    }

    get layers() {
        return collection(this.layerList, {
            itemByName: (n) => this.layerList.find((l) => l.name === n) || { isValid: false },
            add: (props) => {
                const layer = new Layer(this, props.name);
                Object.assign(layer, props);
                this.layerList.push(layer);
                this.activeLayer = layer;
                return layer;
            }
        });
    }

    get colors() {
        const self = this;
        const list = collection(this.colorList, {
            itemByName: (n) => this.colorList.find((c) => c.name === n) || { isValid: false },
            add: (props) => {
                const color = Object.assign({ isValid: true }, props);
                color.remove = () => {
                    const i = self.colorList.indexOf(color);
                    if (i !== -1) self.colorList.splice(i, 1);
                };
                this.colorList.push(color);
                return color;
            }
        });
        list.everyItem = () => ({ getElements: () => this.colorList.slice() });
        return list;
    }

    get pageItems() { return collection(this.pageList.flatMap((p) => p.items)); }

    // One spread per page, as in a single-page-spread document. Master spreads
    // are deliberately absent: GuideComposer must not treat master items as page grids.
    get spreads() {
        return collection(this.pageList.map((page) => ({
            get pageItems() { return collection(page.items); }
        })));
    }

    get selection() { return this.selectionList.slice(); }
    set selection(value) { this.selectionList = value ? [].concat(value) : []; }

    close() {
        const docs = currentApp._documents;
        const index = docs.indexOf(this);
        if (index !== -1) docs.splice(index, 1);
        currentApp._activePage = docs.length ? docs[0].pageList[0] : null;
    }
}

function createInDesignHost() {
    const app = {
        name: "Adobe InDesign 2026",
        _documents: [],
        transactions: [],
        version: "20.0",
        scriptPreferences: {
            measurementUnit: ENUMS.MeasurementUnits.PICAS,
            enableRedraw: true,
            userInteractionLevel: ENUMS.UserInteractionLevels.INTERACT_WITH_ALL
        },
        get documents() {
            const list = collection(this._documents);
            list.add = () => {
                const doc = new Document({ name: "Untitled-" + (this._documents.length + 1) });
                this._documents.unshift(doc);
                this._activePage = doc.pageList[0];
                return doc;
            };
            return list;
        },
        get activeDocument() { return this._documents[0]; },
        activeWindow: {
            get activePage() { return currentApp._activePage; },
            set activePage(page) { currentApp._activePage = page; }
        },
        // Undo is modelled only as far as GuideComposer relies on it: the last
        // transaction's changes are reversed by restoring what it recorded.
        undo() {
            const doc = this.activeDocument;
            if (!doc || !doc._undoStack.length) return;
            const snapshot = doc._undoStack.pop();
            doc.pageList.forEach((page, i) => { page.items = snapshot[i].slice(); });
        },
        doScript(fn, language, args, undoMode, name) {
            const record = { name, undoMode, language, threw: false };
            this.transactions.push(record);
            // ENTIRE_SCRIPT makes the whole run one undo step; the fake records
            // what the document looked like so app.undo() can restore it.
            if (this.activeDocument && undoMode === ENUMS.UndoModes.ENTIRE_SCRIPT) {
                this.activeDocument.recordUndoPoint();
            }
            try {
                return fn();
            } catch (err) {
                // InDesign rolls an ENTIRE_SCRIPT step back only when the error
                // escapes doScript, so the tests check that it did.
                record.threw = true;
                throw err;
            }
        },
        select(target, option) {
            const doc = this.activeDocument;
            if (target === ENUMS.NothingEnum.NOTHING) {
                doc.selection = [];
            } else if (option === ENUMS.SelectionOptions.ADD_TO) {
                if (target.locked) throw new LockedError("locked");
                doc.selection = doc.selection.concat([target]);
            } else {
                doc.selection = [target];
            }
        }
    };
    currentApp = app;

    const sandbox = {};
    const context = vm.createContext(sandbox);
    class File {
        constructor(p) { this.fsName = typeof p === "string" ? p : String(p); this._buffer = ""; }
        get exists() { return fs.existsSync(this.fsName); }
        open(mode) { this._buffer = ""; this._mode = mode; return true; }
        write(text) { this._buffer += text; return true; }
        close() { if (this._mode === "w") fs.writeFileSync(this.fsName, this._buffer); return true; }
        remove() { if (this.exists) fs.unlinkSync(this.fsName); return true; }
    }
    const Folder = { temp: { fsName: os.tmpdir() } };
    Object.assign(sandbox, ENUMS, {
        app,
        File,
        Folder,
        $: {
            global: sandbox,
            evalFile(file) {
                const p = typeof file === "string" ? file : file.fsName;
                return vm.runInContext(fs.readFileSync(p, "utf8"), context, { filename: p });
            }
        }
    });
    sandbox.$.evalFile(path.join(ROOT, "host/index.jsx"));

    return {
        app,
        sandbox,
        openDocument(options) {
            currentApp = app;
            const doc = new Document(options);
            app._documents.unshift(doc);
            app._activePage = doc.pageList[0];
            return doc;
        },
        setActivePage(doc, index) {
            app._activePage = doc.pageList[index];
        },
        boot() {
            currentApp = app;
            return JSON.parse(sandbox.Mullion.boot(encodeURIComponent(ROOT)));
        },
        call(method, payload) {
            currentApp = app;
            const encoded = payload === undefined ? undefined : encodeURIComponent(JSON.stringify(payload));
            return JSON.parse(sandbox.Mullion.api[method](encoded));
        }
    };
}

module.exports = { createInDesignHost, ENUMS, Rectangle, GraphicLine, TextFrame, TextSelection: InsertionPoint, Group, ROOT };
