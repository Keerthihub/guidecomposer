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

    var DEPENDENCIES = [
        "host/vendor/json2.js",
        "shared/grid-core.js",
        "host/illustrator-adapter.jsx"
    ];

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
            error: { code: "UNEXPECTED", message: "Illustrator reported an error: " + detail, fields: [] }
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
            throw new HostError("BAD_PAYLOAD", "The panel sent settings Illustrator could not read. Reload the panel and try again.");
        }
        if (!parsed || typeof parsed !== "object") {
            throw new HostError("BAD_PAYLOAD", "The panel sent settings Illustrator could not read. Reload the panel and try again.");
        }
        return parsed;
    }

    // Wraps an API function with readiness checks, payload decoding and error capture.
    function endpoint(fn) {
        return function (encoded) {
            if (!M.ready) {
                return '{"ok":false,"error":{"code":"NOT_READY","message":"Mullion is still starting. Try again in a moment.","fields":[]}}';
            }
            try {
                return respond(fn(decodePayload(encoded)));
            } catch (err) {
                return fail(err);
            }
        };
    }

    M.boot = function (encodedRoot) {
        try {
            var root = decodeURIComponent(String(encodedRoot));
            for (var i = 0; i < DEPENDENCIES.length; i++) {
                var file = new File(root + "/" + DEPENDENCIES[i]);
                if (!file.exists) {
                    return '{"ok":false,"error":{"code":"MISSING_FILE","message":' +
                        quote("Mullion is missing " + DEPENDENCIES[i] + ". Reinstall the extension.") + ',"fields":[]}}';
                }
                $.evalFile(file);
            }
            M.root = root;
            M.core = $.global.MullionCore;
            M.ready = true;
            return respond({ version: M.VERSION });
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
     * Resolves payload.target to artboard descriptions.
     * target: { mode: "active" (default) | "all" | "range", range: "1-3, 5" }
     */
    function resolveTargets(doc, target) {
        var mode = target && target.mode ? target.mode : "active";
        var indices = [];
        var i;
        if (mode === "active") {
            indices.push(doc.artboards.getActiveArtboardIndex());
        } else if (mode === "all") {
            for (i = 0; i < doc.artboards.length; i++) {
                indices.push(i);
            }
        } else if (mode === "range") {
            var parsed = M.core.parseArtboardRange(target.range, doc.artboards.length);
            if (!parsed.ok) {
                throw new HostError("INVALID_TARGET", parsed.error, [{ field: "range", message: parsed.error }]);
            }
            indices = parsed.indices;
        } else {
            throw new HostError("INVALID_TARGET", "Choose which artboards to use: this artboard, all artboards, or a list.");
        }
        var boards = [];
        for (i = 0; i < indices.length; i++) {
            boards.push(M.adapter.artboardAt(doc, indices[i]));
        }
        return boards;
    }

    /*
     * Builds the grid for every target artboard before anything is drawn, so an
     * invalid artboard (for example one too small for the margins) draws nothing.
     */
    function buildForTargets(doc, payload) {
        var boards = resolveTargets(doc, payload.target);
        var builds = [];
        var total = 0;
        for (var i = 0; i < boards.length; i++) {
            var grid = M.core.buildGrid(boards[i].rect, payload.settings || {});
            if (!grid.ok) {
                var message = grid.errors[0].message;
                if (boards.length > 1) {
                    message = boards[i].name + ": " + message;
                }
                throw new HostError("INVALID_SETTINGS", message, grid.errors);
            }
            total += grid.shapeCount;
            builds.push({ artboard: boards[i], grid: grid });
        }
        if (total > M.core.LIMITS.maxTotalShapes) {
            throw new HostError("TOO_MANY_SHAPES",
                "That would draw " + total + " shapes across " + boards.length + " artboards. Choose fewer artboards or a simpler grid to stay at or under " +
                M.core.LIMITS.maxTotalShapes + ".");
        }
        return { builds: builds, shapes: total };
    }

    function drawAll(doc, built, kind) {
        for (var i = 0; i < built.builds.length; i++) {
            M.adapter.drawGrid(doc, built.builds[i].artboard, built.builds[i].grid, kind);
        }
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
            removed += M.adapter.removeOwned(docs[i], { kind: "preview" }).removed;
            M.adapter.restorePreviewHidden(docs[i]);
        }
        return removed;
    }

    function artboardIndices(built) {
        var indices = [];
        for (var i = 0; i < built.builds.length; i++) {
            indices.push(built.builds[i].artboard.index);
        }
        return indices;
    }

    // "add" keeps existing grids so types can be combined; anything else replaces them.
    function replaces(payload) {
        return payload.mode !== "add";
    }

    M.api = {
        // Document, artboards, and grid layer state for the panel.
        status: endpoint(function () {
            var doc = M.adapter.activeDocument();
            if (!doc) {
                return { hasDocument: false };
            }
            return M.adapter.describe(doc);
        }),

        // Replaces all preview grids. When the grid will replace existing grids,
        // those are hidden (never deleted) until the preview ends.
        // Payload: { settings, target, mode: "replace" (default) | "add" }
        preview: endpoint(function (payload) {
            var doc = requireDocument();
            var built = buildForTargets(doc, payload);
            removeAllPreviews();
            var hidden = replaces(payload) ? M.adapter.hideForPreview(doc, artboardIndices(built)) : 0;
            drawAll(doc, built, "preview");
            M.adapter.redraw();
            return summary(doc, built, { hidden: hidden });
        }),

        // Removes preview grids from every artboard of every open document.
        clearPreview: endpoint(function () {
            var removed = removeAllPreviews();
            var doc = M.adapter.activeDocument();
            if (!doc) {
                return { hasDocument: false, removed: removed };
            }
            M.adapter.redraw();
            return summary(doc, null, { removed: removed });
        }),

        // Draws a grid on each target artboard and removes any preview. By default
        // it replaces the Mullion grids already on those artboards; mode "add"
        // keeps them so grid types can be combined.
        // Payload: { settings, target, mode: "replace" (default) | "add" }
        generate: endpoint(function (payload) {
            var doc = requireDocument();
            var built = buildForTargets(doc, payload);
            removeAllPreviews();
            var replaced = { removed: 0, rescued: 0 };
            if (replaces(payload)) {
                replaced = M.adapter.removeOwned(doc, { kind: "final", artboards: artboardIndices(built) }, { keepLayer: true });
            }
            drawAll(doc, built, "final");
            M.adapter.redraw();
            return summary(doc, built, { replaced: replaced.removed, rescued: replaced.rescued });
        }),

        // Removes Mullion grids (preview and generated) from the target artboards.
        // Payload: { target }
        clear: endpoint(function (payload) {
            var doc = requireDocument();
            var boards = resolveTargets(doc, payload.target);
            var indices = [];
            for (var i = 0; i < boards.length; i++) {
                indices.push(boards[i].index);
            }
            var result = M.adapter.removeOwned(doc, { artboards: indices });
            M.adapter.redraw();
            return summary(doc, null, {
                removed: result.removed,
                rescued: result.rescued,
                clearedArtboards: result.artboards,
                targetArtboards: boards.length
            });
        }),

        // Shows/hides or locks/unlocks the Mullion grids layer.
        // Payload: { visible?: boolean, locked?: boolean }
        setGridLayer: endpoint(function (payload) {
            var doc = requireDocument();
            var changed = M.adapter.setGridLayer(doc, payload);
            M.adapter.redraw();
            return { changed: changed, status: M.adapter.describe(doc) };
        }),

        // Milestone 1 spike, kept as an install diagnostic: one line across the artboard.
        drawTestLine: endpoint(function () {
            var doc = requireDocument();
            var result = M.adapter.drawTestLine(doc);
            M.adapter.redraw();
            return result;
        })
    };
}($.global.Mullion));
