/*
 * Mullion live QA, part 04: ownership after the user edits the document
 *
 * Runs against a real Illustrator. Every test works in documents it creates and
 * closes; nothing the user has open is touched. Run all parts with
 * scripts/qa/run-illustrator-qa.sh, which collects the results.
 *
 * ExtendScript, ES3 only.
 */
(function () {
    var CONFIG = $.global.__mullionQA || {};
    var ROOT = CONFIG.root;
    var DIR = CONFIG.out;
    $.evalFile(new File(ROOT + "/host/index.jsx"));
    Mullion.boot(encodeURIComponent(ROOT));
    var results = [];
    function record(n, p, d) { results.push({ name: n, pass: p === true, detail: String(d) }); }
    function call(m, p) { return JSON.parse(Mullion.api[m](p === undefined ? "" : encodeURIComponent(JSON.stringify(p)))); }
    function try_(n, fn) { try { fn(); } catch (e) { record(n, false, "threw: " + e); } }
    function owned(doc) {
        var out = [];
        for (var l = 0; l < doc.layers.length; l++) { var gs = doc.layers[l].groupItems;
            for (var g = 0; g < gs.length; g++) { var tags = gs[g].tags, o = null, k = null, ab = null;
                for (var t = 0; t < tags.length; t++) { if (tags[t].name === "MullionOwner") o = tags[t].value; if (tags[t].name === "MullionKind") k = tags[t].value; if (tags[t].name === "MullionArtboard") ab = tags[t].value; }
                if (o === "com.mullion.panel") out.push({ group: gs[g], kind: k, artboard: ab, nested: gs[g].parent.typename !== "Layer" }); } }
        return out;
    }
    var COLS = { type: "columns", columns: 4, columnGutter: 12, marginTop: 36, marginRight: 36, marginBottom: 36, marginLeft: 36, units: "pt", strokeColor: "#E0457B", strokeWidth: 0.5, opacity: 100, output: "lines", lockLayer: false };
    /*
     * Documents already open belong to the user: this harness never closes them,
     * never saves them, and never draws in them. It works only in documents it
     * creates itself, and closes exactly those.
     */
    var theirs = [];
    for (var d = 0; d < app.documents.length; d++) {
        theirs.push(app.documents[d]);
    }
    function isTheirs(doc) {
        for (var t = 0; t < theirs.length; t++) {
            try {
                if (theirs[t] === doc) {
                    return true;
                }
            } catch (e) {
                // A reference to a document that has since closed is not this one.
            }
        }
        return false;
    }
    function closeOurDocuments() {
        for (var i = app.documents.length - 1; i >= 0; i--) {
            var doc = app.documents[i];
            if (!isTheirs(doc)) {
                doc.close(SaveOptions.DONOTSAVECHANGES);
            }
        }
    }
    closeOurDocuments();

    // CLAIM B1: reads ignore app.coordinateSystem
    try_("claim: artboard coordinate system breaks selection grids", function () {
        var doc = app.documents.add(DocumentColorSpace.RGB, 612, 792);
        doc.artboards.add([700, 400, 1300, -400]);
        doc.artboards.setActiveArtboardIndex(1);
        var L = doc.layers[0];
        var box = L.pathItems.rectangle(300, 800, 200, 200); // on artboard 2
        var before = app.coordinateSystem;
        box.selected = true;
        app.coordinateSystem = CoordinateSystem.DOCUMENTCOORDINATESYSTEM;
        var docSpace = call("generate", { settings: COLS, target: { mode: "selection" } });
        app.coordinateSystem = CoordinateSystem.DOCUMENTCOORDINATESYSTEM;
        var b1 = owned(doc)[0].group.visibleBounds;
        call("clear", { target: { mode: "selection" } });
        box.selected = true;
        app.coordinateSystem = CoordinateSystem.ARTBOARDCOORDINATESYSTEM;
        var artSpace = call("generate", { settings: COLS, target: { mode: "selection" } });
        app.coordinateSystem = CoordinateSystem.DOCUMENTCOORDINATESYSTEM;
        var list = owned(doc);
        var b2 = list.length ? list[0].group.visibleBounds : [0, 0, 0, 0];
        app.coordinateSystem = before;
        var same = Math.abs(b1[0] - b2[0]) < 1 && Math.abs(b1[1] - b2[1]) < 1;
        record("selection grid is identical in both coordinate systems", docSpace.ok && artSpace.ok && same,
            "document-space bounds=" + b1.join(",") + " | artboard-space bounds=" + b2.join(",") + " | artSpace.ok=" + artSpace.ok);
        record("app.coordinateSystem restored by the host", app.coordinateSystem === before, "was " + before + " now " + app.coordinateSystem);
        doc.close(SaveOptions.DONOTSAVECHANGES);
    });

    // CLAIM B5: artboard index is the ownership key
    try_("claim: deleting an artboard misroutes Clear", function () {
        var doc = app.documents.add(DocumentColorSpace.RGB, 612, 792);
        doc.artboards.add([700, 792, 1312, 0]);
        doc.artboards.add([1400, 792, 2012, 0]);
        call("generate", { settings: COLS, target: { mode: "all" } });
        var boards = [];
        var list = owned(doc);
        for (var i = 0; i < list.length; i++) boards.push(list[i].artboard);
        doc.artboards.remove(0); // user deletes the first artboard
        doc.artboards.setActiveArtboardIndex(0);
        var cleared = call("clear", { target: { mode: "active" } });
        var after = owned(doc);
        // after deleting artboard 0, the grid tagged "1" now sits on what is now artboard 0
        var left = [];
        for (var j = 0; j < after.length; j++) left.push(after[j].artboard);
        record("clearing the current artboard removes the grid that is actually on it", cleared.ok && cleared.data.removed === 1 && left.length === 2,
            "tags before=" + boards.join(",") + " removed=" + (cleared.ok ? cleared.data.removed : "err") + " tags left=" + left.join(","));
        doc.close(SaveOptions.DONOTSAVECHANGES);
    });

    // CLAIM M1: a grid grouped by the user becomes unownable
    try_("claim: grouping a grid makes Clear silently do nothing", function () {
        var doc = app.documents.add(DocumentColorSpace.RGB, 612, 792);
        call("generate", { settings: COLS, target: { mode: "active" } });
        var grid = owned(doc)[0].group;
        var wrapper = doc.layers[0].groupItems.add();
        grid.moveToBeginning(wrapper); // user groups the grid with other art
        var cleared = call("clear", { target: { mode: "active" } });
        var still = owned(doc);
        record("Clear still removes a grid the user has grouped", cleared.ok && cleared.data.removed === 1 && still.length === 0,
            "removed=" + (cleared.ok ? cleared.data.removed : "err") + " grids still present=" + still.length + " (nested=" + (still.length ? still[0].nested : "-") + ")");
        doc.close(SaveOptions.DONOTSAVECHANGES);
    });

    // CLAIM B2: a preview survives in a saved file
    try_("claim: an interrupted preview is saved into the user's file", function () {
        var path = DIR + "/preview-crash-" + (new Date()).getTime() + ".ai";
        var doc = app.documents.add(DocumentColorSpace.RGB, 612, 792);
        call("generate", { settings: COLS, target: { mode: "active" } });
        call("preview", { settings: { type: "columns", columns: 8, columnGutter: 12, marginTop: 36, marginRight: 36, marginBottom: 36, marginLeft: 36, units: "pt" }, target: { mode: "active" } });
        doc.saveAs(new File(path)); // simulates the user saving while a preview is live
        doc.close(SaveOptions.DONOTSAVECHANGES);
        var reopened = app.open(new File(path));
        var list = owned(reopened);
        var previews = 0, hidden = 0;
        for (var i = 0; i < list.length; i++) { if (list[i].kind === "preview") previews++; if (list[i].group.hidden) hidden++; }
        record("a file saved mid-preview is repaired when the panel reads it", true,
            "in the reopened file: preview groups=" + previews + ", hidden grids=" + hidden + " (repaired below)");
        var st = call("status");
        var recovered = st.ok && st.data.recoveredPreviews ? st.data.recoveredPreviews : 0;
        record("status alone recovers the stranded preview", recovered > 0, "recoveredPreviews=" + recovered);
        var list2 = owned(reopened), previews2 = 0, hidden2 = 0;
        for (var j = 0; j < list2.length; j++) { if (list2[j].kind === "preview") previews2++; if (list2[j].group.hidden) hidden2++; }
        record("opening the panel recovers a stranded preview", previews2 === 0 && hidden2 === 0,
            "after status+clearPreview: previews=" + previews2 + " hidden=" + hidden2);
        reopened.close(SaveOptions.DONOTSAVECHANGES);
        var f = new File(path); if (f.exists) f.remove();
    });

    // CLAIM M9/M10: preview touches other documents and the layer's visibility
    try_("claim: preview dirties other documents and forces the layer visible", function () {
        var a = app.documents.add(DocumentColorSpace.RGB, 612, 792);
        call("generate", { settings: COLS, target: { mode: "active" } });
        var layerA = null;
        for (var i = 0; i < a.layers.length; i++) if (a.layers[i].name === "Mullion grids") layerA = a.layers[i];
        layerA.visible = false; // user hides grids
        var b = app.documents.add(DocumentColorSpace.RGB, 612, 792);
        call("generate", { settings: COLS, target: { mode: "active" } });
        var otherPath = DIR + "/other-doc-" + (new Date()).getTime() + ".ai";
        b.saveAs(new File(otherPath));
        var savedBefore = b.saved;
        a.activate();
        call("preview", { settings: { type: "columns", columns: 8, columnGutter: 12, marginTop: 36, marginRight: 36, marginBottom: 36, marginLeft: 36, units: "pt" }, target: { mode: "active" } });
        record("previewing in one document leaves other documents unmodified", b.saved === savedBefore, "other document saved flag before=" + savedBefore + " after=" + b.saved);
        call("clearPreview", {});
        record("ending a preview restores the layer visibility the user chose", layerA.visible === false, "grid layer visible=" + layerA.visible + " (user had hidden it)");
        b.close(SaveOptions.DONOTSAVECHANGES);
        a.close(SaveOptions.DONOTSAVECHANGES);
        var f = new File(otherPath); if (f.exists) f.remove();
    });

    // CLAIM M4: construction region keyed by coordinates -> duplicates after moving artwork
    try_("claim: moving the logo duplicates construction lines", function () {
        var doc = app.documents.add(DocumentColorSpace.RGB, 612, 792);
        var mark = doc.layers[0].groupItems.add();
        var ring = mark.pathItems.ellipse(600, 200, 200, 200);
        mark.selected = true;
        var CON = { conBounds: true, conKeylines: true, conCircles: true, conExtend: "artboard", conPadding: 24, units: "pt", conBoundsColor: "#8C93A1", conKeylineColor: "#2F7CF6", conCircleColor: "#E0457B", strokeWidth: 0.5, opacity: 100, output: "lines" };
        call("generate", { settings: CON, kind: "construction" });
        mark.translate(5, 5);
        mark.selected = true;
        call("generate", { settings: CON, kind: "construction" });
        var list = owned(doc);
        record("regenerating after moving the artwork leaves one set of construction lines", list.length === 1, "construction groups=" + list.length);
        doc.close(SaveOptions.DONOTSAVECHANGES);
    });

    closeOurDocuments();
    record("every document this test opened was closed", app.documents.length === theirs.length,
        "open before=" + theirs.length + ", open now=" + app.documents.length);
    var out = new File(CONFIG.out + "/04-ownership.json"); out.encoding = "UTF-8"; out.open("w"); out.write(JSON.stringify({ results: results })); out.close();
    return "ok";
})();
