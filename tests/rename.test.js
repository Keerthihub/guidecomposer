"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { renameText, validate, slugify } = require("../scripts/rename.js");

const OPTIONS = { name: "Gridwright", id: "com.example.gridwright" };

test("renames visible product names and ids", () => {
    assert.equal(renameText('M.OWNER_ID = "com.mullion.panel";', OPTIONS), 'M.OWNER_ID = "com.example.gridwright";');
    assert.equal(renameText('<Extension Id="com.mullion.panel.main"/>', OPTIONS), '<Extension Id="com.example.gridwright.main"/>');
    assert.equal(renameText('var LAYER_NAME = "Mullion grids";', OPTIONS), 'var LAYER_NAME = "Gridwright grids";');
    assert.equal(renameText("<title>Mullion</title>", OPTIONS), "<title>Gridwright</title>");
    assert.equal(renameText("Reinstall Mullion.", OPTIONS), "Reinstall Gridwright.");
    assert.equal(renameText('"name": "mullion",', OPTIONS), '"name": "gridwright",');
    assert.equal(renameText("dist/mullion-0.1.0.zxp and dist/mullion/", OPTIONS), "dist/gridwright-0.1.0.zxp and dist/gridwright/");
});

test("leaves internal identifiers alone", () => {
    const code = [
        "$.global.Mullion = $.global.Mullion || {};",
        "Mullion.api.status();",
        "var core = window.MullionCore;",
        'if (typeof Mullion === "undefined") {}',
        'var TAG_OWNER = "MullionOwner";',
        'const STORAGE = "mullion.settings.v1";'
    ].join("\n");
    assert.equal(renameText(code, OPTIONS), code);
});

test("removes the placeholder-name note", () => {
    const md = "# Mullion\n\n<!-- placeholder-name-note -->\n> Mullion is a placeholder.\n<!-- /placeholder-name-note -->\nText";
    assert.equal(renameText(md, OPTIONS), "# Gridwright\n\nText");
});

test("validates names and ids", () => {
    assert.deepEqual(validate(OPTIONS), []);
    assert.equal(validate({ name: "X", id: "com.a.b" }).length, 1);
    assert.equal(validate({ name: "Grid", id: "Grid" }).length, 1);
    assert.equal(validate({ name: "Grid", id: "com.mullion.panel" }).length, 1);
    assert.equal(slugify("Grid & Co"), "grid-co");
});
