/*
 * Mullion Illustrator adapter (ExtendScript, ES3 only).
 *
 * The only file that touches the Illustrator DOM. It turns the shapes built by
 * shared/grid-core.js into PathItems and manages what Mullion owns.
 *
 * Ownership model
 *   - Every grid is one GroupItem carrying three tags: owner, kind
 *     ("preview" or "final") and artboard index.
 *   - Every path Mullion draws carries the owner id in its note.
 *   - Only groups whose owner tag equals M.OWNER_ID are ever removed. Layer
 *     names are used to find a place to draw, never to decide what to delete.
 *   - A preview that will replace grids hides them rather than deleting them,
 *     tagging each one it hid, so ending the preview shows exactly those again.
 *   - Before removing an owned group, any child that is not a Mullion path
 *     (for example artwork a user dragged into the group) is moved out and
 *     keeps its locked and hidden state.
 *
 * Illustrator 2026 note: document-level collections such as doc.pathItems can
 * lag behind items added by the same script. This adapter only walks layer and
 * group collections, which update immediately.
 */
(function (M) {
    var A = {};

    var LAYER_NAME = "Mullion grids";
    var TAG_OWNER = "MullionOwner";
    var TAG_KIND = "MullionKind";
    var TAG_ARTBOARD = "MullionArtboard";
    var TAG_HIDDEN = "MullionHiddenByPreview";

    var GRID_LABELS = {
        columns: "Column grid",
        modular: "Modular grid",
        baseline: "Baseline grid",
        composition: "Composition guides",
        pattern: "Pattern grid"
    };

    A.LAYER_NAME = LAYER_NAME;
    A.TAG_OWNER = TAG_OWNER;
    A.TAG_KIND = TAG_KIND;
    A.TAG_ARTBOARD = TAG_ARTBOARD;

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

    A.artboardAt = function (doc, index) {
        var board = doc.artboards[index];
        var r = board.artboardRect;
        return {
            index: index,
            name: board.name,
            rect: [r[0], r[1], r[2], r[3]],
            width: r[2] - r[0],
            height: r[1] - r[3]
        };
    };

    A.activeArtboard = function (doc) {
        return A.artboardAt(doc, doc.artboards.getActiveArtboardIndex());
    };

    A.describe = function (doc) {
        var board = A.activeArtboard(doc);
        var owned = A.findOwnedGroups(doc, { artboards: [board.index] });
        var previews = 0;
        var finals = 0;
        for (var i = 0; i < owned.length; i++) {
            if (owned[i].kind === "preview") {
                previews++;
            } else {
                finals++;
            }
        }
        var artboards = [];
        for (var a = 0; a < doc.artboards.length; a++) {
            var ab = doc.artboards[a];
            var ar = ab.artboardRect;
            artboards.push({ index: a, name: ab.name, rect: [ar[0], ar[1], ar[2], ar[3]] });
        }
        var layer = findManagedLayer(doc);
        return {
            hasDocument: true,
            documentName: doc.name,
            colorSpace: doc.documentColorSpace === DocumentColorSpace.CMYK ? "CMYK" : "RGB",
            artboardCount: doc.artboards.length,
            artboard: board,
            artboards: artboards,
            grids: { preview: previews, generated: finals },
            gridLayer: layer
                ? { exists: true, visible: layer.visible, locked: layer.locked }
                : { exists: false, visible: true, locked: false }
        };
    };

    // Runs fn with Illustrator's document coordinate system, restoring the user's choice.
    function withDocumentCoordinates(fn) {
        var previous = app.coordinateSystem;
        if (previous !== CoordinateSystem.DOCUMENTCOORDINATESYSTEM) {
            app.coordinateSystem = CoordinateSystem.DOCUMENTCOORDINATESYSTEM;
        }
        try {
            return fn();
        } finally {
            if (app.coordinateSystem !== previous) {
                app.coordinateSystem = previous;
            }
        }
    }

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

    // ------------------------------------------------------------- ownership

    function readTags(item) {
        var out = {};
        var tags;
        try {
            tags = item.tags;
        } catch (e) {
            return out;
        }
        for (var i = 0; i < tags.length; i++) {
            out[tags[i].name] = tags[i].value;
        }
        return out;
    }

    function addTag(item, name, value) {
        var tag = item.tags.add();
        tag.name = name;
        tag.value = String(value);
    }

    // Updates a tag's value, adding the tag if the item doesn't have it yet.
    function setTag(item, name, value) {
        for (var i = 0; i < item.tags.length; i++) {
            if (item.tags[i].name === name) {
                item.tags[i].value = String(value);
                return;
            }
        }
        addTag(item, name, value);
    }

    function isMullionPath(item) {
        return item.typename === "PathItem" && item.note === M.OWNER_ID;
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
     * Returns owned grid groups placed directly in top-level layers:
     * [{ group, layer, kind, artboard }].
     * Optional filter: { kind: "preview" | "final", artboards: [indices] }.
     */
    A.findOwnedGroups = function (doc, filter) {
        var found = [];
        filter = filter || {};
        for (var l = 0; l < doc.layers.length; l++) {
            var layer = doc.layers[l];
            var groups = layer.groupItems;
            for (var g = 0; g < groups.length; g++) {
                var group = groups[g];
                if (group.parent.typename !== "Layer") {
                    continue;
                }
                var tags = readTags(group);
                if (tags[TAG_OWNER] !== M.OWNER_ID) {
                    continue;
                }
                var kind = tags[TAG_KIND] === "preview" ? "preview" : "final";
                var artboard = parseInt(tags[TAG_ARTBOARD], 10);
                if (filter.kind !== undefined && filter.kind !== kind) {
                    continue;
                }
                if (filter.artboards !== undefined && !contains(filter.artboards, artboard)) {
                    continue;
                }
                found.push({ group: group, layer: layer, kind: kind, artboard: artboard, hiddenByPreview: tags[TAG_HIDDEN] === "1" });
            }
        }
        return found;
    };

    // Moves a non-Mullion item out of an owned group, preserving its state.
    function rescue(item, group) {
        var wasLocked = item.locked;
        var wasHidden = item.hidden;
        if (wasLocked) {
            item.locked = false;
        }
        if (wasHidden) {
            item.hidden = false;
        }
        item.move(group, ElementPlacement.PLACEBEFORE);
        if (wasHidden) {
            item.hidden = true;
        }
        if (wasLocked) {
            item.locked = true;
        }
    }

    // Removes one owned group. Returns the number of foreign items moved out.
    function removeOwnedGroup(entry) {
        return withEditableLayer(entry.layer, function () {
            var group = entry.group;
            if (group.locked) {
                group.locked = false;
            }
            if (group.hidden) {
                group.hidden = false;
            }
            var foreign = [];
            for (var i = 0; i < group.pageItems.length; i++) {
                if (!isMullionPath(group.pageItems[i])) {
                    foreign.push(group.pageItems[i]);
                }
            }
            for (var f = 0; f < foreign.length; f++) {
                rescue(foreign[f], group);
            }
            group.remove();
            return foreign.length;
        });
    }

    /*
     * Removes owned groups matching filter { kind, artboards }.
     * options.keepLayer leaves an emptied Mullion layer in place (used when a
     * grid is about to be redrawn into it).
     * Returns { removed, rescued, artboards } where artboards counts distinct artboards touched.
     */
    A.removeOwned = function (doc, filter, options) {
        var entries = A.findOwnedGroups(doc, filter);
        var rescued = 0;
        var touched = [];
        // Remove from the end so earlier references stay valid.
        for (var i = entries.length - 1; i >= 0; i--) {
            rescued += removeOwnedGroup(entries[i]);
            if (!contains(touched, entries[i].artboard)) {
                touched.push(entries[i].artboard);
            }
        }
        if (entries.length && !(options && options.keepLayer)) {
            removeEmptyManagedLayer(doc);
        }
        return { removed: entries.length, rescued: rescued, artboards: touched.length };
    };

    // Sets an owned group's hidden state, working around its lock and its layer's lock.
    function setGroupHidden(entry, hidden) {
        withEditableLayer(entry.layer, function () {
            var group = entry.group;
            var wasLocked = group.locked;
            if (wasLocked) {
                group.locked = false;
            }
            group.hidden = hidden;
            setTag(group, TAG_HIDDEN, hidden ? "1" : "0");
            if (wasLocked) {
                group.locked = true;
            }
        });
    }

    // Hides generated grids on the given artboards while a replacing preview is shown.
    A.hideForPreview = function (doc, artboards) {
        var entries = A.findOwnedGroups(doc, { kind: "final", artboards: artboards });
        var hidden = 0;
        for (var i = 0; i < entries.length; i++) {
            if (!entries[i].group.hidden) {
                setGroupHidden(entries[i], true);
                hidden++;
            }
        }
        return hidden;
    };

    // Shows again every generated grid a preview hid. Grids the user hid are left alone.
    A.restorePreviewHidden = function (doc) {
        var entries = A.findOwnedGroups(doc, { kind: "final" });
        var restored = 0;
        for (var i = 0; i < entries.length; i++) {
            if (entries[i].hiddenByPreview) {
                setGroupHidden(entries[i], false);
                restored++;
            }
        }
        return restored;
    };

    // ---------------------------------------------------------------- layers

    function findManagedLayer(doc) {
        for (var i = 0; i < doc.layers.length; i++) {
            if (doc.layers[i].name === LAYER_NAME) {
                return doc.layers[i];
            }
        }
        return null;
    }

    function ensureManagedLayer(doc) {
        var existing = findManagedLayer(doc);
        if (existing) {
            return existing;
        }
        var previousActive = doc.activeLayer;
        var layer = doc.layers.add();
        layer.name = LAYER_NAME;
        layer.printable = false;
        // Adding a layer makes it active; give the user's active layer back.
        try {
            doc.activeLayer = previousActive;
        } catch (e) {
            // The previous layer may be locked or hidden; leaving the new layer active is harmless.
        }
        return layer;
    }

    // Deletes the Mullion layer only when nothing at all remains in it.
    function removeEmptyManagedLayer(doc) {
        var layer = findManagedLayer(doc);
        if (!layer || doc.layers.length < 2) {
            return;
        }
        if (layer.pageItems.length === 0 && layer.layers.length === 0) {
            if (layer.locked) {
                layer.locked = false;
            }
            layer.remove();
        }
    }

    /*
     * Shows/hides or locks/unlocks the Mullion grids layer.
     * changes: { visible?: boolean, locked?: boolean }. Returns false when there is no layer.
     */
    A.setGridLayer = function (doc, changes) {
        var layer = findManagedLayer(doc);
        if (!layer) {
            return false;
        }
        if (typeof changes.visible === "boolean" && layer.visible !== changes.visible) {
            layer.visible = changes.visible;
        }
        if (typeof changes.locked === "boolean" && layer.locked !== changes.locked) {
            layer.locked = changes.locked;
        }
        return true;
    };

    // --------------------------------------------------------------- drawing

    function hexToRgb(hex) {
        return [
            parseInt(hex.substr(1, 2), 16),
            parseInt(hex.substr(3, 2), 16),
            parseInt(hex.substr(5, 2), 16)
        ];
    }

    function makeColor(doc, hex) {
        var rgb = hexToRgb(hex);
        if (doc.documentColorSpace === DocumentColorSpace.CMYK) {
            var cmyk = null;
            try {
                cmyk = app.convertSampleColor(ImageColorSpace.RGB, rgb, ImageColorSpace.CMYK, ColorConvertPurpose.defaultpurpose);
            } catch (e) {
                cmyk = null;
            }
            if (!cmyk || cmyk.length !== 4) {
                var r = rgb[0] / 255;
                var g = rgb[1] / 255;
                var b = rgb[2] / 255;
                var k = 1 - Math.max(r, Math.max(g, b));
                var d = k >= 1 ? 1 : 1 - k;
                cmyk = [
                    k >= 1 ? 0 : (1 - r - k) / d * 100,
                    k >= 1 ? 0 : (1 - g - k) / d * 100,
                    k >= 1 ? 0 : (1 - b - k) / d * 100,
                    k * 100
                ];
            }
            var c = new CMYKColor();
            c.cyan = cmyk[0];
            c.magenta = cmyk[1];
            c.yellow = cmyk[2];
            c.black = cmyk[3];
            return c;
        }
        var color = new RGBColor();
        color.red = rgb[0];
        color.green = rgb[1];
        color.blue = rgb[2];
        return color;
    }

    /*
     * Resolves how each kind of shape is painted.
     * Returns { guides, strokeFor(kind), dashes, roundCaps, width, fill, gutterFill, gutterOpacity }.
     */
    function makeStyle(doc, s) {
        var guides = s.output === "guides";
        if (guides) {
            return { guides: true };
        }
        var main = makeColor(doc, s.strokeColor);
        var margin = s.marginColorOn ? makeColor(doc, s.marginColor) : main;
        var dash = M.core.dashPattern(s.lineStyle, s.strokeWidth);
        return {
            guides: false,
            width: s.strokeWidth,
            main: main,
            margin: margin,
            dashes: dash.dashes,
            roundCaps: dash.roundCaps,
            gutter: s.shadeGutters ? makeColor(doc, s.gutterColor) : null,
            gutterOpacity: s.gutterOpacity
        };
    }

    // Creates one owned path from anchor points and applies the style for its kind.
    function addPath(group, anchors, closed, kind, style) {
        var path = group.pathItems.add();
        path.setEntirePath(anchors);
        path.closed = closed;
        path.note = M.OWNER_ID;
        if (style.guides) {
            path.filled = false;
            path.stroked = false;
            path.guides = true;
        } else if (kind === "gutter") {
            path.stroked = false;
            path.filled = true;
            path.fillColor = style.gutter;
            path.opacity = style.gutterOpacity;
        } else {
            path.filled = false;
            path.stroked = true;
            path.strokeColor = kind === "margin" ? style.margin : style.main;
            path.strokeWidth = style.width;
            if (style.dashes.length) {
                path.strokeDashes = style.dashes;
                if (style.roundCaps) {
                    path.strokeCap = StrokeCap.ROUNDENDCAP;
                }
            }
        }
        return path;
    }

    function drawCurve(group, curve, style) {
        var anchors = [];
        var i;
        for (i = 0; i < curve.points.length; i++) {
            anchors.push(curve.points[i].anchor);
        }
        var path = addPath(group, anchors, curve.closed === true, curve.kind, style);
        var last = curve.points.length - 1;
        for (i = 0; i < curve.points.length; i++) {
            var point = path.pathPoints[i];
            point.leftDirection = curve.points[i].left;
            point.rightDirection = curve.points[i].right;
            point.pointType = (!curve.closed && (i === 0 || i === last)) ? PointType.CORNER : PointType.SMOOTH;
        }
        return path;
    }

    function drawDot(group, dot, style) {
        var r = dot.d / 2;
        // ellipse(top, left, width, height)
        var path = group.pathItems.ellipse(dot.y + r, dot.x - r, dot.d, dot.d);
        path.note = M.OWNER_ID;
        path.stroked = false;
        path.filled = true;
        path.fillColor = style.main;
        return path;
    }

    /*
     * Draws a grid built by MullionCore.buildGrid into a new owned group.
     * kind is "preview" or "final". The grid layer is made visible, because
     * drawing into a hidden layer would look like nothing happened.
     * Returns { shapes, layerName, groupName }.
     */
    A.drawGrid = function (doc, artboard, grid, kind) {
        return withDocumentCoordinates(function () {
            var s = grid.settings;
            var layer = ensureManagedLayer(doc);
            var created = withEditableLayer(layer, function () {
                var group = layer.groupItems.add();
                group.name = (kind === "preview" ? "Preview: " : "") + GRID_LABELS[s.type] + ", " + artboard.name;
                addTag(group, TAG_OWNER, M.OWNER_ID);
                addTag(group, TAG_KIND, kind);
                addTag(group, TAG_ARTBOARD, artboard.index);

                var style = makeStyle(doc, s);
                var list = function (name) { return grid[name] || []; };
                var i, b;
                // Gutter fills go first so lines sit on top of them.
                var boxes = list("boxes");
                for (i = 0; i < boxes.length; i++) {
                    b = boxes[i];
                    if (b.kind === "gutter") {
                        addPath(group, [[b.left, b.top], [b.right, b.top], [b.right, b.bottom], [b.left, b.bottom]], true, "gutter", style);
                    }
                }
                for (i = 0; i < boxes.length; i++) {
                    b = boxes[i];
                    if (b.kind !== "gutter") {
                        addPath(group, [[b.left, b.top], [b.right, b.top], [b.right, b.bottom], [b.left, b.bottom]], true, b.kind, style);
                    }
                }
                var polygons = list("polygons");
                for (i = 0; i < polygons.length; i++) {
                    addPath(group, polygons[i].points, true, polygons[i].kind, style);
                }
                var segments = list("segments");
                for (i = 0; i < segments.length; i++) {
                    var seg = segments[i];
                    addPath(group, [[seg.x1, seg.y1], [seg.x2, seg.y2]], false, seg.kind, style);
                }
                var curves = list("curves");
                for (i = 0; i < curves.length; i++) {
                    drawCurve(group, curves[i], style);
                }
                var dots = list("dots");
                for (i = 0; i < dots.length; i++) {
                    drawDot(group, dots[i], style);
                }
                if (!style.guides) {
                    group.opacity = s.opacity;
                }
                return {
                    shapes: segments.length + boxes.length + polygons.length + curves.length + dots.length,
                    groupName: group.name
                };
            });
            layer.visible = true;
            if (kind === "final") {
                layer.locked = s.lockLayer;
            }
            created.layerName = layer.name;
            return created;
        });
    };

    // Milestone 1 spike, kept as an install diagnostic. Drawn as an owned group so Clear removes it.
    A.drawTestLine = function (doc) {
        var board = A.activeArtboard(doc);
        var r = board.rect;
        var y = (r[1] + r[3]) / 2;
        var grid = {
            settings: { type: "columns", output: "lines", strokeColor: "#E0457B", strokeWidth: 1, opacity: 100, lineStyle: "solid", lockLayer: false },
            segments: [{ kind: "test", x1: r[0], y1: y, x2: r[2], y2: y }]
        };
        var created = A.drawGrid(doc, board, grid, "final");
        return { artboard: board, line: [[r[0], y], [r[2], y]], layerName: created.layerName };
    };

    A.redraw = function () {
        try {
            app.redraw();
        } catch (e) {
            // Redraw is cosmetic; never fail an operation because of it.
        }
    };

    M.adapter = A;
}($.global.Mullion));
