/*
 * Mullion InDesign adapter (ExtendScript, ES3 only).
 *
 * The InDesign counterpart of illustrator-adapter.jsx: the same interface, used
 * by host/index.jsx, over InDesign's scripting DOM. Pages play the role of
 * artboards.
 *
 * Coordinates
 *   InDesign measures Y downward and reports bounds as [y1, x1, y2, x2]. The grid
 *   core works in Illustrator's Y-up rectangles [left, top, right, bottom], so
 *   page bounds are converted with Y negated, and shapes are converted back when
 *   drawn. All script measurements are forced to points while Mullion runs.
 *
 * Ownership model (same rules as Illustrator)
 *   - Every grid is one Group (or a single item) labeled with owner, kind, page
 *     index, and region via insertLabel. Every item Mullion draws carries the
 *     owner label too.
 *   - Only labeled grids are removed. A grid is ungrouped first and only items
 *     carrying the owner label are deleted, so artwork a user added survives.
 *   - Guides can't be grouped, so each guide carries the labels itself.
 *
 * Undo: every change runs inside app.doScript with UndoModes.ENTIRE_SCRIPT, so
 * one Undo reverses one Mullion action.
 *
 * Not yet verified in InDesign itself; see README.
 */
(function (M) {
    var A = {};

    var LAYER_NAME = "Mullion grids";
    var LABEL_OWNER = "MullionOwner";
    var LABEL_KIND = "MullionKind";
    var LABEL_PAGE = "MullionArtboard";
    var LABEL_REGION = "MullionRegion";
    var LABEL_HIDDEN = "MullionHiddenByPreview";
    var LABEL_SCHEMA = "MullionSchema";
    var LABEL_SETTINGS = "MullionSettings";
    var LABEL_SHAPES = "MullionShapes";
    var LABEL_LAYER_HIDDEN = "MullionLayerWasHidden";
    var SCHEMA = 1;
    var ORPHAN = -1;
    var BLOCK_OPACITY = 20;
    var MAX_SELECTION = 200;

    var GRID_LABELS = {
        columns: "Column grid",
        modular: "Modular grid",
        baseline: "Baseline grid",
        composition: "Composition guides",
        pattern: "Pattern grid",
        construction: "Construction lines"
    };

    A.HOST = "indesign";
    A.AREA_NOUN = "page";
    A.SCHEMA = SCHEMA;
    A.ORPHAN = ORPHAN;
    A.LAYER_NAME = LAYER_NAME;

    // --------------------------------------------------------------- context

    A.activeDocument = function () {
        return app.documents.length ? app.activeDocument : null;
    };

    A.openDocuments = function () {
        var docs = [];
        for (var i = 0; i < app.documents.length; i++) {
            docs.push(app.documents[i]);
        }
        return docs;
    };

    // Runs fn with points as the script unit, as one undo step, then restores settings.
    A.transaction = function (label, fn) {
        var prefs = app.scriptPreferences;
        var previousUnit = prefs.measurementUnit;
        var previousRedraw = prefs.enableRedraw;
        var result;
        var failure = null;
        prefs.measurementUnit = MeasurementUnits.POINTS;
        prefs.enableRedraw = false;
        try {
            /*
             * The error must escape doScript, not be caught inside it: catching
             * it there tells InDesign the script finished, and the half-drawn
             * work is committed instead of rolled back by ENTIRE_SCRIPT.
             */
            app.doScript(function () {
                result = fn();
            }, ScriptLanguage.JAVASCRIPT, [], UndoModes.ENTIRE_SCRIPT, "Mullion: " + label);
        } catch (err) {
            failure = err;
        } finally {
            prefs.measurementUnit = previousUnit;
            prefs.enableRedraw = previousRedraw;
        }
        if (failure) {
            throw failure;
        }
        return result;
    };

    /*
     * Every endpoint runs inside this: points as the script unit, a ruler the
     * geometry can rely on, and no modal alerts. InDesign reports bounds
     * relative to the ruler zero point, so a document whose ruler was moved
     * would otherwise place grids a page-width away.
     */
    A.withContext = function (fn) {
        var prefs = app.scriptPreferences;
        var previousUnit = prefs.measurementUnit;
        var previousInteraction = null;
        var doc = A.activeDocument();
        var view = null;
        var previousOrigin = null;
        var previousZero = null;
        prefs.measurementUnit = MeasurementUnits.POINTS;
        try {
            previousInteraction = prefs.userInteractionLevel;
            prefs.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;
        } catch (e) {
            previousInteraction = null;
        }
        if (doc) {
            try {
                view = doc.viewPreferences;
                previousOrigin = view.rulerOrigin;
                view.rulerOrigin = RulerOrigin.SPREAD_ORIGIN;
                previousZero = doc.zeroPoint;
                doc.zeroPoint = [0, 0];
            } catch (e2) {
                view = null;
            }
        }
        try {
            return fn();
        } finally {
            if (view) {
                try {
                    doc.zeroPoint = previousZero;
                    view.rulerOrigin = previousOrigin;
                } catch (e3) {
                    // Restoring the ruler is best effort.
                }
            }
            if (previousInteraction !== null) {
                try {
                    prefs.userInteractionLevel = previousInteraction;
                } catch (e4) {
                    // Same.
                }
            }
            prefs.measurementUnit = previousUnit;
        }
    };

    // Reads with points as the script unit, without creating an undo step.
    function inPoints(fn) {
        var prefs = app.scriptPreferences;
        var previous = prefs.measurementUnit;
        prefs.measurementUnit = MeasurementUnits.POINTS;
        try {
            return fn();
        } finally {
            prefs.measurementUnit = previous;
        }
    }

    // InDesign bounds [y1, x1, y2, x2] -> core rectangle [left, top, right, bottom] with Y up.
    function toCoreRect(bounds) {
        return [bounds[1], -bounds[0], bounds[3], -bounds[2]];
    }

    function pageName(page) {
        return "Page " + page.name;
    }

    A.artboardCount = function (doc) {
        return doc.pages.length;
    };

    A.activeArtboardIndex = function (doc) {
        try {
            var page = app.activeWindow.activePage;
            if (page && page.isValid) {
                return page.documentOffset;
            }
        } catch (e) {
            // Story editor windows have no active page.
        }
        return 0;
    };

    A.artboardAt = function (doc, index) {
        return inPoints(function () {
            var page = doc.pages[index];
            var rect = toCoreRect(page.bounds);
            return {
                index: index,
                name: pageName(page),
                rect: rect,
                width: rect[2] - rect[0],
                height: rect[1] - rect[3]
            };
        });
    };

    A.activeArtboard = function (doc) {
        return A.artboardAt(doc, A.activeArtboardIndex(doc));
    };

    function pageIndexAt(doc, x, y, fallback) {
        for (var i = 0; i < doc.pages.length; i++) {
            var r = toCoreRect(doc.pages[i].bounds);
            if (x >= r[0] && x <= r[2] && y <= r[1] && y >= r[3]) {
                return i;
            }
        }
        return fallback === undefined ? A.activeArtboardIndex(doc) : fallback;
    }

    // -------------------------------------------------------------- labels

    function label(item, key) {
        try {
            return item.extractLabel(key);
        } catch (e) {
            return "";
        }
    }

    function isOwned(item) {
        return label(item, LABEL_OWNER) === M.OWNER_ID;
    }

    /*
     * Object identity, safely. A reference to something in a document that has
     * since been closed raises "Object is invalid" on any comparison, and the
     * panel holds such references between calls (the preview it last drew).
     */
    function containsItem(list, item) {
        for (var i = 0; i < list.length; i++) {
            try {
                if (list[i] === item) {
                    return true;
                }
            } catch (e) {
                // A stale reference is not the item we are looking at.
            }
        }
        return false;
    }

    function contains(list, value) {
        for (var i = 0; i < list.length; i++) {
            if (list[i] === value) {
                return true;
            }
        }
        return false;
    }

    /*
     * InDesign raises an error when you read a property an object doesn't have,
     * rather than returning nothing, so every probe goes through here. Text
     * selections, guides and graphics each lack something the others have.
     */
    function probe(item, name) {
        try {
            var value = item[name];
            return value === undefined ? null : value;
        } catch (e) {
            return null;
        }
    }

    function typeName(item) {
        try {
            return item.constructor && item.constructor.name ? String(item.constructor.name) : "";
        } catch (e) {
            return "";
        }
    }

    function boundsOf(item) {
        var bounds = probe(item, "geometricBounds");
        return (bounds && bounds.length === 4) ? bounds : null;
    }

    // Rect helpers for region keys of the form "prefix:left,top,right,bottom".
    function parseRegionRect(region) {
        var halves = String(region).split(":");
        if (halves.length < 2) {
            return null;
        }
        var parts = halves[halves.length - 1].split(",");
        if (parts.length !== 4) {
            return null;
        }
        var rect = [];
        for (var i = 0; i < 4; i++) {
            var n = parseFloat(parts[i]);
            if (isNaN(n)) {
                return null;
            }
            rect.push(n);
        }
        return rect;
    }

    // Overlapping areas of the same kind are the same area, so artwork nudged by
    // a point gets its grid replaced rather than a second grid stacked on it.
    function regionMatches(stored, target) {
        if (stored === target) {
            return true;
        }
        var a = parseRegionRect(stored);
        var b = parseRegionRect(target);
        if (!a || !b || stored.split(":")[0] !== target.split(":")[0]) {
            return false;
        }
        var left = Math.max(a[0], b[0]);
        var right = Math.min(a[2], b[2]);
        var top = Math.min(a[1], b[1]);
        var bottom = Math.max(a[3], b[3]);
        if (right <= left || top <= bottom) {
            return false;
        }
        var overlap = (right - left) * (top - bottom);
        var areaA = (a[2] - a[0]) * (a[1] - a[3]);
        var areaB = (b[2] - b[0]) * (b[1] - b[3]);
        var smaller = Math.min(areaA, areaB);
        return smaller > 0 && overlap / smaller >= 0.5;
    }

    function matchesAnyRegion(stored, regions) {
        for (var i = 0; i < regions.length; i++) {
            if (regionMatches(stored, regions[i])) {
                return true;
            }
        }
        return false;
    }

    // One scan per host call.
    var scan = null;

    A.invalidate = function () {
        scan = null;
    };

    function ownedChildCount(item) {
        var items = probe(item, "pageItems");
        if (!items) {
            return -1;
        }
        var children;
        try {
            children = items.everyItem().getElements();
        } catch (e) {
            return -1;
        }
        var owned = 0;
        for (var i = 0; i < children.length; i++) {
            if (isOwned(children[i])) {
                owned++;
            }
        }
        return owned;
    }

    function describeOwned(doc, item) {
        var region = label(item, LABEL_REGION);
        var page = parseInt(label(item, LABEL_PAGE), 10);
        /*
         * Which page a grid belongs to comes from the item's own page, not from
         * a stored number (page numbers shift the moment a page is inserted) and
         * not from geometry: unlike Illustrator's artboards, InDesign pages do
         * not share one coordinate space, so two pages can report the same
         * bounds. An item on the pasteboard has no page and belongs to none.
         */
        var parent = probe(item, "parentPage");
        if (parent) {
            var offset = probe(parent, "documentOffset");
            page = typeof offset === "number" ? offset : page;
        }
        // Without a page to ask, the number the grid was drawn with is the best
        // answer there is; better a stale number than losing the grid entirely.
        if (isNaN(page)) {
            page = ORPHAN;
        }
        return {
            item: item,
            isGuide: typeName(item) === "Guide",
            kind: label(item, LABEL_KIND) === "preview" ? "preview" : "final",
            artboard: page,
            region: region || ("artboard:" + page),
            settings: label(item, LABEL_SETTINGS),
            schema: parseInt(label(item, LABEL_SCHEMA), 10) || 0,
            shapes: parseInt(label(item, LABEL_SHAPES), 10),
            hiddenByPreview: label(item, LABEL_HIDDEN) === "1"
        };
    }

    // Grid roots at any depth on the document's own pages. Master spreads are
    // left alone: a grid there has no page of its own to belong to.
    function collectOwned(doc, container, depth, found) {
        var items = probe(container, "pageItems");
        if (!items) {
            return;
        }
        var list;
        try {
            list = items.everyItem().getElements();
        } catch (e) {
            return;
        }
        for (var i = 0; i < list.length; i++) {
            var item = list[i];
            if (isOwned(item) && label(item, LABEL_KIND)) {
                found.push(describeOwned(doc, item));
            } else if (depth < 12 && typeName(item) === "Group") {
                collectOwned(doc, item, depth + 1, found);
            }
        }
    }

    // Every labeled grid: groups and single items on the document's pages, plus guides.
    function ownedEntries(doc, filter) {
        filter = filter || {};
        var reusable = false;
        try {
            reusable = Boolean(scan) && scan.doc === doc;
        } catch (e) {
            reusable = false; // The cached document has been closed.
        }
        if (!reusable) {
            var found = [];
            var i;
            for (i = 0; i < doc.spreads.length; i++) {
                collectOwned(doc, doc.spreads[i], 0, found);
            }
            for (i = 0; i < doc.pages.length; i++) {
                var guides = doc.pages[i].guides.everyItem().getElements();
                for (var g = 0; g < guides.length; g++) {
                    if (isOwned(guides[g]) && label(guides[g], LABEL_KIND)) {
                        found.push(describeOwned(doc, guides[g]));
                    }
                }
            }
            scan = { doc: doc, entries: found };
        }
        var out = [];
        for (var e = 0; e < scan.entries.length; e++) {
            var entry = scan.entries[e];
            if (filter.kind !== undefined && filter.kind !== entry.kind) {
                continue;
            }
            if (filter.artboards !== undefined && !contains(filter.artboards, entry.artboard) &&
                !(filter.includeOrphans && entry.artboard === ORPHAN)) {
                continue;
            }
            if (filter.regions !== undefined && !matchesAnyRegion(entry.region, filter.regions)) {
                continue;
            }
            if (filter.regionPrefix !== undefined && entry.region.substr(0, filter.regionPrefix.length) !== filter.regionPrefix) {
                continue;
            }
            if (filter.exclude !== undefined && containsItem(filter.exclude, entry.item)) {
                continue;
            }
            out.push(entry);
        }
        return out;
    }

    A.findOwnedGroups = ownedEntries;

    // Unlocks and shows a layer while fn runs, then restores both states.
    function withEditableLayer(layer, fn) {
        var wasLocked = layer.locked;
        var wasVisible = layer.visible;
        if (wasLocked) {
            layer.locked = false;
        }
        if (!wasVisible) {
            layer.visible = true;
        }
        try {
            return fn();
        } finally {
            if (layer.visible !== wasVisible) {
                layer.visible = wasVisible;
            }
            if (layer.locked !== wasLocked) {
                layer.locked = wasLocked;
            }
        }
    }

    function layerOf(item) {
        try {
            return item.itemLayer;
        } catch (e) {
            return null;
        }
    }

    // Removes one grid. Returns the number of user items kept.
    function removeEntry(entry) {
        var item = entry.item;
        var layer = layerOf(item);
        var remove = function () {
            if (item.locked) {
                item.locked = false;
            }
            if (entry.isGuide || !item.pageItems || item.constructor.name !== "Group") {
                item.remove();
                return 0;
            }
            var children = item.pageItems.everyItem().getElements();
            var kept = 0;
            var mine = [];
            for (var i = 0; i < children.length; i++) {
                if (isOwned(children[i])) {
                    mine.push(children[i]);
                } else {
                    kept++;
                }
            }
            if (kept === 0) {
                item.remove();
                return 0;
            }
            /*
             * Release the group, then delete only Mullion's own items, so the
             * user's artwork stays. The children are collected first because
             * ungroup's return value is not relied on.
             */
            item.ungroup();
            for (var r = 0; r < mine.length; r++) {
                try {
                    mine[r].remove();
                } catch (e) {
                    // Already gone with the group; nothing to do.
                }
            }
            return kept;
        };
        return layer ? withEditableLayer(layer, remove) : remove();
    }

    /*
     * Whether the user has added or deleted items in a grid: their work, not
     * ours to delete. Counting a grid's items is the most expensive thing in a
     * scan, so it happens only when something is about to be removed.
     */
    function isEdited(entry) {
        if (entry.editedChecked) {
            return entry.edited === true;
        }
        entry.editedChecked = true;
        entry.edited = false;
        if (isNaN(entry.shapes)) {
            return false;
        }
        var current = ownedChildCount(entry.item);
        entry.edited = current >= 0 && current !== entry.shapes;
        return entry.edited;
    }

    A.isEdited = isEdited;

    /*
     * Hands a grid the user has edited back to them: the labels come off, so
     * Mullion stops treating it as its own and never deletes it.
     */
    function releaseEntry(entry) {
        var item = entry.item;
        var names = [LABEL_OWNER, LABEL_KIND, LABEL_PAGE, LABEL_REGION, LABEL_HIDDEN, LABEL_SCHEMA, LABEL_SETTINGS, LABEL_SHAPES];
        for (var i = 0; i < names.length; i++) {
            try {
                item.insertLabel(names[i], "");
            } catch (e) {
                // A label that cannot be cleared leaves the grid owned; better
                // that than deleting work the user changed.
            }
        }
        try {
            item.name = "Edited grid";
        } catch (e2) {
            // Guides have no name.
        }
        scan = null;
    }

    A.removeOwned = function (doc, filter, options) {
        var entries = ownedEntries(doc, filter);
        var rescued = 0;
        var removed = 0;
        var kept = 0;
        var touched = [];
        for (var i = entries.length - 1; i >= 0; i--) {
            if (!(options && options.force) && isEdited(entries[i])) {
                releaseEntry(entries[i]);
                kept++;
                continue;
            }
            rescued += removeEntry(entries[i]);
            removed++;
            scan = null;
            if (!contains(touched, entries[i].artboard)) {
                touched.push(entries[i].artboard);
            }
        }
        if (removed && !(options && options.keepLayer)) {
            removeEmptyManagedLayer(doc);
        }
        return { removed: removed, rescued: rescued, kept: kept, artboards: touched.length };
    };

    function setHidden(entry, hidden) {
        if (entry.isGuide) {
            return false; // Guides have no per-item visibility.
        }
        var layer = layerOf(entry.item);
        var apply = function () {
            entry.item.visible = !hidden;
            entry.item.insertLabel(LABEL_HIDDEN, hidden ? "1" : "0");
        };
        if (layer) {
            withEditableLayer(layer, apply);
        } else {
            apply();
        }
        return true;
    }

    /*
     * Removes grids this session drew, by reference. A live preview redraws on
     * every keystroke, and scanning the document each time costs far more than
     * the drawing does, so the preview keeps hold of what it made.
     */
    A.removeGroups = function (items) {
        var removed = 0;
        for (var i = 0; i < items.length; i++) {
            try {
                removeEntry({ item: items[i], isGuide: typeName(items[i]) === "Guide" });
                removed++;
            } catch (e) {
                // Already gone (undone, or deleted by hand): nothing to remove.
            }
        }
        if (removed) {
            scan = null;
        }
        return removed;
    };

    // Shows grids a preview hid, by reference.
    A.showGroups = function (entries) {
        var shown = 0;
        for (var i = 0; i < entries.length; i++) {
            try {
                setHidden(entries[i], false);
                entries[i].hiddenByPreview = false;
                shown++;
            } catch (e) {
                // The grid is gone; there is nothing to show.
            }
        }
        return shown;
    };

    // Returns the grids it hid, so the preview can show them again without
    // searching the document for them.
    A.hideForPreview = function (doc, regions) {
        var entries = ownedEntries(doc, { kind: "final", regions: regions });
        var hidden = [];
        for (var i = 0; i < entries.length; i++) {
            if (!entries[i].isGuide && entries[i].item.visible && setHidden(entries[i], true)) {
                hidden.push(entries[i]);
            }
        }
        return hidden;
    };

    A.restorePreviewHidden = function (doc) {
        var entries = ownedEntries(doc, { kind: "final" });
        var restored = 0;
        for (var i = 0; i < entries.length; i++) {
            if (entries[i].hiddenByPreview && setHidden(entries[i], false)) {
                restored++;
            }
        }
        return restored;
    };

    /*
     * Ends previewing in one document: removes preview grids, shows again the
     * grids they hid, and re-hides the grid layer if the preview had to show it.
     */
    A.endPreview = function (doc, keep, options) {
        var filter = { kind: "preview" };
        if (keep && keep.length) {
            filter.exclude = keep;
        }
        var previews = ownedEntries(doc, filter);
        var layerWasHidden = false;
        for (var i = 0; i < previews.length; i++) {
            if (label(previews[i].item, LABEL_LAYER_HIDDEN) === "1") {
                layerWasHidden = true;
            }
        }
        var removed = A.removeOwned(doc, filter, { keepLayer: true, force: true }).removed;
        // Grids stay hidden while any preview is still showing in this document.
        var stillPreviewing = ownedEntries(doc, { kind: "preview" }).length > 0;
        var restored = stillPreviewing ? 0 : A.restorePreviewHidden(doc);
        if (layerWasHidden && !stillPreviewing) {
            var layer = findManagedLayer(doc);
            if (layer) {
                layer.visible = false;
            }
        }
        /*
         * The layer stays unless the caller says otherwise. Deleting it and
         * making it again costs far more than everything else a preview does,
         * and a preview redraws on every keystroke.
         */
        if (removed && !(options && options.keepLayer)) {
            removeEmptyManagedLayer(doc);
        }
        return { removed: removed, restored: restored };
    };

    // ---------------------------------------------------------------- layers

    function findManagedLayer(doc) {
        var layer = doc.layers.itemByName(LAYER_NAME);
        return layer.isValid ? layer : null;
    }

    function ensureManagedLayer(doc) {
        var existing = findManagedLayer(doc);
        if (existing) {
            return existing;
        }
        var previousActive = doc.activeLayer;
        var layer = doc.layers.add({ name: LAYER_NAME, printable: false });
        layer.move(LocationOptions.AT_BEGINNING);
        try {
            doc.activeLayer = previousActive;
        } catch (e) {
            // Leaving the new layer active is harmless.
        }
        return layer;
    }

    function removeEmptyManagedLayer(doc) {
        var layer = findManagedLayer(doc);
        if (!layer || doc.layers.length < 2) {
            return;
        }
        var guides = 0;
        for (var i = 0; i < doc.pages.length; i++) {
            var pageGuides = doc.pages[i].guides.everyItem().getElements();
            for (var g = 0; g < pageGuides.length; g++) {
                if (pageGuides[g].itemLayer === layer || pageGuides[g].itemLayer.name === LAYER_NAME) {
                    guides++;
                }
            }
        }
        if (layer.pageItems.length === 0 && guides === 0) {
            layer.locked = false;
            layer.remove();
            removeUnusedSwatches(doc);
        }
    }

    /*
     * Colours are added to the document's swatches so repeated grids share one,
     * which means they outlive the grids unless they are cleaned up. Every colour
     * Mullion added is removed once no grid is left to use it.
     */
    function removeUnusedSwatches(doc) {
        var colors;
        try {
            colors = doc.colors.everyItem().getElements();
        } catch (e) {
            return;
        }
        for (var i = colors.length - 1; i >= 0; i--) {
            var name = probe(colors[i], "name");
            if (typeof name === "string" && name.substr(0, 8) === "Mullion ") {
                try {
                    colors[i].remove();
                } catch (e2) {
                    // A swatch still in use by the user's own artwork stays.
                }
            }
        }
    }

    A.setGridLayer = function (doc, changes) {
        var layer = findManagedLayer(doc);
        if (!layer) {
            return false;
        }
        if (typeof changes.visible === "boolean") {
            layer.visible = changes.visible;
        }
        if (typeof changes.locked === "boolean") {
            layer.locked = changes.locked;
        }
        return true;
    };

    A.describe = function (doc) {
        return inPoints(function () {
            var board = A.activeArtboard(doc);
            var all = ownedEntries(doc, {});
            var previews = 0;
            var finals = 0;
            var strayPreviews = 0;
            var hiddenByPreview = 0;
            for (var i = 0; i < all.length; i++) {
                var onPage = all[i].artboard === board.index;
                if (all[i].kind === "preview") {
                    strayPreviews++;
                    if (onPage) {
                        previews++;
                    }
                } else {
                    if (all[i].hiddenByPreview) {
                        hiddenByPreview++;
                    }
                    if (onPage) {
                        finals++;
                    }
                }
            }
            var pages = [];
            for (var p = 0; p < doc.pages.length; p++) {
                pages.push({ index: p, name: pageName(doc.pages[p]), rect: toCoreRect(doc.pages[p].bounds) });
            }
            var selected = [];
            try {
                selected = A.selectionTargets(doc);
            } catch (e) {
                selected = [];
            }
            var selection = [];
            for (var s = 0; s < selected.length && s < 20; s++) {
                selection.push({ rect: selected[s].rect, artboard: selected[s].index });
            }
            var layer = findManagedLayer(doc);
            return {
                host: A.HOST,
                hasDocument: true,
                documentName: doc.name,
                colorSpace: "RGB",
                artboardCount: doc.pages.length,
                artboard: board,
                artboards: pages,
                selection: { count: selected.length, objects: selection },
                grids: { preview: previews, generated: finals, strayPreviews: strayPreviews, hiddenByPreview: hiddenByPreview },
                gridLayer: layer
                    ? { exists: true, visible: layer.visible, locked: layer.locked }
                    : { exists: false, visible: true, locked: false }
            };
        });
    };

    // ------------------------------------------------------------- selection

    function isInsideOwnedGrid(item) {
        var node = item;
        while (node && node.constructor && node.constructor.name !== "Spread" && node.constructor.name !== "Document") {
            if (isOwned(node)) {
                return true;
            }
            node = node.parent;
        }
        return false;
    }

    function roundKey(v) {
        return Math.round(v * 100) / 100;
    }

    A.selectionItems = function (doc) {
        return inPoints(function () {
            var selection = doc.selection;
            var out = [];
            if (!selection || typeof selection.length !== "number") {
                return out;
            }
            for (var i = 0; i < selection.length && out.length < MAX_SELECTION; i++) {
                var item = selection[i];
                // Reading a property an object doesn't have raises an error in
                // InDesign, and the cursor sitting in text is the commonest
                // selection there is, so every read is probed.
                var bounds = item ? boundsOf(item) : null;
                if (!bounds || isInsideOwnedGrid(item)) {
                    continue;
                }
                var rect = toCoreRect(bounds);
                if (rect[2] - rect[0] <= 0 || rect[1] - rect[3] <= 0) {
                    continue;
                }
                out.push({ item: item, rect: rect, artboard: pageIndexAt(doc, (rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2) });
            }
            return out;
        });
    };

    A.selectionTargets = function (doc) {
        var items = A.selectionItems(doc);
        var seen = {};
        var targets = [];
        for (var i = 0; i < items.length; i++) {
            var r = items[i].rect;
            var region = "object:" + roundKey(r[0]) + "," + roundKey(r[1]) + "," + roundKey(r[2]) + "," + roundKey(r[3]);
            if (seen[region]) {
                continue;
            }
            seen[region] = true;
            targets.push({
                index: items[i].artboard,
                name: "Object on " + pageName(doc.pages[items[i].artboard]),
                rect: r,
                width: r[2] - r[0],
                height: r[1] - r[3],
                region: region,
                areaLabel: "object"
            });
        }
        return targets;
    };

    A.moveItem = function (entry, dx, dy) {
        var item = entry.item;
        var layer = layerOf(item);
        if (item.locked || (layer && (layer.locked || !layer.visible)) || item.visible === false) {
            return false;
        }
        inPoints(function () {
            item.move(undefined, [dx, -dy]); // InDesign Y grows downward.
        });
        return true;
    };

    // Paths of the selected artwork, converted to Y-up coordinates. See the Illustrator adapter.
    A.selectionPaths = function (doc) {
        return inPoints(function () {
            var selection = doc.selection;
            var paths = [];
            var hasText = false;
            var points = 0;
            var firstBounds = null;
            var limit = 3000; // Reading points is slow in the host; stop well before users notice.
            function flip(p) {
                return [p[0], -p[1]];
            }
            function collect(item) {
                if (points > limit || !item) {
                    return;
                }
                var type = item.constructor ? item.constructor.name : "";
                var i;
                if (type === "Group") {
                    var children = item.pageItems.everyItem().getElements();
                    for (i = 0; i < children.length; i++) {
                        collect(children[i]);
                    }
                    return;
                }
                if (type === "TextFrame" || type === "Text" || type === "InsertionPoint" ||
                    type === "Character" || type === "Word" || type === "Paragraph" || type === "Story") {
                    hasText = true;
                    return;
                }
                var itemPaths = probe(item, "paths");
                if (!itemPaths || typeof itemPaths.length !== "number") {
                    // Anything with text but no outline is a text selection under
                    // one of InDesign's many names for it; everything else here
                    // (guides, images, placed graphics) simply has no paths.
                    if (typeof probe(item, "contents") === "string") {
                        hasText = true;
                    }
                    return;
                }
                for (i = 0; i < itemPaths.length; i++) {
                    var path = itemPaths[i];
                    var list = [];
                    for (var j = 0; j < path.pathPoints.length; j++) {
                        var pp = path.pathPoints[j];
                        list.push({ anchor: flip(pp.anchor), left: flip(pp.leftDirection), right: flip(pp.rightDirection) });
                    }
                    points += list.length;
                    if (list.length) {
                        paths.push({ closed: probe(path, "pathType") === PathType.CLOSED_PATH, points: list });
                    }
                }
            }
            if (selection && selection.length) {
                for (var s = 0; s < selection.length && points <= limit; s++) {
                    if (isInsideOwnedGrid(selection[s])) {
                        continue;
                    }
                    var selectionBounds = boundsOf(selection[s]);
                    if (!firstBounds && selectionBounds) {
                        firstBounds = toCoreRect(selectionBounds);
                    }
                    collect(selection[s]);
                }
            }
            var artboard = firstBounds
                ? pageIndexAt(doc, (firstBounds[0] + firstBounds[2]) / 2, (firstBounds[1] + firstBounds[3]) / 2)
                : A.activeArtboardIndex(doc);
            return { paths: paths, artboard: artboard, hasText: hasText, truncated: points > limit };
        });
    };

    A.selectItems = function (doc, entries) {
        app.select(NothingEnum.NOTHING);
        for (var i = 0; i < entries.length; i++) {
            try {
                app.select(entries[i].item, SelectionOptions.ADD_TO);
            } catch (e) {
                // Locked items can't be selected.
            }
        }
    };

    A.readTextMetrics = function (doc) {
        return inPoints(function () {
            var selection = doc.selection;
            var text = null;
            if (!selection || !selection.length) {
                return null;
            }
            for (var i = 0; i < selection.length && !text; i++) {
                var item = selection[i];
                var type = item.constructor ? item.constructor.name : "";
                if (type === "TextFrame" && item.texts.length) {
                    text = item.texts[0];
                } else if (type === "Text" || type === "InsertionPoint" || type === "Character" || type === "Word" || type === "Paragraph" || type === "Line" || type === "TextStyleRange") {
                    text = item;
                }
            }
            if (!text) {
                return null;
            }
            var size = text.pointSize;
            var auto = text.leading === Leading.AUTO;
            var leading = auto ? size * (text.autoLeading || 120) / 100 : text.leading;
            var font = "";
            try {
                font = text.appliedFont.name;
            } catch (e) {
                font = "";
            }
            return {
                size: Math.round(size * 1000) / 1000,
                leading: Math.round(leading * 1000) / 1000,
                autoLeading: auto,
                font: font
            };
        });
    };

    // ----------------------------------------------------------------- pages

    A.resizeArtboard = function (doc, index, width, height) {
        var page = doc.pages[index];
        try {
            page.resize(CoordinateSpaces.INNER_COORDINATES, AnchorPoint.TOP_LEFT_ANCHOR,
                ResizeMethods.REPLACING_CURRENT_DIMENSIONS_WITH, [width, height]);
        } catch (e) {
            throw new M.HostError("RESIZE_FAILED",
                "InDesign couldn't resize " + pageName(page) + " to " + Math.round(width) + " × " + Math.round(height) +
                " pt. Pages can be at most 15,552 pt (216 in) on each side.");
        }
    };

    /*
     * Sets InDesign's own page margins and columns (and the document baseline
     * grid) from grid settings, for the target pages.
     */
    A.applyPageMargins = function (doc, indices, settings) {
        /*
         * On a facing-pages document, left and right mean inside and outside and
         * are mirrored on every left-hand page. Writing the same numbers to both
         * pages of a spread would mirror the layout the panel previewed.
         */
        var facing = probe(doc.documentPreferences, "facingPages") === true;
        var mirrored = 0;
        for (var i = 0; i < indices.length; i++) {
            var page = doc.pages[indices[i]];
            var prefs = page.marginPreferences;
            var leftHand = false;
            if (facing) {
                var side = probe(page, "side");
                leftHand = side !== null && /LEFT/.test(String(side));
                if (leftHand) {
                    mirrored++;
                }
            }
            prefs.top = settings.marginTop;
            prefs.bottom = settings.marginBottom;
            prefs.left = leftHand ? settings.marginRight : settings.marginLeft;
            prefs.right = leftHand ? settings.marginLeft : settings.marginRight;
            if (settings.type === "columns" || settings.type === "modular") {
                prefs.columnCount = settings.columns;
                prefs.columnGutter = settings.columnGutter;
            }
        }
        var baseline = settings.type === "baseline" || settings.addBaseline;
        if (baseline) {
            doc.gridPreferences.baselineDivision = settings.baselineSpacing;
            // The baseline grid is measured from the top of the page unless the
            // document says otherwise, in which case the margin is already counted.
            var fromMargin = false;
            try {
                fromMargin = doc.gridPreferences.baselineGridRelativeOption === BaselineGridRelativeOption.TOP_OF_MARGIN;
            } catch (e) {
                fromMargin = false;
            }
            doc.gridPreferences.baselineStart = fromMargin
                ? settings.baselineOffset
                : settings.marginTop + settings.baselineOffset;
        }
        // The baseline grid belongs to the document, not to the chosen pages.
        return { pages: indices.length, baseline: !!baseline, facingPages: facing, mirroredPages: mirrored, baselineIsDocumentWide: !!baseline };
    };

    // --------------------------------------------------------------- drawing

    function hexToRgb(hex) {
        return [parseInt(hex.substr(1, 2), 16), parseInt(hex.substr(3, 2), 16), parseInt(hex.substr(5, 2), 16)];
    }

    // Finds or creates an RGB swatch named for the color, so repeated grids share one swatch.
    function swatchFor(doc, hex) {
        var name = "Mullion " + hex.toUpperCase();
        var color = doc.colors.itemByName(name);
        if (color.isValid) {
            return color;
        }
        return doc.colors.add({ name: name, model: ColorModel.PROCESS, space: ColorSpace.RGB, colorValue: hexToRgb(hex) });
    }

    /*
     * Stock stroke styles and the "None" swatch are named in the interface
     * language, so they are looked up defensively: a localised build must not
     * break drawing, and a dashed grid that silently draws solid would be worse
     * than saying so.
     */
    function strokeStyleNamed(doc, names) {
        for (var i = 0; i < names.length; i++) {
            var style = doc.strokeStyles.itemByName(names[i]);
            if (style && style.isValid) {
                return style;
            }
        }
        return null;
    }

    function noneSwatch(doc) {
        var swatch = doc.swatches.itemByName("None");
        if (swatch && swatch.isValid) {
            return swatch;
        }
        var swatches = probe(doc, "swatches");
        var list = null;
        try {
            list = swatches ? swatches.everyItem().getElements() : null;
        } catch (e) {
            list = null;
        }
        for (var i = 0; list && i < list.length; i++) {
            if (probe(list[i], "model") === ColorModel.PROCESS && probe(list[i], "name") === "") {
                return list[i];
            }
        }
        return null;
    }

    function makeStyle(doc, s) {
        if (s.output === "guides") {
            return { guides: true };
        }
        var main = swatchFor(doc, s.strokeColor);
        var margin = s.marginColorOn ? swatchFor(doc, s.marginColor) : main;
        var styleNames = {
            solid: ["Solid"],
            dashed: ["Dashed", "Dashed (3 and 2)", "Dashed (4 and 4)"],
            dotted: ["Dotted", "Dotted (4 and 4)", "Japanese Dots"]
        };
        var requested = styleNames[s.lineStyle] || styleNames.solid;
        var strokeType = strokeStyleNamed(doc, requested);
        if (!strokeType && s.lineStyle !== "solid") {
            throw new M.HostError("UNSUPPORTED",
                "This InDesign doesn't have a " + s.lineStyle + " stroke style Mullion recognises. Choose solid lines, or add a " +
                s.lineStyle + " stroke style to the document.");
        }
        return {
            guides: false,
            none: noneSwatch(doc),
            main: main,
            margin: margin,
            colorFor: function (kind) {
                if (s.kindColors && s.kindColors[kind]) {
                    return swatchFor(doc, s.kindColors[kind]);
                }
                return kind === "margin" ? margin : main;
            },
            gutter: s.shadeGutters ? swatchFor(doc, s.gutterColor) : null,
            gutterOpacity: s.gutterOpacity,
            width: s.strokeWidth,
            strokeType: strokeType || strokeStyleNamed(doc, ["Solid"]),
            roundCaps: s.lineStyle === "dotted"
        };
    }

    // Applies owner label and paint to a drawn item.
    function paint(item, kind, style) {
        item.insertLabel(LABEL_OWNER, M.OWNER_ID);
        if (kind === "gutter" || kind === "block" || kind === "dot") {
            item.strokeWeight = 0;
            item.strokeColor = style.none;
            item.fillColor = kind === "gutter" ? style.gutter : style.main;
            if (kind !== "dot") {
                item.transparencySettings.blendingSettings.opacity = kind === "gutter" ? style.gutterOpacity : BLOCK_OPACITY;
            }
            return item;
        }
        item.fillColor = style.none;
        item.strokeColor = style.colorFor(kind);
        item.strokeWeight = style.width;
        if (style.strokeType && style.strokeType.isValid) {
            item.strokeType = style.strokeType;
        }
        if (style.roundCaps) {
            item.endCap = EndCap.ROUND_END_CAP;
        }
        return item;
    }

    // InDesign coordinates from core coordinates.
    function pt(x, y) {
        return [x, -y];
    }

    function drawShapes(page, layer, grid, style) {
        var items = [];
        var i;
        var boxes = grid.boxes || [];
        var passes = ["gutter", "block", "other"];
        for (var pass = 0; pass < passes.length; pass++) {
            for (i = 0; i < boxes.length; i++) {
                var b = boxes[i];
                var type = b.kind === "gutter" || b.kind === "block" ? b.kind : "other";
                if (type !== passes[pass]) {
                    continue;
                }
                var rect = page.rectangles.add(layer, undefined, undefined, { geometricBounds: [-b.top, b.left, -b.bottom, b.right] });
                items.push(paint(rect, b.kind, style));
            }
        }
        var polygons = grid.polygons || [];
        for (i = 0; i < polygons.length; i++) {
            var points = [];
            for (var p = 0; p < polygons[i].points.length; p++) {
                points.push(pt(polygons[i].points[p][0], polygons[i].points[p][1]));
            }
            var polygon = page.polygons.add(layer);
            polygon.paths[0].entirePath = points;
            items.push(paint(polygon, polygons[i].kind, style));
        }
        var segments = grid.segments || [];
        for (i = 0; i < segments.length; i++) {
            var seg = segments[i];
            var line = page.graphicLines.add(layer);
            line.paths[0].entirePath = [pt(seg.x1, seg.y1), pt(seg.x2, seg.y2)];
            items.push(paint(line, seg.kind, style));
        }
        var curves = grid.curves || [];
        for (i = 0; i < curves.length; i++) {
            var path = [];
            for (var c = 0; c < curves[i].points.length; c++) {
                var cp = curves[i].points[c];
                path.push([pt(cp.left[0], cp.left[1]), pt(cp.anchor[0], cp.anchor[1]), pt(cp.right[0], cp.right[1])]);
            }
            var shape = curves[i].closed ? page.polygons.add(layer) : page.graphicLines.add(layer);
            shape.paths[0].entirePath = path;
            if (curves[i].closed) {
                shape.paths[0].pathType = PathType.CLOSED_PATH;
            }
            items.push(paint(shape, curves[i].kind, style));
        }
        var dots = grid.dots || [];
        for (i = 0; i < dots.length; i++) {
            var r = dots[i].d / 2;
            var oval = page.ovals.add(layer, undefined, undefined, { geometricBounds: [-dots[i].y - r, dots[i].x - r, -dots[i].y + r, dots[i].x + r] });
            items.push(paint(oval, "dot", style));
        }
        return items;
    }

    // Guides: InDesign guides are full-length and only horizontal or vertical.
    function drawGuides(page, layer, grid) {
        var lines = M.core.snapLines(grid);
        var guides = [];
        var i;
        var skipped = (grid.curves || []).length + (grid.polygons || []).length + (grid.dots || []).length;
        var segments = grid.segments || [];
        for (i = 0; i < segments.length; i++) {
            if (segments[i].x1 !== segments[i].x2 && segments[i].y1 !== segments[i].y2) {
                skipped++;
            }
        }
        if (skipped) {
            throw new M.HostError("GUIDES_UNSUPPORTED",
                "InDesign guides can only be horizontal or vertical. Choose Lines for diagonals, curves, hexagons, and dots.");
        }
        for (i = 0; i < lines.xs.length; i++) {
            guides.push(page.guides.add(layer, { orientation: HorizontalOrVertical.VERTICAL, location: lines.xs[i], fitToPage: true }));
        }
        for (i = 0; i < lines.ys.length; i++) {
            guides.push(page.guides.add(layer, { orientation: HorizontalOrVertical.HORIZONTAL, location: -lines.ys[i], fitToPage: true }));
        }
        return guides;
    }

    /*
     * The settings that made a grid, small enough to live in a label, so a
     * document carries the recipe for the grid in it and a later release can
     * migrate what this one wrote.
     */
    function settingsLabel(s) {
        var out = {};
        for (var key in s) {
            if (s.hasOwnProperty(key) && typeof s[key] !== "function") {
                out[key] = s[key];
            }
        }
        var text = "";
        try {
            text = JSON.stringify({ schema: SCHEMA, settings: out });
        } catch (e) {
            text = "";
        }
        return text.length > 4000 ? "" : text;
    }

    function tagRoot(item, kind, target, settings, shapes) {
        try {
            item.insertLabel(LABEL_OWNER, M.OWNER_ID);
            item.insertLabel(LABEL_KIND, kind);
            item.insertLabel(LABEL_PAGE, String(target.index));
            item.insertLabel(LABEL_REGION, target.region || ("artboard:" + target.index));
            item.insertLabel(LABEL_SCHEMA, String(SCHEMA));
            if (settings) {
                item.insertLabel(LABEL_SETTINGS, settingsLabel(settings));
            }
            if (shapes !== undefined) {
                item.insertLabel(LABEL_SHAPES, String(shapes));
            }
        } catch (e) {
            /*
             * Labels are how Mullion knows what is its own. Something it cannot
             * label it must not draw, or Clear could never remove it.
             */
            throw new M.HostError("UNSUPPORTED",
                "InDesign would not let Mullion mark this grid as its own, so it was not drawn. Try a different output than guides.");
        }
    }

    A.drawGrid = function (doc, target, grid, kind) {
        var s = grid.settings;
        var layer = ensureManagedLayer(doc);
        var page = doc.pages[target.index];
        var created = withEditableLayer(layer, function () {
            if (s.output === "guides") {
                var guides = drawGuides(page, layer, grid);
                for (var g = 0; g < guides.length; g++) {
                    tagRoot(guides[g], kind, target, g === 0 ? s : null, 0);
                }
                // Guides cannot be grouped, so each one is its own grid root and
                // all of them must be reported as created.
                return { shapes: guides.length, groupName: "", group: guides.length ? guides[0] : null, groups: guides };
            }
            var items = drawShapes(page, layer, grid, makeStyle(doc, s));
            if (!items.length) {
                return { shapes: 0, groupName: "", group: null };
            }
            var root = items.length > 1 ? page.groups.add(items, layer) : items[0];
            root.name = (kind === "preview" ? "Preview: " : "") + GRID_LABELS[s.type] + ", " + target.name;
            tagRoot(root, kind, target, s, items.length > 1 ? items.length : 0);
            root.transparencySettings.blendingSettings.opacity = s.opacity;
            return { shapes: items.length, groupName: root.name, group: root };
        });
        // A preview has to be visible to be a preview, but the user's choice is
        // remembered so ending the preview can put the layer back.
        if (!layer.visible) {
            if (kind === "preview" && created.group) {
                try {
                    created.group.insertLabel(LABEL_LAYER_HIDDEN, "1");
                } catch (e) {
                    // Nothing to restore if it cannot be recorded.
                }
            }
            layer.visible = true;
        }
        if (kind === "final") {
            layer.locked = s.lockLayer;
        }
        created.layerName = layer.name;
        scan = null;
        return created;
    };

    A.drawTestLine = function (doc) {
        var board = A.activeArtboard(doc);
        var r = board.rect;
        var y = (r[1] + r[3]) / 2;
        board.region = "artboard:" + board.index;
        A.drawGrid(doc, board, {
            settings: { type: "columns", output: "lines", strokeColor: "#E0457B", strokeWidth: 1, opacity: 100, lineStyle: "solid", lockLayer: false },
            segments: [{ kind: "test", x1: r[0], y1: y, x2: r[2], y2: y }]
        }, "final");
        return { artboard: board, line: [[r[0], y], [r[2], y]], layerName: LAYER_NAME };
    };

    A.redraw = function () {
        // InDesign redraws when the script finishes.
    };

    M.adapter = A;
}($.global.Mullion));
