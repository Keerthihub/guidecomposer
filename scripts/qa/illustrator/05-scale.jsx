/*
 * Mullion live QA, part 05: how the panel behaves on a heavy document.
 *
 * Builds a document with tens of thousands of objects, then times the calls the
 * panel makes while you work. A call that takes longer than its budget freezes
 * the application, so these are pass/fail, not information.
 *
 * ExtendScript, ES3 only.
 */
(function () {
    var CONFIG = $.global.__mullionQA || {};
    var ROOT = CONFIG.root;
    var OUT = CONFIG.out + "/05-scale.json";
    $.evalFile(new File(ROOT + "/host/index.jsx"));
    Mullion.boot(encodeURIComponent(ROOT));

    var results = [];
    function record(name, pass, detail) {
        results.push({ name: name, pass: pass === true, detail: String(detail) });
    }
    function call(method, payload) {
        return JSON.parse(Mullion.api[method](payload === undefined ? "" : encodeURIComponent(JSON.stringify(payload))));
    }
    function time(fn) {
        var started = (new Date()).getTime();
        var value = fn();
        return { ms: (new Date()).getTime() - started, value: value };
    }
    function budget(name, run, limit, note) {
        var t = time(run);
        record(name + " stays under " + limit + " ms", t.ms <= limit, t.ms + " ms" + (note ? " (" + note + ")" : "") +
            (t.value && t.value.ok === false ? " [" + t.value.error.message.substr(0, 60) + "]" : ""));
        return t.ms;
    }

    var COLS = {
        type: "columns", columns: 12, columnGutter: 12, marginTop: 36, marginRight: 36, marginBottom: 36, marginLeft: 36,
        units: "pt", strokeColor: "#E0457B", strokeWidth: 0.5, opacity: 100, output: "lines", lockLayer: false
    };

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

    var doc = app.documents.add(DocumentColorSpace.RGB, 612, 792);
    var art = doc.layers[0];
    art.name = "Artwork";

    // 20,000 items: 200 groups of 100, which is how real artwork is structured.
    var built = time(function () {
        for (var g = 0; g < 200; g++) {
            var group = art.groupItems.add();
            for (var i = 0; i < 100; i++) {
                var x = (g % 20) * 30 + (i % 10) * 3;
                var y = 700 - Math.floor(g / 20) * 60 - Math.floor(i / 10) * 5;
                group.pathItems.rectangle(y, x, 2, 2);
            }
        }
        return art.groupItems.length;
    });
    record("built a 20,000-item document", built.value === 200, built.value + " groups of 100 paths (" + (built.value * 100) + " items) in " + built.ms + " ms");

    // Status runs whenever the pointer enters the panel, so it has the tightest budget.
    budget("status on a 20,000-item document", function () { return call("status"); }, 100);
    budget("status again (cached scan)", function () { return call("status"); }, 100);
    budget("a preview tick", function () { return call("preview", { settings: COLS, target: { mode: "active" } }); }, 400);
    budget("a second preview tick", function () { return call("preview", { settings: { type: "columns", columns: 8, columnGutter: 12, marginTop: 36, marginRight: 36, marginBottom: 36, marginLeft: 36, units: "pt" }, target: { mode: "active" } }); }, 400);
    budget("generate", function () { return call("generate", { settings: COLS, target: { mode: "active" } }); }, 1000);
    budget("generate again (replacing)", function () { return call("generate", { settings: COLS, target: { mode: "active" } }); }, 1000);
    budget("clear", function () { return call("clear", { target: { mode: "active" } }); }, 1000);

    // With everything selected, the panel still has to answer.
    app.executeMenuCommand("selectall");
    budget("status with 20,000 objects selected", function () { return call("status"); }, 500, "selection capped at 200");
    budget("construction geometry with everything selected", function () { return call("selectionGeometry"); }, 1500, "points capped at 3000");
    doc.selection = null;

    // Several documents open at once: previews sweep every one of them.
    var second = app.documents.add(DocumentColorSpace.RGB, 612, 792);
    var third = app.documents.add(DocumentColorSpace.RGB, 612, 792);
    budget("a preview tick with three documents open", function () { return call("preview", { settings: COLS, target: { mode: "active" } }); }, 600);
    call("clearPreview", {});
    third.close(SaveOptions.DONOTSAVECHANGES);
    second.close(SaveOptions.DONOTSAVECHANGES);
    doc.close(SaveOptions.DONOTSAVECHANGES);

    closeOurDocuments();
    record("every document this test opened was closed", app.documents.length === theirs.length,
        "open before=" + theirs.length + ", open now=" + app.documents.length);

    var f = new File(OUT);
    f.encoding = "UTF-8";
    f.open("w");
    f.write(JSON.stringify({ results: results }));
    f.close();
    return "ok";
})();
