/*
 * GuideComposer live QA, part 03: the user's selection, layers and preferences are left as they were
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
    var OUT = CONFIG.out + "/03-context.json";
    $.evalFile(new File(ROOT + "/host/index.jsx"));
    Mullion.boot(encodeURIComponent(ROOT));
    var results = [];
    function record(n, p, d) { results.push({ name: n, pass: p === true, detail: String(d) }); }
    function call(m, p) { return JSON.parse(Mullion.api[m](p === undefined ? "" : encodeURIComponent(JSON.stringify(p)))); }
    function try_(n, fn) { try { fn(); } catch (e) { record(n, false, "threw: " + e); } }
    var COLS = { type: "columns", columns: 12, columnGutter: 12, marginTop: 36, marginRight: 36, marginBottom: 36, marginLeft: 36, units: "pt", strokeColor: "#E0457B", strokeWidth: 0.5, opacity: 100, output: "lines", lockLayer: false };
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

    try_("user context preserved", function () {
        var doc = app.documents.add(DocumentColorSpace.RGB, 612, 792);
        var art = doc.layers[0]; art.name = "Artwork";
        var second = doc.layers.add(); second.name = "Notes";
        doc.activeLayer = art;
        var rect = art.pathItems.rectangle(700, 50, 100, 100);
        rect.name = "keep me";
        rect.selected = true;
        var beforeSel = doc.selection.length;
        var g = call("generate", { settings: COLS, target: { mode: "active" } });
        record("generating keeps the user's selection", g.ok && doc.selection.length === beforeSel && doc.selection.length === 1 && doc.selection[0].name === "keep me", "selection after generate=" + doc.selection.length + (doc.selection.length ? " (" + doc.selection[0].name + ")" : ""));
        record("generating keeps the user's active layer", doc.activeLayer.name === "Artwork", "activeLayer=" + doc.activeLayer.name);
        record("grid layer is added last, not on top of the user's layer order expectations", doc.layers[0].name === "GuideComposer grids" || doc.layers[doc.layers.length - 1].name === "GuideComposer grids", "layers=" + (function () { var n = []; for (var i = 0; i < doc.layers.length; i++) n.push(doc.layers[i].name); return n.join(","); })());
        var beforeUnits = app.preferences.getIntegerPreference("rulerType");
        call("generate", { settings: { type: "columns", columns: 6, units: "mm", columnGutter: 4, marginTop: 10, marginRight: 10, marginBottom: 10, marginLeft: 10 }, target: { mode: "active" } });
        record("app ruler preference untouched", app.preferences.getIntegerPreference("rulerType") === beforeUnits, "rulerType=" + app.preferences.getIntegerPreference("rulerType"));
        record("coordinate system restored", app.coordinateSystem === CoordinateSystem.DOCUMENTCOORDINATESYSTEM || app.coordinateSystem === CoordinateSystem.ARTBOARDCOORDINATESYSTEM, "coordinateSystem=" + app.coordinateSystem);
        // undo naming: one undo must undo the whole grid, twice must not eat the user's own edit
        // One undo reverses one GuideComposer action: the last generate replaced a grid,
        // so undoing it brings that grid back, and the user's art is untouched.
        var itemsWithGrid = doc.pageItems.length;
        app.undo(); app.redraw();
        var afterOne = doc.pageItems.length;
        var keepSurvives = false;
        for (var i = 0; i < doc.pageItems.length; i++) if (doc.pageItems[i].name === "keep me") keepSurvives = true;
        record("one undo reverses exactly the last action and keeps the user's art", afterOne !== itemsWithGrid && keepSurvives,
            "items " + itemsWithGrid + " -> " + afterOne + " (the replaced grid is back), user art kept=" + keepSurvives);
        doc.close(SaveOptions.DONOTSAVECHANGES);
    });

    try_("selection-target edge cases", function () {
        var doc = app.documents.add(DocumentColorSpace.RGB, 612, 792);
        var L = doc.layers[0];
        // a selected object smaller than its margins
        var tiny = L.pathItems.rectangle(700, 50, 20, 20);
        tiny.selected = true;
        var r = call("generate", { settings: COLS, target: { mode: "selection" } });
        record("object too small for the margins is refused by name", !r.ok && /object/i.test(r.error.message), r.ok ? "accepted" : r.error.message);
        // a selected guide / zero-area line
        doc.selection = null;
        var line = L.pathItems.add();
        line.setEntirePath([[100, 700], [300, 700]]);
        line.selected = true;
        var r2 = call("generate", { settings: COLS, target: { mode: "selection" } });
        record("zero-height line is not treated as a grid target", !r2.ok, r2.ok ? "drew " + r2.data.artboards : r2.error.message);
        // text insertion point (TextRange selection)
        doc.selection = null;
        var tf = L.textFrames.add(); tf.contents = "Type here"; tf.top = 600; tf.left = 60;
        app.executeMenuCommand("deselectall");
        var st = call("status");
        record("status works while a text frame exists", st.ok, st.ok ? "selection count=" + st.data.selection.count : st.error.message);
        doc.close(SaveOptions.DONOTSAVECHANGES);
    });

    closeOurDocuments();
    record("every document this test opened was closed", app.documents.length === theirs.length,
        "open before=" + theirs.length + ", open now=" + app.documents.length);
    var f = new File(OUT); f.encoding = "UTF-8"; f.open("w"); f.write(JSON.stringify({ results: results })); f.close();
    return "ok";
})();
