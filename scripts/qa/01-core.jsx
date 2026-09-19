/*
 * Mullion live QA, part 01: generate, undo, replace, clear, outputs, artboards, previews, construction
 *
 * Runs against a real Illustrator. Every test works in documents it creates and
 * closes; nothing the user has open is touched. Run all parts with
 * scripts/qa/run-illustrator-qa.sh, which collects the results.
 *
 * ExtendScript, ES3 only.
 */
// Read-only-ish audit harness: every test runs in documents this script creates and closes.
(function () {
    var CONFIG = $.global.__mullionQA || {};
    var ROOT = CONFIG.root;
    var OUT = CONFIG.out + "/01-core.json";
    $.evalFile(new File(ROOT + "/host/index.jsx"));
    var boot = Mullion.boot(encodeURIComponent(ROOT));
    var results = [];
    // Start from a clean slate: any document left by an earlier part is this
    // harness's own, and leftovers make later tests fail for the wrong reason.
    while (app.documents.length) {
        app.documents[0].close(SaveOptions.DONOTSAVECHANGES);
    }
    var openedBefore = app.documents.length;

    function record(name, pass, detail) {
        results.push({ name: name, pass: pass === true, detail: String(detail) });
    }
    function call(method, payload) {
        var raw = Mullion.api[method](payload === undefined ? "" : encodeURIComponent(JSON.stringify(payload)));
        return JSON.parse(raw);
    }
    function newDoc(space, w, h) {
        return app.documents.add(space || DocumentColorSpace.RGB, w || 612, h || 792);
    }
    function countItems(doc) { return doc.pageItems.length; }
    function gridLayer(doc) {
        for (var i = 0; i < doc.layers.length; i++) { if (doc.layers[i].name === "Mullion grids") return doc.layers[i]; }
        return null;
    }
    function ownedGroups(doc) {
        var out = [];
        for (var l = 0; l < doc.layers.length; l++) {
            var gs = doc.layers[l].groupItems;
            for (var g = 0; g < gs.length; g++) {
                if (gs[g].parent.typename !== "Layer") continue;
                var tags = gs[g].tags, owner = null;
                for (var t = 0; t < tags.length; t++) if (tags[t].name === "MullionOwner") owner = tags[t].value;
                if (owner === "com.mullion.panel") out.push(gs[g]);
            }
        }
        return out;
    }
    function try_(name, fn) {
        var doc = null;
        try { fn(); } catch (e) { record(name, false, "threw: " + e + (e.line ? " line " + e.line : "")); }
    }

    var COLS = { type: "columns", columns: 12, columnGutter: 12, marginTop: 36, marginRight: 36, marginBottom: 36, marginLeft: 36, units: "pt", strokeColor: "#E0457B", strokeWidth: 0.5, opacity: 100, output: "lines", lockLayer: true };

    record("boot", boot && JSON.parse(boot).ok === true, boot);

    // ---- 1. generate / undo / replace / clear
    try_("core workflow", function () {
        var doc = newDoc();
        var base = countItems(doc);
        var gen = call("generate", { settings: COLS, target: { mode: "active" } });
        record("generate columns", gen.ok && gen.data.shapes === 26, gen.ok ? gen.data.shapes + " shapes" : gen.error.message);
        record("grid layer non-printing", gridLayer(doc) && gridLayer(doc).printable === false, gridLayer(doc) ? "printable=" + gridLayer(doc).printable : "no layer");
        record("grid layer locked by lockLayer", gridLayer(doc) && gridLayer(doc).locked === true, gridLayer(doc) ? "locked=" + gridLayer(doc).locked : "no layer");
        app.undo();
        app.redraw();
        record("one undo removes the grid", countItems(doc) === base, "items after undo=" + countItems(doc) + " base=" + base);
        app.redo();
        var again = call("generate", { settings: COLS, target: { mode: "active" } });
        record("generate twice replaces", again.ok && again.data.replaced === 1 && ownedGroups(doc).length === 1, again.ok ? "replaced=" + again.data.replaced + " groups=" + ownedGroups(doc).length : again.error.message);
        var added = call("generate", { settings: { type: "baseline", baselineSpacing: 24, units: "pt", marginTop: 36, marginRight: 36, marginBottom: 36, marginLeft: 36 }, target: { mode: "active" }, mode: "add" });
        record("add mode keeps both grids", added.ok && ownedGroups(doc).length === 2, added.ok ? "groups=" + ownedGroups(doc).length : added.error.message);
        // user artwork dropped into a grid group must survive Clear
        var layer = gridLayer(doc);
        layer.locked = false;
        var group = ownedGroups(doc)[0];
        var stray = group.pathItems.rectangle(700, 50, 20, 20);
        stray.name = "user art";
        var cleared = call("clear", { target: { mode: "active" } });
        var survived = false;
        for (var i = 0; i < doc.pageItems.length; i++) if (doc.pageItems[i].name === "user art") survived = true;
        record("clear removes grids", cleared.ok && ownedGroups(doc).length === 0, cleared.ok ? "removed=" + cleared.data.removed : cleared.error.message);
        record("clear rescues user artwork", survived && cleared.data.rescued === 1, "rescued=" + (cleared.ok ? cleared.data.rescued : "?") + " survived=" + survived);
        doc.close(SaveOptions.DONOTSAVECHANGES);
    });

    // ---- 2. outputs: guides, boxes, colour space
    try_("outputs", function () {
        var doc = newDoc();
        var g = call("generate", { settings: { type: "columns", columns: 4, columnGutter: 12, marginTop: 36, marginRight: 36, marginBottom: 36, marginLeft: 36, units: "pt", output: "guides" }, target: { mode: "active" } });
        var guides = 0, groups = ownedGroups(doc);
        if (groups.length) for (var i = 0; i < groups[0].pathItems.length; i++) if (groups[0].pathItems[i].guides) guides++;
        record("guides output makes real guides", g.ok && guides > 0, g.ok ? guides + " guides" : g.error.message);
        call("clear", { target: { mode: "active" } });
        var b = call("generate", { settings: { type: "modular", columns: 3, rows: 3, columnGutter: 12, rowGutter: 12, marginTop: 36, marginRight: 36, marginBottom: 36, marginLeft: 36, units: "pt", output: "boxes", strokeColor: "#E0457B" }, target: { mode: "active" } });
        record("boxes output", b.ok && b.data.shapes === 9, b.ok ? b.data.shapes + " boxes" : b.error.message);
        doc.close(SaveOptions.DONOTSAVECHANGES);

        var cmyk = newDoc(DocumentColorSpace.CMYK);
        var c = call("generate", { settings: COLS, target: { mode: "active" } });
        var kind = "none";
        var cg = ownedGroups(cmyk);
        if (cg.length && cg[0].pathItems.length) kind = cg[0].pathItems[0].strokeColor.typename;
        record("CMYK document gets CMYK colour", c.ok && kind === "CMYKColor", "stroke=" + kind);
        cmyk.close(SaveOptions.DONOTSAVECHANGES);
    });

    // ---- 3. artboards: multiple, negative coordinates, ranges
    try_("artboards", function () {
        var doc = newDoc();
        doc.artboards.add([700, 400, 1300, -400]);          // to the right, crossing y=0
        doc.artboards.add([-900, -100, -300, -900]);        // negative coordinates
        var all = call("generate", { settings: COLS, target: { mode: "all" } });
        record("generate on all artboards", all.ok && all.data.artboards === 3 && ownedGroups(doc).length === 3, all.ok ? "boards=" + all.data.artboards + " groups=" + ownedGroups(doc).length : all.error.message);
        // every grid must sit inside its own artboard
        var inside = true, detail = "";
        var groups = ownedGroups(doc);
        for (var i = 0; i < groups.length; i++) {
            var tags = groups[i].tags, idx = null;
            for (var t = 0; t < tags.length; t++) if (tags[t].name === "MullionArtboard") idx = parseInt(tags[t].value, 10);
            var r = doc.artboards[idx].artboardRect;
            var vb = groups[i].visibleBounds;
            if (vb[0] < r[0] - 1 || vb[1] > r[1] + 1 || vb[2] > r[2] + 1 || vb[3] < r[3] - 1) { inside = false; detail += "board " + idx + " grid " + vb.join(",") + " vs " + r.join(",") + "; "; }
        }
        record("grids land inside their own artboard (incl. negative coords)", inside, detail || "all 3 within bounds");
        var clearedOne = call("clear", { target: { mode: "range", range: "2" } });
        record("clear a range leaves other artboards alone", clearedOne.ok && ownedGroups(doc).length === 2, clearedOne.ok ? "groups left=" + ownedGroups(doc).length : clearedOne.error.message);
        var bad = call("generate", { settings: COLS, target: { mode: "range", range: "9" } });
        record("bad range refused with a message", !bad.ok && /doesn't exist/.test(bad.error.message), bad.ok ? "accepted" : bad.error.message);
        doc.close(SaveOptions.DONOTSAVECHANGES);
    });

    // ---- 4. preview lifecycle
    try_("preview", function () {
        var doc = newDoc();
        call("generate", { settings: COLS, target: { mode: "active" } });
        var p = call("preview", { settings: { type: "columns", columns: 6, columnGutter: 12, marginTop: 36, marginRight: 36, marginBottom: 36, marginLeft: 36, units: "pt" }, target: { mode: "active" } });
        var hiddenCount = 0, groups = ownedGroups(doc);
        for (var i = 0; i < groups.length; i++) if (groups[i].hidden) hiddenCount++;
        record("preview hides the grid it replaces", p.ok && p.data.hidden === 1 && hiddenCount === 1, p.ok ? "hidden=" + p.data.hidden : p.error.message);
        var cp = call("clearPreview", {});
        var stillHidden = 0; groups = ownedGroups(doc);
        for (var j = 0; j < groups.length; j++) if (groups[j].hidden) stillHidden++;
        record("ending the preview restores the hidden grid", cp.ok && stillHidden === 0 && ownedGroups(doc).length === 1, "hidden after clearPreview=" + stillHidden + " groups=" + ownedGroups(doc).length);
        // simulate a panel crash: preview, then generate without clearing the preview
        call("preview", { settings: { type: "columns", columns: 6, units: "pt", marginTop: 36, marginRight: 36, marginBottom: 36, marginLeft: 36 }, target: { mode: "active" } });
        var gen2 = call("generate", { settings: COLS, target: { mode: "active" } });
        var leftHidden = 0; groups = ownedGroups(doc);
        for (var k = 0; k < groups.length; k++) if (groups[k].hidden) leftHidden++;
        record("generate after a preview leaves nothing hidden", gen2.ok && leftHidden === 0, "hidden=" + leftHidden + " groups=" + ownedGroups(doc).length);
        doc.close(SaveOptions.DONOTSAVECHANGES);
    });

    // ---- 5. selection grids, align, construct, text
    try_("selection and construct", function () {
        var doc = newDoc();
        var L = doc.layers[0];
        var card1 = L.pathItems.rectangle(700, 50, 200, 200);
        var card2 = L.pathItems.rectangle(400, 50, 200, 200);
        card1.selected = true; card2.selected = true;
        var sel = call("generate", { settings: { type: "columns", columns: 2, columnGutter: 10, marginTop: 10, marginRight: 10, marginBottom: 10, marginLeft: 10, units: "pt" }, target: { mode: "selection" } });
        record("grid inside each selected object", sel.ok && sel.data.artboards === 2, sel.ok ? "objects=" + sel.data.artboards : sel.error.message);
        call("clear", { target: { mode: "selection" } });
        // align
        doc.selection = null;
        var stray = L.pathItems.rectangle(500, 77, 30, 30);
        stray.selected = true;
        var check = call("alignSelection", { settings: COLS, action: "check" });
        record("align check finds off-grid objects", check.ok && check.data.offGrid === 1, check.ok ? "offGrid=" + check.data.offGrid : check.error.message);
        var snap = call("alignSelection", { settings: COLS, action: "snap" });
        record("align snap moves them", snap.ok && snap.data.moved === 1, snap.ok ? "moved=" + snap.data.moved : snap.error.message);
        var check2 = call("alignSelection", { settings: COLS, action: "check" });
        record("after snapping, nothing is off grid", check2.ok && check2.data.offGrid === 0, check2.ok ? "offGrid=" + check2.data.offGrid : check2.error.message);
        // construct from a group with an ellipse and a compound path
        doc.selection = null;
        var mark = L.groupItems.add();
        var ring = mark.pathItems.ellipse(600, 200, 200, 200);
        var inner = mark.pathItems.ellipse(560, 240, 120, 120);
        mark.selected = true;
        var geo = call("selectionGeometry");
        record("selectionGeometry reads a group", geo.ok && geo.data.paths.length === 2, geo.ok ? "paths=" + geo.data.paths.length : geo.error.message);
        var con = call("generate", { settings: { conBounds: true, conKeylines: true, conCircles: true, conCenter: false, conDiagonals: false, conExtend: "artboard", conPadding: 24, units: "pt", conBoundsColor: "#8C93A1", conKeylineColor: "#2F7CF6", conCircleColor: "#E0457B", strokeWidth: 0.5, opacity: 100, output: "lines" }, kind: "construction" });
        record("construction lines drawn", con.ok && con.data.shapes > 4, con.ok ? con.data.shapes + " shapes, circles=" + con.data.metrics.circles : con.error.message);
        record("construction finds both circles", con.ok && con.data.metrics.circles === 2, con.ok ? "circles=" + con.data.metrics.circles : "n/a");
        var conClear = call("clear", { kind: "construction" });
        record("construction clear removes only construction", conClear.ok && conClear.data.removed === 1, conClear.ok ? "removed=" + conClear.data.removed : conClear.error.message);
        // text selected
        doc.selection = null;
        var tf = L.textFrames.add(); tf.contents = "Logo"; tf.top = 700; tf.left = 60; tf.selected = true;
        var conText = call("generate", { settings: { conBounds: true, conKeylines: true, conCircles: true, conExtend: "artboard", conPadding: 24, units: "pt" }, kind: "construction" });
        record("outlined-text guidance for text selection", !conText.ok && /outlines/i.test(conText.error.message), conText.ok ? "accepted text" : conText.error.message);
        var tm = call("textMetrics");
        record("textMetrics reads leading", tm.ok && tm.data.size > 0, tm.ok ? tm.data.size + "/" + tm.data.leading : tm.error.message);
        doc.close(SaveOptions.DONOTSAVECHANGES);
    });

    // ---- 6. layer states, resize, InDesign-only endpoint
    try_("layer states and misc", function () {
        var doc = newDoc();
        call("generate", { settings: COLS, target: { mode: "active" } });
        var layer = gridLayer(doc);
        layer.locked = true; layer.visible = false;
        var onLocked = call("generate", { settings: { type: "baseline", baselineSpacing: 24, units: "pt", marginTop: 36, marginRight: 36, marginBottom: 36, marginLeft: 36 }, target: { mode: "active" } });
        record("generate works on a locked, hidden grid layer", onLocked.ok, onLocked.ok ? "ok" : onLocked.error.message);
        record("layer lock state is restored after drawing", gridLayer(doc).locked === true, "locked=" + gridLayer(doc).locked + " visible=" + gridLayer(doc).visible);
        var clr = call("clear", { target: { mode: "active" } });
        record("clear works on a locked layer", clr.ok, clr.ok ? "removed=" + clr.data.removed : clr.error.message);
        var rs = call("resizeArtboards", { width: 210, height: 297, units: "mm", target: { mode: "active" } });
        var r = doc.artboards[0].artboardRect;
        record("resize artboard keeps the top-left corner", rs.ok && Math.abs(r[0] - 0) < 0.01 && Math.abs(r[1] - 792) < 0.01 && Math.abs((r[2] - r[0]) - 595.276) < 0.1, "rect=" + r.join(","));
        var pm = call("applyPageMargins", { settings: COLS, target: { mode: "active" } });
        record("page margins refused in Illustrator with guidance", !pm.ok && /InDesign/.test(pm.error.message), pm.ok ? "accepted" : pm.error.message);
        var tl = call("drawTestLine", {});
        record("draw test line", tl.ok, tl.ok ? "ok" : tl.error.message);
        doc.close(SaveOptions.DONOTSAVECHANGES);
    });

    // ---- 7. no document and malformed payloads
    try_("error paths", function () {
        var noDoc = app.documents.length === 0 ? call("generate", { settings: COLS, target: { mode: "active" } }) : null;
        if (noDoc) record("no document handled", !noDoc.ok && noDoc.error.code === "NO_DOCUMENT", noDoc.error.message);
        var raw = Mullion.api.generate("%%%not-json%%%");
        var parsed = JSON.parse(raw);
        record("malformed payload rejected, not crashed", parsed.ok === false, raw.substr(0, 120));
        var hostile = call("generate", { settings: { type: "columns", columns: 12, strokeColor: "#E0457B\"); alert(\"x" }, target: { mode: "active" } });
        record("hostile colour string rejected", !hostile.ok, hostile.ok ? "accepted" : hostile.error.message);
    });

    record("documents left open equals before", app.documents.length === openedBefore, "before=" + openedBefore + " after=" + app.documents.length);

    var f = new File(OUT);
    f.encoding = "UTF-8";
    f.open("w");
    f.write(JSON.stringify({ results: results }));
    f.close();
    return "wrote " + results.length + " results";
})();
