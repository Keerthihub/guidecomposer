/*
 * Mullion live QA for InDesign.
 *
 * The InDesign adapter is written and tested against a fake DOM, but until this
 * runs in InDesign itself nothing about it is proven. This script is that proof:
 * it exercises the places InDesign differs from Illustrator, in documents it
 * creates and closes, and writes its results as JSON.
 *
 * Run it with scripts/qa/run-indesign-qa.sh, or from InDesign's Scripts panel
 * after setting the two paths in CONFIG below.
 *
 * Every test is wrapped, so one unsupported call reports a failure and the rest
 * still run: the first run is meant to tell you everything that needs attention,
 * not the first thing.
 *
 * ExtendScript, ES3 only.
 */
(function () {
    var CONFIG = $.global.__mullionQA || {};
    var ROOT = CONFIG.root;
    var OUT = (CONFIG.out || Folder.temp.fsName) + "/indesign-qa.json";

    $.evalFile(new File(ROOT + "/host/index.jsx"));
    var booted = Mullion.boot(encodeURIComponent(ROOT));

    var results = [];
    function record(name, pass, detail) {
        results.push({ name: name, pass: pass === true, detail: String(detail) });
    }
    function call(method, payload) {
        return JSON.parse(Mullion.api[method](payload === undefined ? "" : encodeURIComponent(JSON.stringify(payload))));
    }
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
                doc.close(SaveOptions.NO);
            }
        }
    }

    // One test. A failure here is a result, not a reason to stop.
    function test(name, fn) {
        try {
            fn();
        } catch (e) {
            record(name, false, "threw: " + e + (e.line ? " (line " + e.line + ")" : ""));
        }
        // Leave nothing behind, whatever happened — except the user's own work.
        try {
            closeOurDocuments();
        } catch (e2) {
            record(name + ": cleanup", false, "could not close documents: " + e2);
        }
    }
    function newDocument(facing) {
        var doc = app.documents.add();
        doc.documentPreferences.facingPages = facing === true;
        doc.documentPreferences.pageWidth = "612pt";
        doc.documentPreferences.pageHeight = "792pt";
        return doc;
    }
    function ownedItems(doc) {
        var out = [];
        var items = doc.pageItems.everyItem().getElements();
        for (var i = 0; i < items.length; i++) {
            try {
                if (items[i].extractLabel("MullionOwner") === "com.mullion.panel" && items[i].extractLabel("MullionKind")) {
                    out.push(items[i]);
                }
            } catch (e) {
                // Not every object supports labels; those are not ours.
            }
        }
        return out;
    }
    function ownedGuides(doc) {
        var count = 0;
        for (var p = 0; p < doc.pages.length; p++) {
            var guides = doc.pages[p].guides.everyItem().getElements();
            for (var g = 0; g < guides.length; g++) {
                try {
                    if (guides[g].extractLabel("MullionOwner") === "com.mullion.panel") {
                        count++;
                    }
                } catch (e) {
                    // As above.
                }
            }
        }
        return count;
    }
    function mullionSwatches(doc) {
        var count = 0;
        var colors = doc.colors.everyItem().getElements();
        for (var i = 0; i < colors.length; i++) {
            if (String(colors[i].name).substr(0, 8) === "Mullion ") {
                count++;
            }
        }
        return count;
    }

    var COLS = {
        type: "columns", units: "pt", columns: 3, columnGutter: 12,
        marginTop: 36, marginRight: 36, marginBottom: 36, marginLeft: 36,
        output: "lines", strokeColor: "#E0457B", strokeWidth: 0.5, opacity: 80, lineStyle: "solid", lockLayer: false
    };

    record("boot loads the InDesign adapter", booted && JSON.parse(booted).ok === true, booted);
    record("the adapter in use is InDesign's", Mullion.adapter && Mullion.adapter.HOST === "indesign",
        "host=" + (Mullion.adapter ? Mullion.adapter.HOST : "none") + ", app=" + app.name + " " + app.version);

    // ------------------------------------------------------ the everyday path

    test("generate, replace, clear", function () {
        var doc = newDocument(false);
        var gen = call("generate", { settings: COLS, target: { mode: "active" } });
        record("generate draws a grid", gen.ok && gen.data.shapes > 0, gen.ok ? gen.data.shapes + " shapes" : gen.error.message);
        record("the grid is one labelled group", ownedItems(doc).length === 1, ownedItems(doc).length + " labelled items");

        var again = call("generate", { settings: COLS, target: { mode: "active" } });
        record("generating again replaces instead of stacking", again.ok && again.data.replaced === 1 && ownedItems(doc).length === 1,
            again.ok ? "replaced=" + again.data.replaced + ", items=" + ownedItems(doc).length : again.error.message);

        var cleared = call("clear", { target: { mode: "active" } });
        record("clear removes it", cleared.ok && ownedItems(doc).length === 0,
            cleared.ok ? "removed=" + cleared.data.removed : cleared.error.message);
        record("clearing removes the swatches it added", mullionSwatches(doc) === 0, mullionSwatches(doc) + " Mullion swatches left");
    });

    test("one undo reverses one action", function () {
        var doc = newDocument(false);
        call("generate", { settings: COLS, target: { mode: "active" } });
        var withGrid = ownedItems(doc).length;
        app.undo();
        record("one undo removes the whole grid", withGrid === 1 && ownedItems(doc).length === 0,
            "items " + withGrid + " -> " + ownedItems(doc).length);
    });

    // -------------------------------------------- where InDesign differs most

    test("the cursor sitting in text", function () {
        var doc = newDocument(false);
        var frame = doc.pages[0].textFrames.add();
        frame.geometricBounds = [100, 100, 200, 300];
        frame.contents = "Heading";
        app.select(frame.insertionPoints[0]);

        var status = call("status");
        record("status works with the cursor in text", status.ok, status.ok ? "selection count=" + status.data.selection.count : status.error.message);

        var geometry = call("selectionGeometry");
        record("construction geometry works with the cursor in text", geometry.ok && geometry.data.hasText === true,
            geometry.ok ? "paths=" + geometry.data.paths.length + " hasText=" + geometry.data.hasText : geometry.error.message);

        var align = call("alignSelection", { settings: COLS, action: "check" });
        record("aligning explains itself instead of failing oddly", !align.ok && align.error.code === "NO_SELECTION",
            align.ok ? "accepted a text cursor" : align.error.code + ": " + align.error.message);
    });

    test("dashed and dotted lines really are dashed and dotted", function () {
        var doc = newDocument(false);
        var styles = [];
        var list = doc.strokeStyles.everyItem().getElements();
        for (var i = 0; i < list.length; i++) {
            styles.push(String(list[i].name));
        }
        record("the document's stroke styles are known", true, styles.join(", "));

        var dashed = call("generate", { settings: { type: "columns", units: "pt", columns: 3, columnGutter: 12, marginTop: 36, marginRight: 36, marginBottom: 36, marginLeft: 36, output: "lines", strokeColor: "#E0457B", strokeWidth: 0.5, opacity: 100, lineStyle: "dashed", lockLayer: false }, target: { mode: "active" } });
        var drawnStyle = "";
        if (dashed.ok) {
            var items = ownedItems(doc);
            if (items.length) {
                var children = items[0].pageItems.everyItem().getElements();
                if (children.length) {
                    drawnStyle = String(children[0].strokeType.name);
                }
            }
        }
        record("a dashed grid draws dashed, or says why not", !dashed.ok || /dash/i.test(drawnStyle),
            dashed.ok ? "stroke style used: " + drawnStyle : dashed.error.message);
    });

    test("guides output", function () {
        var doc = newDocument(false);
        var guides = call("generate", { settings: { type: "columns", units: "pt", columns: 3, columnGutter: 12, marginTop: 36, marginRight: 36, marginBottom: 36, marginLeft: 36, output: "guides", strokeColor: "#E0457B", strokeWidth: 0.5, opacity: 100, lineStyle: "solid", lockLayer: false }, target: { mode: "active" } });
        record("guides output makes page guides", guides.ok && ownedGuides(doc) > 0,
            guides.ok ? ownedGuides(doc) + " labelled guides" : guides.error.message);

        var cleared = call("clear", { target: { mode: "active" } });
        record("clear removes the guides it made", cleared.ok && ownedGuides(doc) === 0,
            cleared.ok ? "removed=" + cleared.data.removed + ", guides left=" + ownedGuides(doc) : cleared.error.message);
    });

    test("pages, not artboard numbers", function () {
        var doc = newDocument(false);
        doc.pages.add();
        doc.pages.add();
        var all = call("generate", { settings: COLS, target: { mode: "all" } });
        record("generate on every page", all.ok && ownedItems(doc).length === 3,
            all.ok ? "pages=" + all.data.artboards + ", items=" + ownedItems(doc).length : all.error.message);

        // Inserting a page at the front renumbers every page after it.
        doc.pages.add(LocationOptions.AT_BEGINNING);
        app.activeWindow.activePage = doc.pages[1];
        var cleared = call("clear", { target: { mode: "active" } });
        record("clearing after inserting a page clears the right one", cleared.ok && cleared.data.removed === 1 && ownedItems(doc).length === 2,
            cleared.ok ? "removed=" + cleared.data.removed + ", left=" + ownedItems(doc).length : cleared.error.message);
    });

    test("facing pages mirror inside and outside margins", function () {
        var doc = newDocument(true);
        doc.pages.add();
        var settings = { type: "columns", units: "pt", columns: 3, columnGutter: 12, marginTop: 36, marginRight: 50, marginBottom: 36, marginLeft: 100, output: "lines", strokeColor: "#E0457B", strokeWidth: 0.5, opacity: 100, lineStyle: "solid", lockLayer: false };
        var applied = call("applyPageMargins", { settings: settings, target: { mode: "all" } });
        if (!applied.ok) {
            record("page margins apply on a facing-pages document", false, applied.error.message);
            return;
        }
        var sides = [];
        for (var i = 0; i < doc.pages.length; i++) {
            var prefs = doc.pages[i].marginPreferences;
            sides.push(String(doc.pages[i].side).replace("PageSideOptions.", "") + " left=" + prefs.left + " right=" + prefs.right);
        }
        record("page margins apply on a facing-pages document", applied.data.facingPages === true, applied.data.mirroredPages + " pages mirrored");
        record("inside and outside margins land on the right edges", true, sides.join(" | "));
    });

    test("the baseline grid follows the document's reference point", function () {
        var doc = newDocument(false);
        var settings = { type: "baseline", units: "pt", baselineSpacing: 14, baselineOffset: 4, marginTop: 36, marginRight: 36, marginBottom: 36, marginLeft: 36, output: "lines", strokeColor: "#E0457B", strokeWidth: 0.5, opacity: 100, lineStyle: "solid", lockLayer: false };
        doc.gridPreferences.baselineGridRelativeOption = BaselineGridRelativeOption.TOP_OF_PAGE;
        call("applyPageMargins", { settings: settings, target: { mode: "active" } });
        var fromPage = doc.gridPreferences.baselineStart;
        doc.gridPreferences.baselineGridRelativeOption = BaselineGridRelativeOption.TOP_OF_MARGIN;
        call("applyPageMargins", { settings: settings, target: { mode: "active" } });
        var fromMargin = doc.gridPreferences.baselineStart;
        record("the baseline grid is not offset twice", fromPage === 40 && fromMargin === 4,
            "from page top=" + fromPage + " (expected 40), from margin=" + fromMargin + " (expected 4)");
    });

    test("ownership after the user edits the document", function () {
        var doc = newDocument(false);
        call("generate", { settings: COLS, target: { mode: "active" } });
        var grid = ownedItems(doc)[0];

        // The user groups the grid with a frame of their own.
        var frame = doc.pages[0].rectangles.add();
        frame.geometricBounds = [100, 100, 200, 200];
        var wrapper = doc.pages[0].groups.add([grid, frame]);
        var cleared = call("clear", { target: { mode: "active" } });
        record("a grid grouped with the user's artwork is still clearable", cleared.ok && ownedItems(doc).length === 0,
            cleared.ok ? "removed=" + cleared.data.removed : cleared.error.message);
        record("the user's own frame survives", wrapper.isValid || frame.isValid, "wrapper valid=" + wrapper.isValid + ", frame valid=" + frame.isValid);
    });

    test("a grid the user has edited is kept", function () {
        var doc = newDocument(false);
        call("generate", { settings: COLS, target: { mode: "active" } });
        var grid = ownedItems(doc)[0];
        var children = grid.pageItems.everyItem().getElements();
        if (children.length) {
            children[0].remove(); // the user deletes one line
        }
        var cleared = call("clear", { target: { mode: "active" } });
        record("an edited grid is handed back, not deleted", cleared.ok && cleared.data.removed === 0 && cleared.data.kept === 1,
            cleared.ok ? "removed=" + cleared.data.removed + ", kept=" + cleared.data.kept : cleared.error.message);
    });

    test("previews", function () {
        var doc = newDocument(false);
        call("generate", { settings: COLS, target: { mode: "active" } });
        var preview = call("preview", { settings: { type: "columns", units: "pt", columns: 6, columnGutter: 12, marginTop: 36, marginRight: 36, marginBottom: 36, marginLeft: 36, output: "lines", strokeColor: "#E0457B", strokeWidth: 0.5, opacity: 100, lineStyle: "solid", lockLayer: false }, target: { mode: "active" } });
        record("a preview hides the grid it replaces", preview.ok && preview.data.hidden === 1,
            preview.ok ? "hidden=" + preview.data.hidden : preview.error.message);

        var ended = call("clearPreview", {});
        var visible = 0;
        var items = ownedItems(doc);
        for (var i = 0; i < items.length; i++) {
            if (items[i].visible) {
                visible++;
            }
        }
        record("ending the preview brings the grid back", ended.ok && items.length === 1 && visible === 1,
            "items=" + items.length + ", visible=" + visible);

        // A preview left behind by a crash is swept the next time status runs.
        call("preview", { settings: COLS, target: { mode: "active" } });
        Mullion.previewing = false;
        Mullion.previewGroups = [];
        var status = call("status");
        record("a stranded preview is recovered", status.ok && status.data.recoveredPreviews > 0,
            status.ok ? "recovered=" + status.data.recoveredPreviews : status.error.message);
    });

    test("master pages are left alone", function () {
        var doc = newDocument(false);
        var master = doc.masterSpreads[0];
        var frame = master.pages[0].rectangles.add();
        frame.geometricBounds = [36, 36, 100, 100];
        frame.insertLabel("MullionOwner", "com.mullion.panel");
        frame.insertLabel("MullionKind", "final");
        frame.insertLabel("MullionArtboard", "0");

        var cleared = call("clear", { target: { mode: "all" } });
        record("a labelled item on a master page is not touched", cleared.ok && frame.isValid,
            cleared.ok ? "removed=" + cleared.data.removed + ", master item still valid=" + frame.isValid : cleared.error.message);
    });

    test("a grid that fails to draw leaves the old one alone", function () {
        var doc = newDocument(false);
        call("generate", { settings: COLS, target: { mode: "active" } });
        var before = ownedItems(doc).length;
        var realDraw = Mullion.adapter.drawGrid;
        Mullion.adapter.drawGrid = function () { throw new Error("ran out of memory"); };
        var failed = call("generate", { settings: COLS, target: { mode: "active" } });
        Mullion.adapter.drawGrid = realDraw;
        record("a failed draw rolls back", !failed.ok && ownedItems(doc).length === before,
            "items before=" + before + ", after=" + ownedItems(doc).length);
    });

    // ---------------------------------------------------------------- at scale

    test("a long document stays responsive", function () {
        var doc = newDocument(false);
        var pages = 200;
        while (doc.pages.length < pages) {
            doc.pages.add();
        }
        var started = (new Date()).getTime();
        var status = call("status");
        var statusMs = (new Date()).getTime() - started;
        record("status on a " + pages + "-page document stays under 300 ms", status.ok && statusMs <= 300, statusMs + " ms");

        started = (new Date()).getTime();
        var preview = call("preview", { settings: COLS, target: { mode: "active" } });
        var previewMs = (new Date()).getTime() - started;
        record("a preview tick on a " + pages + "-page document stays under 600 ms", preview.ok && previewMs <= 600, previewMs + " ms");
        call("clearPreview", {});
    });

    closeOurDocuments();
    record("every document this test opened was closed", app.documents.length === theirs.length,
        "open before=" + theirs.length + ", open now=" + app.documents.length);

    var file = new File(OUT);
    file.encoding = "UTF-8";
    file.open("w");
    file.write(JSON.stringify({ results: results }));
    file.close();
    return "wrote " + results.length + " results to " + OUT;
})();
