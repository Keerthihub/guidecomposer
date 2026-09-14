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
            app.doScript(function () {
                try {
                    result = fn();
                } catch (inner) {
                    failure = inner;
                }
            }, ScriptLanguage.JAVASCRIPT, [], UndoModes.ENTIRE_SCRIPT, "Mullion: " + label);
        } finally {
            prefs.measurementUnit = previousUnit;
            prefs.enableRedraw = previousRedraw;
        }
        if (failure) {
            throw failure;
        }
        return result;
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

    function pageIndexAt(doc, x, y) {
        for (var i = 0; i < doc.pages.length; i++) {
            var r = toCoreRect(doc.pages[i].bounds);
            if (x >= r[0] && x <= r[2] && y <= r[1] && y >= r[3]) {
                return i;
            }
        }
        return A.activeArtboardIndex(doc);
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

    function contains(list, value) {
        for (var i = 0; i < list.length; i++) {
            if (list[i] === value) {
                return true;
            }
        }
        return false;
    }

    // Every labeled grid: groups and single items from all spreads, plus guides.
    function ownedEntries(doc, filter) {
        var found = [];
        var candidates = [];
        var i;
        filter = filter || {};
        var items = doc.pageItems.everyItem().getElements();
        for (i = 0; i < items.length; i++) {
            candidates.push(items[i]);
        }
        for (i = 0; i < doc.pages.length; i++) {
            var guides = doc.pages[i].guides.everyItem().getElements();
            for (var g = 0; g < guides.length; g++) {
                candidates.push(guides[g]);
            }
        }
        for (i = 0; i < candidates.length; i++) {
            var item = candidates[i];
            if (!isOwned(item) || !label(item, LABEL_KIND)) {
                continue; // Owned children of a group carry no kind; only grid roots do.
            }
            var kind = label(item, LABEL_KIND) === "preview" ? "preview" : "final";
            var page = parseInt(label(item, LABEL_PAGE), 10);
            var region = label(item, LABEL_REGION) || ("artboard:" + page);
            if (filter.kind !== undefined && filter.kind !== kind) {
                continue;
            }
            if (filter.artboards !== undefined && !contains(filter.artboards, page)) {
                continue;
            }
            if (filter.regions !== undefined && !contains(filter.regions, region)) {
                continue;
            }
            if (filter.regionPrefix !== undefined && region.substr(0, filter.regionPrefix.length) !== filter.regionPrefix) {
                continue;
            }
            found.push({
                item: item,
                isGuide: item.constructor && item.constructor.name === "Guide",
                kind: kind,
                artboard: page,
                region: region,
                hiddenByPreview: label(item, LABEL_HIDDEN) === "1"
            });
        }
        return found;
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
            for (var i = 0; i < children.length; i++) {
                if (!isOwned(children[i])) {
                    kept++;
                }
            }
            if (kept === 0) {
                item.remove();
                return 0;
            }
            // Release the group, then delete only Mullion's own items.
            var released = item.ungroup();
            for (var r = 0; r < released.length; r++) {
                if (isOwned(released[r])) {
                    released[r].remove();
                }
            }
            return kept;
        };
        return layer ? withEditableLayer(layer, remove) : remove();
    }

    A.removeOwned = function (doc, filter, options) {
        var entries = ownedEntries(doc, filter);
        var rescued = 0;
        var touched = [];
        for (var i = entries.length - 1; i >= 0; i--) {
            rescued += removeEntry(entries[i]);
            if (!contains(touched, entries[i].artboard)) {
                touched.push(entries[i].artboard);
            }
        }
        if (entries.length && !(options && options.keepLayer)) {
            removeEmptyManagedLayer(doc);
        }
        return { removed: entries.length, rescued: rescued, artboards: touched.length };
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

    A.hideForPreview = function (doc, regions) {
        var entries = ownedEntries(doc, { kind: "final", regions: regions });
        var hidden = 0;
        for (var i = 0; i < entries.length; i++) {
            if (!entries[i].isGuide && entries[i].item.visible && setHidden(entries[i], true)) {
                hidden++;
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
            var owned = ownedEntries(doc, { artboards: [board.index] });
            var previews = 0;
            var finals = 0;
            for (var i = 0; i < owned.length; i++) {
                if (owned[i].kind === "preview") {
                    previews++;
                } else {
                    finals++;
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
                grids: { preview: previews, generated: finals },
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
                if (!item || !item.geometricBounds || isInsideOwnedGrid(item)) {
                    continue; // Text selections have no geometricBounds.
                }
                var rect = toCoreRect(item.geometricBounds);
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
                if (type === "TextFrame" || type === "Text" || type === "InsertionPoint") {
                    hasText = true;
                    return;
                }
                if (!item.paths) {
                    return;
                }
                for (i = 0; i < item.paths.length; i++) {
                    var path = item.paths[i];
                    var list = [];
                    for (var j = 0; j < path.pathPoints.length; j++) {
                        var pp = path.pathPoints[j];
                        list.push({ anchor: flip(pp.anchor), left: flip(pp.leftDirection), right: flip(pp.rightDirection) });
                    }
                    points += list.length;
                    if (list.length) {
                        paths.push({ closed: path.pathType === PathType.CLOSED_PATH, points: list });
                    }
                }
            }
            if (selection && selection.length) {
                for (var s = 0; s < selection.length && points <= limit; s++) {
                    if (isInsideOwnedGrid(selection[s])) {
                        continue;
                    }
                    if (!firstBounds && selection[s].geometricBounds) {
                        firstBounds = toCoreRect(selection[s].geometricBounds);
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
        for (var i = 0; i < indices.length; i++) {
            var prefs = doc.pages[indices[i]].marginPreferences;
            prefs.top = settings.marginTop;
            prefs.bottom = settings.marginBottom;
            prefs.left = settings.marginLeft;
            prefs.right = settings.marginRight;
            if (settings.type === "columns" || settings.type === "modular") {
                prefs.columnCount = settings.columns;
                prefs.columnGutter = settings.columnGutter;
            }
        }
        var baseline = settings.type === "baseline" || settings.addBaseline;
        if (baseline) {
            doc.gridPreferences.baselineDivision = settings.baselineSpacing;
            doc.gridPreferences.baselineStart = settings.marginTop + settings.baselineOffset;
        }
        return { pages: indices.length, baseline: !!baseline };
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

    function makeStyle(doc, s) {
        if (s.output === "guides") {
            return { guides: true };
        }
        var main = swatchFor(doc, s.strokeColor);
        var margin = s.marginColorOn ? swatchFor(doc, s.marginColor) : main;
        var styles = { solid: "Solid", dashed: "Dashed", dotted: "Dotted" };
        return {
            guides: false,
            none: doc.swatches.itemByName("None"),
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
            strokeType: doc.strokeStyles.itemByName(styles[s.lineStyle] || "Solid"),
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

    function tagRoot(item, kind, target) {
        item.insertLabel(LABEL_OWNER, M.OWNER_ID);
        item.insertLabel(LABEL_KIND, kind);
        item.insertLabel(LABEL_PAGE, String(target.index));
        item.insertLabel(LABEL_REGION, target.region || ("artboard:" + target.index));
    }

    A.drawGrid = function (doc, target, grid, kind) {
        var s = grid.settings;
        var layer = ensureManagedLayer(doc);
        var page = doc.pages[target.index];
        var created = withEditableLayer(layer, function () {
            if (s.output === "guides") {
                var guides = drawGuides(page, layer, grid);
                for (var g = 0; g < guides.length; g++) {
                    tagRoot(guides[g], kind, target);
                }
                return { shapes: guides.length, groupName: "" };
            }
            var items = drawShapes(page, layer, grid, makeStyle(doc, s));
            if (!items.length) {
                return { shapes: 0, groupName: "" };
            }
            var root = items.length > 1 ? page.groups.add(items, layer) : items[0];
            root.name = (kind === "preview" ? "Preview: " : "") + GRID_LABELS[s.type] + ", " + target.name;
            tagRoot(root, kind, target);
            root.transparencySettings.blendingSettings.opacity = s.opacity;
            return { shapes: items.length, groupName: root.name };
        });
        layer.visible = true;
        if (kind === "final") {
            layer.locked = s.lockLayer;
        }
        created.layerName = layer.name;
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
