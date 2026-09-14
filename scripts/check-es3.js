#!/usr/bin/env node
/*
 * Verifies that every file Illustrator's ExtendScript engine evaluates is
 * ES3-compatible.
 *
 * 1. Syntax: parses with acorn at ecmaVersion 3 and allowReserved "never", which
 *    rejects let/const, arrow functions, trailing commas in literals, getters,
 *    template strings, and reserved words used as property names.
 * 2. APIs: walks the AST and rejects calls ExtendScript does not provide
 *    (Array.prototype.forEach, Object.keys, String.prototype.trim, and so on).
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const acorn = require("acorn");

const ROOT = path.resolve(__dirname, "..");

const FILES = [
    { file: "shared/grid-core.js", apiCheck: true, allowJSON: false },
    { file: "host/index.jsx", apiCheck: true, allowJSON: true },
    { file: "host/illustrator-adapter.jsx", apiCheck: true, allowJSON: true },
    // Vendor code is syntax-checked only; json2 is designed for ES3 hosts.
    { file: "host/vendor/json2.js", apiCheck: false, allowJSON: true }
];

// Member names whose call signals an API missing from ExtendScript (ES3).
const BANNED_METHODS = new Set([
    "forEach", "map", "filter", "reduce", "reduceRight", "some", "every",
    "indexOf", "lastIndexOf", "trim", "trimStart", "trimEnd", "bind",
    "includes", "find", "findIndex", "startsWith", "endsWith", "padStart",
    "padEnd", "repeat", "fill", "entries", "values", "assign"
]);

const BANNED_STATIC = new Set([
    "Object.keys", "Object.create", "Object.defineProperty",
    "Object.defineProperties", "Object.freeze", "Object.getPrototypeOf",
    "Object.assign", "Object.entries", "Object.values",
    "Array.isArray", "Array.from", "Array.of",
    "Date.now", "Number.isFinite", "Number.isNaN", "Number.isInteger",
    "Math.trunc", "Math.sign", "Math.log10", "Math.hypot",
    "Promise", "Symbol", "Map", "Set", "WeakMap"
]);

function walk(node, visit) {
    if (!node || typeof node.type !== "string") return;
    visit(node);
    for (const key of Object.keys(node)) {
        const child = node[key];
        if (Array.isArray(child)) child.forEach((c) => walk(c, visit));
        else if (child && typeof child.type === "string") walk(child, visit);
    }
}

function lineOf(source, offset) {
    return source.slice(0, offset).split("\n").length;
}

function checkFile(entry) {
    const abs = path.join(ROOT, entry.file);
    const problems = [];
    if (!fs.existsSync(abs)) {
        return [`${entry.file}: file is missing`];
    }
    const source = fs.readFileSync(abs, "utf8");

    if (/^\s*#(include|target|targetengine)/m.test(source)) {
        problems.push(`${entry.file}: uses a # preprocessor directive; load files with $.evalFile instead`);
    }

    let ast;
    try {
        ast = acorn.parse(source, { ecmaVersion: 3, allowReserved: "never", sourceType: "script" });
    } catch (err) {
        return [`${entry.file}:${err.loc ? err.loc.line : "?"}: ES3 syntax error: ${err.message}`];
    }

    if (!entry.apiCheck) return problems;

    // Banned methods only matter when called; reading a property named "values" is fine.
    const calledMembers = new Set();
    walk(ast, (node) => {
        if (node.type === "CallExpression" && node.callee.type === "MemberExpression") {
            calledMembers.add(node.callee);
        }
    });

    walk(ast, (node) => {
        if (node.type === "MemberExpression" && !node.computed && node.property.type === "Identifier") {
            const name = node.property.name;
            if (node.object.type === "Identifier") {
                const qualified = `${node.object.name}.${name}`;
                if (BANNED_STATIC.has(qualified)) {
                    problems.push(`${entry.file}:${lineOf(source, node.start)}: ${qualified} is not available in ExtendScript`);
                }
                if (!entry.allowJSON && node.object.name === "JSON") {
                    problems.push(`${entry.file}:${lineOf(source, node.start)}: JSON is not guaranteed here; shared code must not depend on it`);
                }
            }
            if (BANNED_METHODS.has(name) && calledMembers.has(node)) {
                problems.push(`${entry.file}:${lineOf(source, node.start)}: .${name}() is not available on ExtendScript arrays/strings`);
            }
        }
        if ((node.type === "Identifier") && BANNED_STATIC.has(node.name)) {
            problems.push(`${entry.file}:${lineOf(source, node.start)}: ${node.name} is not available in ExtendScript`);
        }
    });

    return problems;
}

const problems = FILES.flatMap(checkFile);
if (problems.length) {
    console.error(`ES3 check failed (${problems.length} problem${problems.length === 1 ? "" : "s"}):`);
    problems.forEach((p) => console.error("  " + p));
    process.exit(1);
}
console.log(`ES3 check passed: ${FILES.map((f) => f.file).join(", ")}`);
