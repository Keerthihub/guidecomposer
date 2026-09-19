#!/usr/bin/env node
/*
 * Generates the panel icons referenced by CSXS/manifest.xml: a page outline
 * divided by two mullions. No dependencies; writes PNG directly.
 *
 *   node scripts/make-icons.js
 *
 * What the icon set has to contain, and where that comes from:
 *
 * - Icon types. Adobe's manifest schema (ExtensionManifest_v_7_0.xsd in
 *   Adobe-CEP/CEP-Resources, the schema this manifest declares with
 *   Version="7.0") allows at most five <Icon> elements, with Type restricted to
 *   exactly: Normal, Disabled, RollOver, DarkNormal, DarkRollOver. There is no
 *   DarkDisabled type, so one disabled icon has to read on both light and dark
 *   host themes; this script draws it mid-grey and semi-transparent for that
 *   reason.
 * - Size. 23 x 23 is not stated as a requirement in the CEP 11 or CEP 12 HTML
 *   Extension Cookbooks; it is what Adobe's own sample extension ships
 *   (CEP_12.x/Samples/CEP_HTML_Test_Extension-12.0/TeEx_HTML_TEST_23x23_*.png),
 *   and it is what this manifest has always used. Treat it as the convention,
 *   not as a documented rule.
 * - HiDPI. The CEP 11.1 and CEP 12 Cookbooks ("High DPI Panel Icons") say to
 *   ship a second file per icon named <name>@2X.png, at 200%, alongside the
 *   normal file. The @2X files are NOT listed in the manifest: the host finds
 *   them by name. Photoshop also accepts <name>_x2.png; Illustrator and
 *   InDesign are only documented for @2X, so that is what this writes.
 *
 * None of this has been confirmed on a HiDPI Windows machine or on a Retina Mac
 * with the signed package installed; see docs/LAUNCH-CHECKLIST.md.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const BASE = 23; // 1x icon edge, in pixels
const SCALES = [1, 2]; // 1x and the @2X HiDPI sibling
const OUT = path.resolve(__dirname, "..", "icons");

// Normal/RollOver are shown on light host themes, Dark* on dark themes.
// Disabled has to work on both, so it is mid-grey and faded.
const VARIANTS = {
    "icon-normal": { rgb: [70, 70, 70], opacity: 1 },
    "icon-rollover": { rgb: [20, 20, 20], opacity: 1 },
    "icon-dark-normal": { rgb: [200, 200, 200], opacity: 1 },
    "icon-dark-rollover": { rgb: [245, 245, 245], opacity: 1 },
    "icon-disabled": { rgb: [128, 128, 128], opacity: 0.55 }
};

// Draws the icon once, at 1x, as an alpha mask: [y][x] -> 0..255.
function mask() {
    const rows = [];
    for (let y = 0; y < BASE; y++) {
        rows.push(new Uint8Array(BASE));
    }
    const set = (x, y, alpha) => {
        rows[y][x] = Math.max(rows[y][x], alpha);
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
    return rows;
}

const MASK = mask();

/*
 * Paints the mask in one color at one scale. Each 1x pixel becomes a scale x
 * scale block, so a 2x icon is the same physical size with the same stroke
 * weight on a HiDPI display, rather than a thinner drawing.
 */
function pixels(variant, scale) {
    const size = BASE * scale;
    const buffer = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const alpha = MASK[Math.floor(y / scale)][Math.floor(x / scale)];
            if (!alpha) {
                continue;
            }
            const i = (y * size + x) * 4;
            buffer[i] = variant.rgb[0];
            buffer[i + 1] = variant.rgb[1];
            buffer[i + 2] = variant.rgb[2];
            buffer[i + 3] = Math.round(alpha * variant.opacity);
        }
    }
    return buffer;
}

function chunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
}

function png(buffer, size) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(size, 0);
    header.writeUInt32BE(size, 4);
    header[8] = 8; // bit depth
    header[9] = 6; // RGBA
    const rows = [];
    for (let y = 0; y < size; y++) {
        rows.push(Buffer.from([0])); // filter: none
        rows.push(buffer.subarray(y * size * 4, (y + 1) * size * 4));
    }
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", header),
        chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
        chunk("IEND", Buffer.alloc(0))
    ]);
}

fs.mkdirSync(OUT, { recursive: true });
const written = [];
for (const [base, variant] of Object.entries(VARIANTS)) {
    for (const scale of SCALES) {
        const name = scale === 1 ? base + ".png" : base + "@2X.png";
        const size = BASE * scale;
        fs.writeFileSync(path.join(OUT, name), png(pixels(variant, scale), size));
        written.push(`icons/${name} (${size} x ${size})`);
    }
}
written.forEach((line) => console.log("wrote " + line));
console.log(
    "\nThe @2X files need no manifest entry; the host finds them by name.\n" +
    "icon-disabled.png does need one. Add it inside <Icons> in CSXS/manifest.xml:\n" +
    '    <Icon Type="Disabled">./icons/icon-disabled.png</Icon>\n' +
    "(At most five <Icon> elements are allowed: Normal, Disabled, RollOver, DarkNormal, DarkRollOver.)"
);
