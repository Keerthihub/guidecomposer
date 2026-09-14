#!/usr/bin/env node
/*
 * Generates the 23 x 23 panel icons referenced by CSXS/manifest.xml:
 * a page outline divided by two mullions. No dependencies; writes PNG directly.
 *
 *   node scripts/make-icons.js
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const SIZE = 23;
const OUT = path.resolve(__dirname, "..", "icons");

// Normal/RollOver are shown on light Illustrator themes, Dark* on dark themes.
const VARIANTS = {
    "icon-normal.png": [70, 70, 70],
    "icon-rollover.png": [20, 20, 20],
    "icon-dark-normal.png": [200, 200, 200],
    "icon-dark-rollover.png": [245, 245, 245]
};

function iconPixels(rgb) {
    const pixels = Buffer.alloc(SIZE * SIZE * 4);
    const set = (x, y, alpha) => {
        const i = (y * SIZE + x) * 4;
        pixels[i] = rgb[0];
        pixels[i + 1] = rgb[1];
        pixels[i + 2] = rgb[2];
        pixels[i + 3] = Math.max(pixels[i + 3], alpha);
    };
    const left = 4, right = 18, top = 2, bottom = 20;
    for (let x = left; x <= right; x++) {
        set(x, top, 255);
        set(x, bottom, 255);
    }
    for (let y = top; y <= bottom; y++) {
        set(left, y, 255);
        set(right, y, 255);
        // Two mullions dividing the page into three columns, inset from the edges.
        if (y >= top + 3 && y <= bottom - 3) {
            set(9, y, 255);
            set(13, y, 255);
        }
    }
    // Margin marks: short horizontal ticks at the content top and bottom.
    for (let x = 7; x <= 15; x++) {
        set(x, top + 3, 150);
        set(x, bottom - 3, 150);
    }
    return pixels;
}

function chunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
}

function png(pixels) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(SIZE, 0);
    header.writeUInt32BE(SIZE, 4);
    header[8] = 8; // bit depth
    header[9] = 6; // RGBA
    const rows = [];
    for (let y = 0; y < SIZE; y++) {
        rows.push(Buffer.from([0])); // filter: none
        rows.push(pixels.subarray(y * SIZE * 4, (y + 1) * SIZE * 4));
    }
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", header),
        chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
        chunk("IEND", Buffer.alloc(0))
    ]);
}

fs.mkdirSync(OUT, { recursive: true });
for (const [name, rgb] of Object.entries(VARIANTS)) {
    fs.writeFileSync(path.join(OUT, name), png(iconPixels(rgb)));
    console.log("wrote icons/" + name);
}
