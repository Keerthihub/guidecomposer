/*
 * Mullion host entry point (ExtendScript, ES3 only).
 *
 * Loaded once by the manifest's ScriptPath, then booted by the panel with the
 * extension's root folder so dependencies can be loaded by absolute path.
 *
 * Every public function:
 *   - receives at most one argument: a URI-encoded JSON string, so no panel
 *     value is ever spliced into evaluated source code;
 *   - returns a JSON string: {"ok":true,"data":...} or
 *     {"ok":false,"error":{"code":"...","message":"...","fields":[...]}}.
 */
$.global.Mullion = $.global.Mullion || {};

(function (M) {
    M.VERSION = "0.1.0";
    M.OWNER_ID = "com.mullion.panel";
    M.ready = false;

    // The adapter is chosen by host application; everything else is shared.
    var DEPENDENCIES = [
        "host/vendor/json2.js",
        "shared/grid-core.js",
        "@adapter"
    ];

    function adapterFile() {
        return /indesign/i.test(String(app.name)) ? "host/indesign-adapter.jsx" : "host/illustrator-adapter.jsx";
    }

    function HostError(code, message, fields) {
        this.code = code;
        this.message = message;
        this.fields = fields || [];
    }
    M.HostError = HostError;

    function quote(text) {
        // Minimal escaping for the boot failure path, before json2 is loaded.
        return '"' + String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]+/g, " ") + '"';
    }

    function respond(data) {
        return JSON.stringify({ ok: true, data: data });
    }

    // The application's own name, for messages the user reads.
    function appName() {
        return (M.adapter && M.adapter.HOST === "indesign") ? "InDesign" : "Illustrator";
    }
    M.appName = appName;

    function fail(err) {
        if (err instanceof HostError) {
            return JSON.stringify({ ok: false, error: { code: err.code, message: err.message, fields: err.fields } });
        }
        var detail = (err && err.message) ? err.message : String(err);
        if (err && err.line) {
            detail += " (line " + err.line + ")";
        }
        return JSON.stringify({
            ok: false,
            error: { code: "UNEXPECTED", message: appName() + " reported an error: " + detail, fields: [] }
        });
    }

    function decodePayload(encoded) {
        if (encoded === undefined || encoded === null || encoded === "") {
            return {};
        }
        var parsed;
        try {
            parsed = JSON.parse(decodeURIComponent(String(encoded)));
        } catch (e) {
            throw new HostError("BAD_PAYLOAD", "The panel sent settings " + appName() + " could not read. Reload the panel and try again.");
        }
        if (!parsed || typeof parsed !== "object") {
            throw new HostError("BAD_PAYLOAD", "The panel sent settings " + appName() + " could not read. Reload the panel and try again.");
        }
        return parsed;
    }

    /*
     * Wraps an API function with readiness checks, payload decoding and error
     * capture. Each call runs inside the adapter's context, which pins the
     * coordinate system the geometry assumes, and starts from a clean view of
     * the document: anything could have changed between calls.
     */
    function endpoint(fn) {
        return function (encoded) {
            if (!M.ready) {
                return '{"ok":false,"error":{"code":"NOT_READY","message":"Mullion is still starting. Try again in a moment.","fields":[]}}';
            }
            try {
                var payload = decodePayload(encoded);
                if (M.adapter.invalidate) {
                    M.adapter.invalidate();
                }
                return respond(M.adapter.withContext(function () {
                    return fn(payload);
                }));
            } catch (err) {
                return fail(err);
            }
        };
    }

    M.boot = function (encodedRoot) {
        // A boot that fails half way must not leave the previous build's state
        // looking ready, or endpoints would run against a half-replaced global.
        M.ready = false;
        try {
            var root = decodeURIComponent(String(encodedRoot));
            for (var i = 0; i < DEPENDENCIES.length; i++) {
                var relative = DEPENDENCIES[i] === "@adapter" ? adapterFile() : DEPENDENCIES[i];
                var file = new File(root + "/" + relative);
                if (!file.exists) {
                    return '{"ok":false,"error":{"code":"MISSING_FILE","message":' +
                        quote("Mullion is missing " + relative + ". Reinstall the extension.") + ',"fields":[]}}';
                }
                $.evalFile(file);
            }
            M.root = root;
            M.core = $.global.MullionCore;
            M.ready = true;
            M.previewing = false;
            M.previewDoc = null;
            M.previewGroups = [];
            var hostVersion = "";
            try {
                hostVersion = String(app.version);
            } catch (e) {
                hostVersion = "";
            }
            return respond({ version: M.VERSION, host: M.adapter.HOST, hostVersion: hostVersion, schema: M.adapter.SCHEMA || 1 });
        } catch (err) {
            return '{"ok":false,"error":{"code":"BOOT_FAILED","message":' +
                quote("Mullion could not start: " + (err && err.message ? err.message : err)) + ',"fields":[]}}';
        }
    };

    function requireDocument() {
        var doc = M.adapter.activeDocument();
        if (!doc) {
            throw new HostError("NO_DOCUMENT", "Open or create a document to add a grid.");
        }
        return doc;
    }

    /*
     * Resolves payload.target to regions a grid can fill:
     *   [{ index (artboard), name, rect, region, areaLabel }]
     * target: { mode: "active" (default) | "all" | "range" | "selection", range: "1-3, 5" }
     * `region` identifies the area ("artboard:2" or "object:l,t,r,b") so a new grid
     * replaces only the grid previously drawn in the same area.
     */
    function resolveTargets(doc, target) {
        var mode = target && target.mode ? target.mode : "active";
        var count = M.adapter.artboardCount(doc);
        var indices = [];
        var i;
        if (mode === "selection") {
            var objects = M.adapter.selectionTargets(doc);
            if (!objects.length) {
                throw new HostError("NO_SELECTION", "Select one or more objects to put a grid inside them.", [{ field: "selection", message: "Nothing selected." }]);
            }
            return objects;
        }
        if (mode === "active") {
            indices.push(M.adapter.activeArtboardIndex(doc));
        } else if (mode === "all") {
            for (i = 0; i < count; i++) {
                indices.push(i);
            }
        } else if (mode === "range") {
            var parsed = M.core.parseArtboardRange(target.range, count);
            if (!parsed.ok) {
                throw new HostError("INVALID_TARGET", parsed.error, [{ field: "range", message: parsed.error }]);
            }
            indices = parsed.indices;
        } else {
            throw new HostError("INVALID_TARGET", "Choose where to apply the grid: this artboard, all artboards, a list, or the selected objects.");
        }
        var boards = [];
        for (i = 0; i < indices.length; i++) {
            var board = M.adapter.artboardAt(doc, indices[i]);
            board.region = "artboard:" + indices[i];
            board.areaLabel = M.adapter.AREA_NOUN;
            boards.push(board);
        }
        return boards;
    }

    /*
     * Builds the grid for every target before anything is drawn, so an invalid
     * target (for example one too small for the margins) draws nothing.
     */
    function buildForTargets(doc, payload) {
        var targets = resolveTargets(doc, payload.target);
        var builds = [];
        var total = 0;
        for (var i = 0; i < targets.length; i++) {
            var grid = M.core.buildGrid(targets[i].rect, payload.settings || {}, { areaLabel: targets[i].areaLabel });
            if (!grid.ok) {
                var message = grid.errors[0].message;
                if (targets.length > 1) {
                    message = targets[i].name + ": " + message;
                }
                throw new HostError("INVALID_SETTINGS", message, grid.errors);
            }
            total += grid.shapeCount;
            builds.push({ artboard: targets[i], grid: grid });
        }
        if (total > M.core.LIMITS.maxTotalShapes) {
            throw new HostError("TOO_MANY_SHAPES",
                "That would draw " + total + " shapes across " + targets.length + " areas. Choose fewer areas or a simpler grid to stay at or under " +
                M.core.LIMITS.maxTotalShapes + ".");
        }
        return { builds: builds, shapes: total };
    }

    function roundKey(v) {
        return Math.round(v * 100) / 100;
    }

    /*
     * Construction lines for the selected artwork, as a single build.
     * The region is keyed by the artwork's bounds, so regenerating replaces the
     * construction for the same artwork.
     */
    function buildConstructionTarget(doc, payload) {
        var geometry = M.adapter.selectionPaths(doc);
        if (!geometry.paths.length) {
            throw new HostError("NO_SELECTION", geometry.hasText
                ? "Construction lines need paths. Convert the text to outlines (Type > Create Outlines) and try again."
                : "Select a logo or artwork to draw its construction lines.");
        }
        var board = M.adapter.artboardAt(doc, geometry.artboard);
        var result = M.core.buildConstruction(geometry.paths, board.rect, payload.settings || {});
        if (!result.ok) {
            throw new HostError("INVALID_SETTINGS", result.errors[0].message, result.errors);
        }
        var c = result.content;
        board.name = "Artwork on " + board.name;
        board.region = "construction:" + roundKey(c.left) + "," + roundKey(c.top) + "," + roundKey(c.right) + "," + roundKey(c.bottom);
        return { builds: [{ artboard: board, grid: result }], shapes: result.shapeCount };
    }

    function buildFor(doc, payload) {
        return payload.kind === "construction" ? buildConstructionTarget(doc, payload) : buildForTargets(doc, payload);
    }

    // Draws every built grid and returns the groups created, so a replace can
    // delete the old grids without touching the ones just drawn.
    function drawAll(doc, built, kind) {
        var created = [];
        for (var i = 0; i < built.builds.length; i++) {
            var result = M.adapter.drawGrid(doc, built.builds[i].artboard, built.builds[i].grid, kind);
            // Guides are drawn as several roots; everything else as one group.
            var roots = (result && result.groups) ? result.groups : ((result && result.group) ? [result.group] : []);
            for (var r = 0; r < roots.length; r++) {
                created.push(roots[r]);
            }
        }
        return created;
    }

    function summary(doc, built, extra) {
        var first = built ? built.builds[0].grid : null;
        var out = {
            shapes: built ? built.shapes : 0,
            artboards: built ? built.builds.length : 0,
            metrics: first ? first.metrics : null,
            status: M.adapter.describe(doc)
        };
        for (var key in extra) {
            if (extra.hasOwnProperty(key)) {
                out[key] = extra[key];
            }
        }
        return out;
    }

    // Removes preview grids from every open document, and shows again any grids
    // those previews hid, so switching documents while previewing never strands
    // a preview or a hidden grid. Returns the number of previews removed.
    function removeAllPreviews() {
        var removed = 0;
        var docs = M.adapter.openDocuments();
        for (var i = 0; i < docs.length; i++) {
            removed += M.adapter.endPreview(docs[i]).removed;
        }
        return removed;
    }

    function regionsOf(built) {
        var regions = [];
        for (var i = 0; i < built.builds.length; i++) {
            regions.push(built.builds[i].artboard.region);
        }
        return regions;
    }

    // "add" keeps existing grids so types can be combined; anything else replaces them.
    function replaces(payload) {
        return payload.mode !== "add";
    }

    function readPositiveLength(value, units, label) {
        var n = M.core.parseNumber(value);
        if (!(typeof n === "number" && n > 0 && isFinite(n))) {
            throw new HostError("INVALID_SIZE", label + " must be greater than 0.");
        }
        return M.core.toPoints(n, units);
    }

    M.api = {
        // Document, artboards, selection, and grid layer state for the panel.
        status: endpoint(function () {
            var doc = M.adapter.activeDocument();
            if (!doc) {
                return { hasDocument: false, host: M.adapter.HOST, version: M.VERSION };
            }
            var described = M.adapter.describe(doc);
            /*
             * A preview is temporary, but it is ordinary document content while it
             * is on screen: a crash, a force quit, or a document saved mid-preview
             * leaves it behind, with the real grid it replaced still hidden.
             * Anything in a document this session is not actively previewing into
             * is stale, including a reopened copy of a file saved mid-preview.
             */
            /*
             * Only the preview groups this session drew are live. Anything else
             * carrying the preview tag came from somewhere the panel cannot see:
             * a crash, or a copy of a file saved while a preview was on screen.
             */
            var keep = M.previewing ? (M.previewGroups || []) : [];
            if (described.grids.strayPreviews || described.grids.hiddenByPreview) {
                var recovered = M.adapter.transaction("Recover preview", function () {
                    return M.adapter.endPreview(doc, keep).removed;
                });
                M.adapter.redraw();
                described = M.adapter.describe(doc);
                described.recoveredPreviews = recovered;
            }
            described.version = M.VERSION;
            return described;
        }),

        // Replaces all preview grids. When the grid will replace existing grids,
        // those are hidden (never deleted) until the preview ends.
        // Payload: { settings, target, mode: "replace" (default) | "add" }
        preview: endpoint(function (payload) {
            var doc = requireDocument();
            var built = buildFor(doc, payload);
            M.previewing = true;
            M.previewDoc = doc;
            var hidden = M.adapter.transaction("Preview grid", function () {
                removeAllPreviews();
                var count = replaces(payload) ? M.adapter.hideForPreview(doc, regionsOf(built)) : 0;
                M.previewGroups = drawAll(doc, built, "preview");
                return count;
            });
            M.adapter.redraw();
            return summary(doc, built, { hidden: hidden });
        }),

        // Removes preview grids from every artboard of every open document.
        clearPreview: endpoint(function () {
            M.previewing = false;
            M.previewDoc = null;
            M.previewGroups = [];
            var removed = M.adapter.activeDocument() ? M.adapter.transaction("Remove preview", removeAllPreviews) : 0;
            var doc = M.adapter.activeDocument();
            if (!doc) {
                return { hasDocument: false, removed: removed };
            }
            M.adapter.redraw();
            return summary(doc, null, { removed: removed });
        }),

        // Draws a grid in each target area and removes any preview. By default it
        // replaces the Mullion grids already in those areas; mode "add" keeps
        // them so grid types can be combined.
        // Payload: { settings, target, mode: "replace" (default) | "add" }
        generate: endpoint(function (payload) {
            var doc = requireDocument();
            var built = buildFor(doc, payload);
            M.previewing = false;
            M.previewDoc = null;
            M.previewGroups = [];
            /*
             * The new grid is drawn before the old one is removed. Drawing is the
             * step that can fail (a locked sublayer, an artboard deleted while the
             * panel was open), and failing after the delete would leave the user
             * with neither grid.
             */
            var replaced = M.adapter.transaction("Generate grid", function () {
                removeAllPreviews();
                var created = drawAll(doc, built, "final");
                if (!replaces(payload)) {
                    return { removed: 0, rescued: 0, kept: 0 };
                }
                return M.adapter.removeOwned(doc, { kind: "final", regions: regionsOf(built), exclude: created }, { keepLayer: true });
            });
            M.adapter.redraw();
            return summary(doc, built, { replaced: replaced.removed, rescued: replaced.rescued, kept: replaced.kept });
        }),

        // Removes Mullion grids (preview and generated). Artboard targets clear
        // everything on those artboards, including grids inside objects there;
        // the selection target clears the grids inside the selected objects.
        // Payload: { target }
        clear: endpoint(function (payload) {
            var doc = requireDocument();
            var filter = {};
            var i;
            if (payload.kind === "construction") {
                // Construction lines on the active artboard, wherever the artwork has moved.
                var active = M.adapter.activeArtboardIndex(doc);
                var cleared = M.adapter.transaction("Clear construction lines", function () {
                    return M.adapter.removeOwned(doc, { artboards: [active], regionPrefix: "construction:" });
                });
                M.adapter.redraw();
                return summary(doc, null, { removed: cleared.removed, rescued: cleared.rescued, kept: cleared.kept, clearedArtboards: cleared.artboards, targetArtboards: 1 });
            }
            var targets = resolveTargets(doc, payload.target);
            if (payload.target && payload.target.mode === "selection") {
                filter.regions = [];
                for (i = 0; i < targets.length; i++) {
                    filter.regions.push(targets[i].region);
                }
            } else {
                filter.artboards = [];
                for (i = 0; i < targets.length; i++) {
                    filter.artboards.push(targets[i].index);
                }
                // Clearing every artboard also sweeps grids stranded by a deleted
                // artboard; they belong to no artboard and are unreachable otherwise.
                if (payload.target && payload.target.mode === "all") {
                    filter.includeOrphans = true;
                }
            }
            var result = M.adapter.transaction("Clear grids", function () {
                return M.adapter.removeOwned(doc, filter);
            });
            M.adapter.redraw();
            return summary(doc, null, {
                removed: result.removed,
                rescued: result.rescued,
                // Grids the user has edited are handed back rather than deleted.
                kept: result.kept,
                clearedArtboards: result.artboards,
                targetArtboards: targets.length
            });
        }),

        // Shows/hides or locks/unlocks the Mullion grids layer.
        // Payload: { visible?: boolean, locked?: boolean }
        setGridLayer: endpoint(function (payload) {
            var doc = requireDocument();
            var changed = M.adapter.transaction("Grid layer", function () {
                return M.adapter.setGridLayer(doc, payload);
            });
            M.adapter.redraw();
            return { changed: changed, status: M.adapter.describe(doc) };
        }),

        // Resizes target artboards, keeping each one's top-left corner in place.
        // Payload: { width, height, units, target }
        resizeArtboards: endpoint(function (payload) {
            var doc = requireDocument();
            if (payload.target && payload.target.mode === "selection") {
                throw new HostError("INVALID_TARGET", "Choose artboards to resize, not selected objects.");
            }
            var units = payload.units || "pt";
            if (!/^(pt|px|mm|in)$/.test(units)) {
                throw new HostError("INVALID_SIZE", "Choose a unit: pt, px, mm, or in.");
            }
            var width = readPositiveLength(payload.width, units, "Width");
            var height = readPositiveLength(payload.height, units, "Height");
            var targets = resolveTargets(doc, payload.target);
            M.adapter.transaction("Resize", function () {
                for (var i = 0; i < targets.length; i++) {
                    M.adapter.resizeArtboard(doc, targets[i].index, width, height);
                }
            });
            M.adapter.redraw();
            return { resized: targets.length, width: width, height: height, status: M.adapter.describe(doc) };
        }),

        // Checks selected objects against the grid on their artboards.
        // action "check" reports, "select" selects off-grid objects, "snap" moves
        // them onto the nearest grid lines. Payload: { settings, action }
        alignSelection: endpoint(function (payload) {
            var doc = requireDocument();
            var action = payload.action || "check";
            var items = M.adapter.selectionItems(doc);
            if (!items.length) {
                throw new HostError("NO_SELECTION", "Select the objects to check against the grid.");
            }
            var cache = {};
            var offGrid = [];
            var maxOffset = 0;
            var moved = 0;
            var skipped = 0;
            var snaps = [];
            for (var i = 0; i < items.length; i++) {
                var item = items[i];
                var key = String(item.artboard);
                if (!cache.hasOwnProperty(key)) {
                    var board = M.adapter.artboardAt(doc, item.artboard);
                    var grid = M.core.buildGrid(board.rect, payload.settings || {}, { areaLabel: M.adapter.AREA_NOUN });
                    if (!grid.ok) {
                        throw new HostError("INVALID_SETTINGS", board.name + ": " + grid.errors[0].message, grid.errors);
                    }
                    cache[key] = M.core.snapLines(grid);
                }
                var snap = M.core.snapRect(item.rect, cache[key]);
                if (snap.onGrid) {
                    continue;
                }
                offGrid.push(item);
                snaps.push(snap);
                maxOffset = Math.max(maxOffset, Math.abs(snap.dx), Math.abs(snap.dy));
            }
            if (action === "snap" && offGrid.length) {
                M.adapter.transaction("Snap to grid", function () {
                    for (var s = 0; s < offGrid.length; s++) {
                        if (M.adapter.moveItem(offGrid[s], snaps[s].dx, snaps[s].dy)) {
                            moved++;
                        } else {
                            skipped++;
                        }
                    }
                });
            }
            if (action === "select") {
                M.adapter.selectItems(doc, offGrid);
            }
            M.adapter.redraw();
            return {
                checked: items.length,
                offGrid: offGrid.length,
                maxOffset: Math.round(maxOffset * 100) / 100,
                moved: moved,
                skipped: skipped,
                status: M.adapter.describe(doc)
            };
        }),

        // Paths of the selected artwork for the panel's live construction drawing.
        selectionGeometry: endpoint(function () {
            var doc = M.adapter.activeDocument();
            if (!doc) {
                return { paths: [], hasText: false };
            }
            var geometry = M.adapter.selectionPaths(doc);
            var board = M.adapter.artboardAt(doc, geometry.artboard);
            for (var p = 0; p < geometry.paths.length; p++) {
                var pts = geometry.paths[p].points;
                for (var q = 0; q < pts.length; q++) {
                    pts[q] = {
                        anchor: [roundKey(pts[q].anchor[0]), roundKey(pts[q].anchor[1])],
                        left: [roundKey(pts[q].left[0]), roundKey(pts[q].left[1])],
                        right: [roundKey(pts[q].right[0]), roundKey(pts[q].right[1])]
                    };
                }
            }
            return { paths: geometry.paths, hasText: geometry.hasText, truncated: geometry.truncated, artboard: board };
        }),

        /*
         * The settings that made the grid on the active area, read back from the
         * grid itself. A document therefore carries the recipe for its own grid:
         * reopen a file and the panel can offer the settings that drew it.
         */
        documentGrid: endpoint(function () {
            var doc = requireDocument();
            var active = M.adapter.activeArtboardIndex(doc);
            var entries = M.adapter.findOwnedGroups(doc, { kind: "final", artboards: [active] });
            for (var i = 0; i < entries.length; i++) {
                if (!entries[i].settings) {
                    continue;
                }
                var parsed = null;
                try {
                    parsed = JSON.parse(entries[i].settings);
                } catch (e) {
                    parsed = null;
                }
                if (parsed && parsed.settings) {
                    return { found: true, schema: parsed.schema || 0, settings: parsed.settings, area: entries[i].region };
                }
            }
            return { found: false };
        }),

        // Reads type size and leading from the selected text, for baseline grids.
        textMetrics: endpoint(function () {
            var doc = requireDocument();
            var metrics = M.adapter.readTextMetrics(doc);
            if (!metrics) {
                throw new HostError("NO_TEXT", "Select a text frame, or click into text, to read its leading.");
            }
            return metrics;
        }),

        // InDesign only: sets the target pages' own margins and columns, and the
        // document baseline grid, from grid settings. Payload: { settings, target }
        applyPageMargins: endpoint(function (payload) {
            var doc = requireDocument();
            if (payload.target && payload.target.mode === "selection") {
                throw new HostError("INVALID_TARGET", "Page margins apply to pages, not selected objects.");
            }
            var normalized = M.core.normalizeSettings(payload.settings || {});
            if (!normalized.ok) {
                throw new HostError("INVALID_SETTINGS", normalized.errors[0].message, normalized.errors);
            }
            var s = normalized.settings;
            if (s.columnRatios) {
                throw new HostError("INVALID_SETTINGS", "InDesign page columns are equal widths. Clear Column widths to use them.");
            }
            var targets = resolveTargets(doc, payload.target);
            var indices = [];
            for (var i = 0; i < targets.length; i++) {
                indices.push(targets[i].index);
            }
            var result = M.adapter.transaction("Page margins", function () {
                return M.adapter.applyPageMargins(doc, indices, s);
            });
            return {
                pages: result.pages,
                baseline: result.baseline,
                facingPages: result.facingPages,
                mirroredPages: result.mirroredPages,
                baselineIsDocumentWide: result.baselineIsDocumentWide,
                status: M.adapter.describe(doc)
            };
        }),

        // Milestone 1 spike, kept as an install diagnostic: one line across the artboard.
        drawTestLine: endpoint(function () {
            var doc = requireDocument();
            var result = M.adapter.transaction("Test line", function () {
                return M.adapter.drawTestLine(doc);
            });
            M.adapter.redraw();
            return result;
        })
    };
}($.global.Mullion));
