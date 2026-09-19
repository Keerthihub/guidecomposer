"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { renameText, validate, slugify, currentIdentity } = require("../scripts/rename.js");

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

/*
 * The tool has to work a second time. It was first written to rename only from
 * the original placeholder, so once the project had a real name, running it
 * again changed nothing and reported success — and the CI rename rehearsal,
 * which renames a copy of the tree, was rehearsing against a name the tree no
 * longer contained.
 */
test("renames again, from whatever the project is called now", () => {
    const from = { id: "com.keerthi.gridcomposer", name: "GridComposer", slug: "gridcomposer" };
    const to = { name: "GuideComposer", id: "com.keerthi.guidecomposer" };
    assert.equal(renameText('M.OWNER_ID = "com.keerthi.gridcomposer";', to, from), 'M.OWNER_ID = "com.keerthi.guidecomposer";');
    assert.equal(renameText("<title>GridComposer</title>", to, from), "<title>GuideComposer</title>");
    assert.equal(renameText('"name": "gridcomposer",', to, from), '"name": "guidecomposer",');
    assert.equal(renameText("dist/gridcomposer-0.1.0.zxp", to, from), "dist/guidecomposer-0.1.0.zxp");

    // The internal identifiers were never renamed, so a later rename must not
    // reach them either — they still carry the original placeholder.
    const internals = 'var core = window.MullionCore;\nMullion.api.status();\nvar S = "mullion.settings.v1";';
    assert.equal(renameText(internals, to, from), internals);
});

test("a name containing regex characters is renamed literally", () => {
    const from = { id: "com.a.b", name: "Grid & Co.", slug: "grid-co" };
    assert.equal(renameText("Welcome to Grid & Co.!", { name: "Rule", id: "com.c.d" }, from), "Welcome to Rule!");
    assert.equal(renameText("Gridx&xCo9", { name: "Rule", id: "com.c.d" }, from), "Gridx&xCo9", "the dot is not a wildcard");
});

test("refuses to rename the project to what it is already called", () => {
    const identity = currentIdentity();
    assert.equal(validate({ name: identity.name, id: identity.id }, identity).length, 1);
    assert.deepEqual(validate({ name: "Something Else", id: "com.keerthi.somethingelse" }, identity), []);
});

test("the project's identity is readable from the tree, and the two sources agree", () => {
    const identity = currentIdentity();
    assert.match(identity.id, /^[a-z][a-z0-9-]*(\.[a-z0-9-]+){1,5}$/);
    assert.equal(identity.slug, slugify(identity.name), "package.json name should be the slug of the product name");
});
