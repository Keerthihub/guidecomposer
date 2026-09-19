/*
 * GuideComposer live QA, part 02: rescue, shape limits, awkward artwork, several documents
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
    var OUT = CONFIG.out + "/02-limits.json";
    $.evalFile(new File(ROOT + "/host/index.jsx"));
    Mullion.boot(encodeURIComponent(ROOT));
    var results = [];
    function record(n, p, d) { results.push({ name: n, pass: p === true, detail: String(d) }); }
    function call(m, p) { return JSON.parse(Mullion.api[m](p === undefined ? "" : encodeURIComponent(JSON.stringify(p)))); }
    function newDoc(space, w, h) { return app.documents.add(space || DocumentColorSpace.RGB, w || 612, h || 792); }
    function ownedGroups(doc) {
        var out = [];
        for (var l = 0; l < doc.layers.length; l++) { var gs = doc.layers[l].groupItems;
            for (var g = 0; g < gs.length; g++) { if (gs[g].parent.typename !== "Layer") continue;
                var tags = gs[g].tags, owner = null;
                for (var t = 0; t < tags.length; t++) if (tags[t].name === "MullionOwner") owner = tags[t].value;
                if (owner === "com.keerthi.guidecomposer") out.push(gs[g]); } }
        return out;
    }
    function try_(n, fn) { try { fn(); } catch (e) { record(n, false, "threw: " + e + (e.line ? " line " + e.line : "")); } }
    var UNLOCKED = { type: "columns", columns: 12, columnGutter: 12, marginTop: 36, marginRight: 36, marginBottom: 36, marginLeft: 36, units: "pt", strokeColor: "#E0457B", strokeWidth: 0.5, opacity: 100, output: "lines", lockLayer: false };

    // close any documents left over by the previous harness run
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

    try_("rescue", function () {
        var doc = newDoc();
        call("generate", { settings: UNLOCKED, target: { mode: "active" } });
        var group = ownedGroups(doc)[0];
        var stray = group.pathItems.rectangle(700, 50, 20, 20);
        stray.name = "user art";
        var cleared = call("clear", { target: { mode: "active" } });
        var survived = false, where = "";
        for (var i = 0; i < doc.pageItems.length; i++) if (doc.pageItems[i].name === "user art") { survived = true; where = doc.pageItems[i].parent.typename + ":" + doc.pageItems[i].parent.name; }
        record("clear rescues artwork dropped into a grid", cleared.ok && survived && cleared.data.rescued === 1, "rescued=" + (cleared.ok ? cleared.data.rescued : "?") + " survived=" + survived + " now in " + where);
        // undo of clear
        app.undo(); app.redraw();
        record("one undo restores a cleared grid", ownedGroups(doc).length === 1, "groups after undo=" + ownedGroups(doc).length);
        doc.close(SaveOptions.DONOTSAVECHANGES);
    });

    try_("limits", function () {
        var doc = newDoc();
        var huge = call("generate", { settings: { type: "pattern", pattern: "dots", patternSize: 2, dotSize: 1, units: "pt", marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0 }, target: { mode: "active" } });
        record("too-dense pattern refused with a clear message", !huge.ok && /\d/.test(huge.error.message), huge.ok ? "drew " + huge.data.shapes : huge.error.message);
        doc.artboards.add([700, 792, 1312, 0]);
        doc.artboards.add([1400, 792, 2012, 0]);
        var many = call("generate", { settings: { type: "pattern", pattern: "square", patternSize: 8, units: "pt", marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0 }, target: { mode: "all" } });
        record("per-request shape cap enforced across artboards", !many.ok || many.data.shapes <= 10000, many.ok ? "drew " + many.data.shapes : many.error.message);
        var tiny = app.documents.add(DocumentColorSpace.RGB, 40, 40);
        var doesntFit = call("generate", { settings: UNLOCKED, target: { mode: "active" } });
        record("margins bigger than the artboard are refused clearly", !doesntFit.ok && /margin/i.test(doesntFit.error.message), doesntFit.ok ? "accepted" : doesntFit.error.message);
        tiny.close(SaveOptions.DONOTSAVECHANGES);
        doc.close(SaveOptions.DONOTSAVECHANGES);
    });

    try_("awkward artwork", function () {
        var doc = newDoc();
        var L = doc.layers[0];
        // clipping mask group
        var clip = L.groupItems.add();
        var mask = clip.pathItems.rectangle(700, 60, 200, 200); mask.clipping = true;
        var inner = clip.pathItems.ellipse(690, 70, 180, 180);
        clip.clipped = true;
        clip.selected = true;
        var g1 = call("selectionGeometry");
        record("clipping mask group is read for construction", g1.ok && g1.data.paths.length >= 1, g1.ok ? "paths=" + g1.data.paths.length : g1.error.message);
        // locked item in the selection for snapping
        doc.selection = null;
        var locked = L.pathItems.rectangle(500, 77, 30, 30);
        locked.locked = true;
        var free = L.pathItems.rectangle(400, 77, 30, 30);
        try { locked.selected = true; } catch (e) {}
        free.selected = true;
        var snap = call("alignSelection", { settings: UNLOCKED, action: "snap" });
        record("snapping skips locked objects instead of failing", snap.ok, snap.ok ? "moved=" + snap.data.moved + " skipped=" + snap.data.skipped : snap.error.message);
        // hidden layer holding the user's art
        doc.selection = null;
        var hiddenLayer = doc.layers.add(); hiddenLayer.name = "hidden art";
        var h = hiddenLayer.pathItems.rectangle(300, 100, 50, 50);
        hiddenLayer.visible = false;
        var gen = call("generate", { settings: UNLOCKED, target: { mode: "active" } });
        record("a hidden user layer does not block generating", gen.ok, gen.ok ? "ok" : gen.error.message);
        doc.close(SaveOptions.DONOTSAVECHANGES);
    });

    try_("multiple documents", function () {
        var a = newDoc();
        var b = newDoc();
        call("generate", { settings: UNLOCKED, target: { mode: "active" } });
        a.activate();
        var st = call("status");
        record("status follows the active document", st.ok && st.data.documentName === a.name, st.ok ? st.data.documentName + " (expected " + a.name + ")" : st.error.message);
        var cp = call("clearPreview", {});
        record("clearPreview with no preview is harmless", cp.ok, cp.ok ? "removed=" + cp.data.removed : cp.error.message);
        b.close(SaveOptions.DONOTSAVECHANGES);
        a.close(SaveOptions.DONOTSAVECHANGES);
    });

    try_("guides and dots rules", function () {
        var doc = newDoc();
        var g = call("generate", { settings: { type: "pattern", pattern: "dots", patternSize: 24, dotSize: 2, units: "pt", output: "guides", marginTop: 36, marginRight: 36, marginBottom: 36, marginLeft: 36 }, target: { mode: "active" } });
        record("dots as guides refused or drawn sensibly", !g.ok || g.data.shapes > 0, g.ok ? "drew " + g.data.shapes : g.error.message);
        doc.close(SaveOptions.DONOTSAVECHANGES);
    });

    closeOurDocuments();
    record("every document this test opened was closed", app.documents.length === theirs.length,
        "open before=" + theirs.length + ", open now=" + app.documents.length);
    var f = new File(OUT); f.encoding = "UTF-8"; f.open("w"); f.write(JSON.stringify({ results: results })); f.close();
    return "wrote " + results.length;
})();
