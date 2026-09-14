/*
 * Mullion layout library.
 *
 * Each layout sets layout fields only (grid type, counts, gutters, margins,
 * units); appearance such as color and line style stays as the user set it.
 *
 *   id, category, name     identity and grouping
 *   settings               fixed layout values (lengths in settings.units, or in
 *                          the user's units when settings.units is absent)
 *   relative               optional lengths as fractions of the artboard, so a
 *                          layout suits any page size:
 *                            basis "short": fraction of the artboard's shorter side
 *                            basis "sides": top/bottom/row values scale with height,
 *                                           left/right/column values with width
 *   artboard               optional { width, height, units } the layout was made for
 *
 * resolveLayout(layout, rect, units) turns a layout into concrete settings for
 * one artboard. suggestLayouts(rect) finds layouts made for that artboard's shape.
 *
 * Loaded by the panel; no dependencies.
 */
(function (root, factory) {
    var library = factory();
    if (typeof module === "object" && module && module.exports) {
        module.exports = library;
    } else {
        root.MullionLayouts = library;
    }
}(this, function () {
    var POINTS_PER_UNIT = { pt: 1, px: 1, mm: 72 / 25.4, "in": 72 };
    var VERTICAL_KEYS = { marginTop: true, marginBottom: true, rowGutter: true, baselineSpacing: true, baselineOffset: true };

    var CATEGORIES = ["Columns", "Modular", "Asymmetric", "Baseline", "Classic", "Print", "Screen", "Social", "Composition", "Patterns"];

    var NO_MARGINS = { marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0 };
    var COMP_OFF = { compThirds: false, compGolden: false, compDiagonals: false, compCenter: false, compSpiral: false };

    function assign(target) {
        for (var i = 1; i < arguments.length; i++) {
            var source = arguments[i];
            for (var key in source) {
                if (Object.prototype.hasOwnProperty.call(source, key)) {
                    target[key] = source[key];
                }
            }
        }
        return target;
    }

    // Even margins and gutters as fractions of the shorter side.
    function even(margin, gutter) {
        return {
            basis: "short",
            marginTop: margin, marginRight: margin, marginBottom: margin, marginLeft: margin,
            columnGutter: gutter, rowGutter: gutter
        };
    }

    var LAYOUTS = [];

    function add(layout) {
        LAYOUTS.push(layout);
    }

    // ------------------------------------------------------------- columns
    for (var c = 1; c <= 12; c++) {
        add({
            id: "columns-" + c,
            category: "Columns",
            name: c === 1 ? "1 column" : c + " columns",
            settings: { type: "columns", columns: c },
            relative: even(0.06, 0.02)
        });
    }

    // -------------------------------------------------------------- modular
    var MODULAR = [[2, 2], [2, 3], [2, 4], [3, 3], [3, 4], [3, 5], [3, 6], [4, 4], [4, 5], [4, 6],
        [4, 8], [5, 5], [5, 7], [5, 8], [6, 6], [6, 8], [6, 9], [8, 8], [8, 10], [8, 12]];
    for (var m = 0; m < MODULAR.length; m++) {
        var cols = MODULAR[m][0];
        var rows = MODULAR[m][1];
        add({
            id: "modular-" + cols + "x" + rows,
            category: "Modular",
            name: cols + " × " + rows + " modules",
            detail: (cols * rows) + " modules",
            settings: { type: "modular", columns: cols, rows: rows },
            relative: even(0.06, 0.02)
        });
    }

    // ----------------------------------------------------------- asymmetric
    function asym(id, name, settings, top, right, bottom, left, gutter) {
        add({
            id: id,
            category: "Asymmetric",
            name: name,
            settings: settings,
            relative: {
                basis: "short",
                marginTop: top, marginRight: right, marginBottom: bottom, marginLeft: left,
                columnGutter: gutter, rowGutter: gutter
            }
        });
    }
    asym("asym-left-3", "Wide left margin, 3 columns", { type: "columns", columns: 3 }, 0.06, 0.06, 0.08, 0.22, 0.02);
    asym("asym-left-6", "Wide left margin, 6 columns", { type: "columns", columns: 6 }, 0.06, 0.06, 0.08, 0.22, 0.02);
    asym("asym-right-4", "Wide right margin, 4 columns", { type: "columns", columns: 4 }, 0.06, 0.22, 0.08, 0.06, 0.02);
    asym("asym-top-4", "Deep top margin, 4 columns", { type: "columns", columns: 4 }, 0.25, 0.06, 0.06, 0.06, 0.02);
    asym("asym-bottom-2", "Deep bottom margin, 2 columns", { type: "columns", columns: 2 }, 0.06, 0.06, 0.25, 0.06, 0.03);
    asym("asym-offset-4x6", "Offset modular, 4 × 6", { type: "modular", columns: 4, rows: 6 }, 0.12, 0.06, 0.06, 0.18, 0.02);
    asym("asym-gutter-2", "Wide gutter, 2 columns", { type: "columns", columns: 2 }, 0.08, 0.08, 0.08, 0.08, 0.08);
    asym("asym-hang-5x5", "Hang line, 5 × 5 modules", { type: "modular", columns: 5, rows: 5 }, 0.3, 0.06, 0.06, 0.06, 0.015);

    // ------------------------------------------------------------- baseline
    var BASELINES = [6, 8, 9, 10, 11, 12, 13, 14, 16, 18, 24];
    for (var b = 0; b < BASELINES.length; b++) {
        add({
            id: "baseline-" + BASELINES[b],
            category: "Baseline",
            name: "Baseline, " + BASELINES[b] + " pt",
            settings: { type: "baseline", units: "pt", baselineSpacing: BASELINES[b], baselineOffset: 0 },
            relative: { basis: "short", marginTop: 0.08, marginRight: 0.06, marginBottom: 0.1, marginLeft: 0.06 }
        });
    }

    // -------------------------------------------------------------- classic
    // Van de Graaf canon: inner and top margins are 1/9 of the page, outer and bottom 2/9.
    add({
        id: "classic-van-de-graaf-right",
        category: "Classic",
        name: "Van de Graaf canon, right page",
        settings: { type: "columns", columns: 1 },
        relative: { basis: "sides", marginTop: 1 / 9, marginBottom: 2 / 9, marginLeft: 1 / 9, marginRight: 2 / 9, columnGutter: 0 }
    });
    add({
        id: "classic-van-de-graaf-left",
        category: "Classic",
        name: "Van de Graaf canon, left page",
        settings: { type: "columns", columns: 1 },
        relative: { basis: "sides", marginTop: 1 / 9, marginBottom: 2 / 9, marginLeft: 2 / 9, marginRight: 1 / 9, columnGutter: 0 }
    });
    add({
        id: "classic-van-de-graaf-2",
        category: "Classic",
        name: "Van de Graaf canon, 2 columns",
        settings: { type: "columns", columns: 2 },
        relative: { basis: "sides", marginTop: 1 / 9, marginBottom: 2 / 9, marginLeft: 1 / 9, marginRight: 2 / 9, columnGutter: 0.03 }
    });
    // Margins in the ratio 2 : 3 : 4 : 6 (inner : top : outer : bottom).
    add({
        id: "classic-2-3-4-6",
        category: "Classic",
        name: "Margins 2 : 3 : 4 : 6",
        settings: { type: "columns", columns: 1 },
        relative: { basis: "short", marginLeft: 2 / 36, marginTop: 3 / 36, marginRight: 4 / 36, marginBottom: 6 / 36, columnGutter: 0 }
    });

    // ---------------------------------------------------------------- print
    add({
        id: "swiss-12", category: "Print", name: "Swiss 12-column",
        settings: { type: "columns", units: "pt", columns: 12, columnGutter: 12, marginTop: 54, marginRight: 36, marginBottom: 72, marginLeft: 36 }
    });
    add({
        id: "editorial-6x8", category: "Print", name: "Editorial modular, 6 × 8",
        settings: { type: "modular", units: "pt", columns: 6, rows: 8, columnGutter: 12, rowGutter: 12, marginTop: 54, marginRight: 36, marginBottom: 54, marginLeft: 36 }
    });
    add({
        id: "letter-3", category: "Print", name: "US Letter, 3 columns",
        artboard: { width: 8.5, height: 11, units: "in" },
        settings: { type: "columns", units: "in", columns: 3, columnGutter: 0.25, marginTop: 0.75, marginRight: 0.625, marginBottom: 0.875, marginLeft: 0.625 }
    });
    add({
        id: "tabloid-6x8", category: "Print", name: "Tabloid, 6 × 8 modular",
        artboard: { width: 11, height: 17, units: "in" },
        settings: { type: "modular", units: "in", columns: 6, rows: 8, columnGutter: 0.2, rowGutter: 0.2, marginTop: 0.75, marginRight: 0.5, marginBottom: 0.75, marginLeft: 0.5 }
    });
    add({
        id: "a4-12", category: "Print", name: "A4, 12 columns",
        artboard: { width: 210, height: 297, units: "mm" },
        settings: { type: "columns", units: "mm", columns: 12, columnGutter: 4, marginTop: 20, marginRight: 15, marginBottom: 25, marginLeft: 15 }
    });
    add({
        id: "a5-2", category: "Print", name: "A5 booklet, 2 columns",
        artboard: { width: 148, height: 210, units: "mm" },
        settings: { type: "columns", units: "mm", columns: 2, columnGutter: 5, marginTop: 15, marginRight: 12, marginBottom: 20, marginLeft: 15 }
    });
    add({
        id: "a3-8x12", category: "Print", name: "A3 poster, 8 × 12 modular",
        artboard: { width: 297, height: 420, units: "mm" },
        settings: { type: "modular", units: "mm", columns: 8, rows: 12, columnGutter: 5, rowGutter: 5, marginTop: 20, marginRight: 20, marginBottom: 20, marginLeft: 20 }
    });
    add({
        id: "book-2", category: "Print", name: "Book page, 2 columns",
        artboard: { width: 6, height: 9, units: "in" },
        settings: { type: "columns", units: "in", columns: 2, columnGutter: 0.25, marginTop: 0.75, marginRight: 0.5, marginBottom: 0.875, marginLeft: 0.75 }
    });
    add({
        id: "poster-5x7", category: "Print", name: "Poster, 5 × 7 modular",
        artboard: { width: 18, height: 24, units: "in" },
        settings: { type: "modular", units: "in", columns: 5, rows: 7, columnGutter: 0.5, rowGutter: 0.5, marginTop: 1, marginRight: 1, marginBottom: 1, marginLeft: 1 }
    });
    add({
        id: "postcard-2", category: "Print", name: "Postcard, 2 columns",
        artboard: { width: 6, height: 4, units: "in" },
        settings: { type: "columns", units: "in", columns: 2, columnGutter: 0.25, marginTop: 0.25, marginRight: 0.25, marginBottom: 0.25, marginLeft: 0.25 }
    });
    add({
        id: "business-card", category: "Print", name: "Business card, 2 columns",
        artboard: { width: 3.5, height: 2, units: "in" },
        settings: { type: "columns", units: "in", columns: 2, columnGutter: 0.125, marginTop: 0.125, marginRight: 0.125, marginBottom: 0.125, marginLeft: 0.125 }
    });

    // --------------------------------------------------------------- screen
    add({
        id: "web-1440", category: "Screen", name: "Web page, 12 columns",
        artboard: { width: 1440, height: 1024, units: "px" },
        settings: { type: "columns", units: "px", columns: 12, columnGutter: 24, marginTop: 0, marginRight: 120, marginBottom: 0, marginLeft: 120 }
    });
    add({
        id: "desktop-1920", category: "Screen", name: "Desktop, 16 columns",
        artboard: { width: 1920, height: 1080, units: "px" },
        settings: { type: "columns", units: "px", columns: 16, columnGutter: 24, marginTop: 0, marginRight: 160, marginBottom: 0, marginLeft: 160 }
    });
    add({
        id: "laptop-1280", category: "Screen", name: "Laptop, 12 columns",
        artboard: { width: 1280, height: 800, units: "px" },
        settings: { type: "columns", units: "px", columns: 12, columnGutter: 20, marginTop: 0, marginRight: 80, marginBottom: 0, marginLeft: 80 }
    });
    add({
        id: "slide-16x9", category: "Screen", name: "Slide 16:9, 12 columns",
        artboard: { width: 1920, height: 1080, units: "px" },
        settings: { type: "columns", units: "px", columns: 12, columnGutter: 30, marginTop: 90, marginRight: 120, marginBottom: 90, marginLeft: 120 }
    });
    add({
        id: "tablet-8", category: "Screen", name: "Tablet, 8 columns",
        artboard: { width: 834, height: 1194, units: "px" },
        settings: { type: "columns", units: "px", columns: 8, columnGutter: 20, marginTop: 24, marginRight: 40, marginBottom: 20, marginLeft: 40 }
    });
    add({
        id: "tablet-landscape-12", category: "Screen", name: "Tablet landscape, 12 columns",
        artboard: { width: 1194, height: 834, units: "px" },
        settings: { type: "columns", units: "px", columns: 12, columnGutter: 20, marginTop: 24, marginRight: 48, marginBottom: 20, marginLeft: 48 }
    });
    add({
        id: "mobile-4", category: "Screen", name: "Phone, 4 columns",
        artboard: { width: 390, height: 844, units: "px" },
        settings: { type: "columns", units: "px", columns: 4, columnGutter: 16, marginTop: 59, marginRight: 16, marginBottom: 34, marginLeft: 16 }
    });
    add({
        id: "mobile-baseline-8", category: "Screen", name: "Phone, 8 px baseline",
        artboard: { width: 390, height: 844, units: "px" },
        settings: { type: "baseline", units: "px", baselineSpacing: 8, baselineOffset: 0, marginTop: 59, marginRight: 16, marginBottom: 34, marginLeft: 16 }
    });

    // --------------------------------------------------------------- social
    add({
        id: "square-post", category: "Social", name: "Square post, 3 × 3 tiles",
        artboard: { width: 1080, height: 1080, units: "px" },
        settings: { type: "modular", units: "px", columns: 3, rows: 3, columnGutter: 24, rowGutter: 24, marginTop: 60, marginRight: 60, marginBottom: 60, marginLeft: 60 }
    });
    add({
        id: "square-post-2x2", category: "Social", name: "Square post, 2 × 2 tiles",
        artboard: { width: 1080, height: 1080, units: "px" },
        settings: { type: "modular", units: "px", columns: 2, rows: 2, columnGutter: 30, rowGutter: 30, marginTop: 60, marginRight: 60, marginBottom: 60, marginLeft: 60 }
    });
    add({
        id: "portrait-post", category: "Social", name: "Portrait post 4:5, 3 × 4",
        artboard: { width: 1080, height: 1350, units: "px" },
        settings: { type: "modular", units: "px", columns: 3, rows: 4, columnGutter: 24, rowGutter: 24, marginTop: 60, marginRight: 60, marginBottom: 60, marginLeft: 60 }
    });
    add({
        id: "story-safe", category: "Social", name: "Vertical story safe area",
        artboard: { width: 1080, height: 1920, units: "px" },
        settings: { type: "columns", units: "px", columns: 1, columnGutter: 0, marginTop: 250, marginRight: 60, marginBottom: 340, marginLeft: 60 }
    });
    add({
        id: "story-3", category: "Social", name: "Vertical story, 3 columns",
        artboard: { width: 1080, height: 1920, units: "px" },
        settings: { type: "columns", units: "px", columns: 3, columnGutter: 30, marginTop: 250, marginRight: 60, marginBottom: 340, marginLeft: 60 }
    });
    add({
        id: "banner-thirds", category: "Social", name: "Wide banner, rule of thirds",
        artboard: { width: 1500, height: 500, units: "px" },
        settings: assign({ type: "composition", units: "px", marginTop: 40, marginRight: 80, marginBottom: 40, marginLeft: 80 }, COMP_OFF, { compThirds: true, compCenter: true })
    });
    add({
        id: "video-thumbnail", category: "Social", name: "Video thumbnail, thirds",
        artboard: { width: 1280, height: 720, units: "px" },
        settings: assign({ type: "composition", units: "px", marginTop: 36, marginRight: 64, marginBottom: 36, marginLeft: 64 }, COMP_OFF, { compThirds: true })
    });
    add({
        id: "profile-banner", category: "Social", name: "Profile banner, center lines",
        artboard: { width: 1584, height: 396, units: "px" },
        settings: assign({ type: "composition", units: "px", marginTop: 40, marginRight: 300, marginBottom: 40, marginLeft: 300 }, COMP_OFF, { compCenter: true })
    });

    // ---------------------------------------------------------- composition
    function comp(id, name, flags, extra) {
        add({ id: id, category: "Composition", name: name, settings: assign({ type: "composition" }, NO_MARGINS, COMP_OFF, flags, extra || {}) });
    }
    comp("photo-thirds", "Thirds and diagonals", { compThirds: true, compDiagonals: true });
    comp("thirds-center", "Thirds and center", { compThirds: true, compCenter: true });
    comp("golden-diagonals", "Golden sections and diagonals", { compGolden: true, compDiagonals: true });
    comp("diagonals-center", "Diagonals and center", { compDiagonals: true, compCenter: true });
    comp("golden-spiral", "Golden spiral, bottom right", { compGolden: true, compSpiral: true }, { spiralFocus: "bottom-right" });
    comp("golden-spiral-bl", "Golden spiral, bottom left", { compGolden: true, compSpiral: true }, { spiralFocus: "bottom-left" });
    comp("golden-spiral-tr", "Golden spiral, top right", { compGolden: true, compSpiral: true }, { spiralFocus: "top-right" });
    comp("golden-spiral-tl", "Golden spiral, top left", { compGolden: true, compSpiral: true }, { spiralFocus: "top-left" });

    // ------------------------------------------------------------- patterns
    function pattern(id, name, settings, artboard) {
        add({ id: id, category: "Patterns", name: name, settings: assign({ type: "pattern" }, NO_MARGINS, settings), artboard: artboard || null });
    }
    var LETTER = { width: 8.5, height: 11, units: "in" };
    var A4 = { width: 210, height: 297, units: "mm" };
    pattern("square-10mm", "Square grid, 10 mm", { units: "mm", pattern: "square", patternSize: 10, marginTop: 8.5, marginRight: 5, marginBottom: 8.5, marginLeft: 5 }, A4);
    pattern("square-5mm", "Square grid, 5 mm", { units: "mm", pattern: "square", patternSize: 5, marginTop: 8.5, marginRight: 5, marginBottom: 8.5, marginLeft: 5 }, A4);
    pattern("square-quarter-in", "Square grid, ¼ inch", { units: "in", pattern: "square", patternSize: 0.25, marginTop: 0.5, marginRight: 0.5, marginBottom: 0.5, marginLeft: 0.5 }, LETTER);
    pattern("dots-5mm", "Dot grid, 5 mm", { units: "mm", pattern: "dots", patternSize: 5, dotSize: 1.5, marginTop: 10, marginRight: 10, marginBottom: 10, marginLeft: 10 }, A4);
    pattern("dots-quarter-in", "Dot grid, ¼ inch", { units: "in", pattern: "dots", patternSize: 0.25, dotSize: 1.5, marginTop: 0.5, marginRight: 0.5, marginBottom: 0.5, marginLeft: 0.5 }, LETTER);
    pattern("dots-10pt", "Dot grid, 10 pt", { units: "pt", pattern: "dots", patternSize: 10, dotSize: 1, marginTop: 36, marginRight: 36, marginBottom: 36, marginLeft: 36 }, LETTER);
    pattern("isometric-24", "Isometric, 24 pt", { units: "pt", pattern: "isometric", patternSize: 24 });
    pattern("isometric-12", "Isometric, 12 pt", { units: "pt", pattern: "isometric", patternSize: 12 });
    pattern("isometric-48", "Isometric, 48 pt", { units: "pt", pattern: "isometric", patternSize: 48 });
    pattern("hexagon-24", "Hexagons, 24 pt", { units: "pt", pattern: "hexagon", patternSize: 24, marginTop: 18, marginRight: 18, marginBottom: 18, marginLeft: 18 }, LETTER);
    pattern("hexagon-12", "Hexagons, 12 pt", { units: "pt", pattern: "hexagon", patternSize: 12, marginTop: 18, marginRight: 18, marginBottom: 18, marginLeft: 18 }, LETTER);
    pattern("hexagon-48", "Hexagons, 48 pt", { units: "pt", pattern: "hexagon", patternSize: 48, marginTop: 18, marginRight: 18, marginBottom: 18, marginLeft: 18 });
    pattern("diagonal-24", "Diagonal grid, 24 pt", { units: "pt", pattern: "diagonal", patternSize: 24 });
    pattern("radial-8x16", "Radial, 8 rings and 16 spokes", { units: "pt", pattern: "radial", rings: 8, spokes: 16, marginTop: 36, marginRight: 36, marginBottom: 36, marginLeft: 36 });
    pattern("radial-4x8", "Radial, 4 rings and 8 spokes", { units: "pt", pattern: "radial", rings: 4, spokes: 8, marginTop: 36, marginRight: 36, marginBottom: 36, marginLeft: 36 });

    // ------------------------------------------------------------ utilities

    function roundFor(value, units) {
        var factor = units === "in" ? 1000 : 10;
        var r = Math.round(value * factor) / factor;
        return r === 0 ? 0 : r;
    }

    /*
     * Concrete layout settings for an artboard.
     *   rect:  Illustrator artboard rectangle [left, top, right, bottom] in points
     *   units: the user's current units, used when the layout doesn't set its own
     * Returns a settings object containing only the layout's fields.
     */
    function resolveLayout(layout, rect, units) {
        var out = assign({}, layout.settings);
        out.units = layout.settings.units || units || "pt";
        var rel = layout.relative;
        if (rel) {
            var width = rect[2] - rect[0];
            var height = rect[1] - rect[3];
            var shortSide = Math.min(width, height);
            for (var key in rel) {
                if (key === "basis" || !Object.prototype.hasOwnProperty.call(rel, key)) {
                    continue;
                }
                var length = rel.basis === "sides" ? (VERTICAL_KEYS[key] ? height : width) : shortSide;
                out[key] = roundFor(rel[key] * length / POINTS_PER_UNIT[out.units], out.units);
            }
        }
        return out;
    }

    function artboardPoints(layout) {
        var a = layout.artboard;
        return a ? { width: a.width * POINTS_PER_UNIT[a.units], height: a.height * POINTS_PER_UNIT[a.units] } : null;
    }

    function describeArtboard(layout) {
        var a = layout.artboard;
        return a ? "Made for a " + a.width + " × " + a.height + " " + a.units + " artboard." : "";
    }

    // Short label for a gallery tile.
    function describeShort(layout) {
        if (layout.artboard) {
            return layout.artboard.width + " × " + layout.artboard.height + " " + layout.artboard.units;
        }
        if (layout.detail) {
            return layout.detail;
        }
        return layout.relative ? "Fits any page" : "Any page";
    }

    /*
     * Layouts made for an artboard of this shape, best first: exact size, then
     * same proportions (within 2.5%). Returns up to `limit` layouts.
     */
    function suggestLayouts(rect, limit) {
        var width = rect[2] - rect[0];
        var height = rect[1] - rect[3];
        if (!(width > 0 && height > 0)) {
            return [];
        }
        var ratio = width / height;
        var scored = [];
        for (var i = 0; i < LAYOUTS.length; i++) {
            var size = artboardPoints(LAYOUTS[i]);
            if (!size) {
                continue;
            }
            var difference = Math.abs(Math.log(ratio / (size.width / size.height)));
            if (difference > 0.025) {
                continue;
            }
            var exact = Math.abs(size.width - width) <= width * 0.01 && Math.abs(size.height - height) <= height * 0.01;
            scored.push({ layout: LAYOUTS[i], score: (exact ? 0 : 1) + difference, order: i });
        }
        scored.sort(function (a, b) { return a.score - b.score || a.order - b.order; });
        var out = [];
        for (var j = 0; j < scored.length && j < (limit || 6); j++) {
            out.push(scored[j].layout);
        }
        return out;
    }

    function find(id) {
        for (var i = 0; i < LAYOUTS.length; i++) {
            if (LAYOUTS[i].id === id) {
                return LAYOUTS[i];
            }
        }
        return null;
    }

    return {
        CATEGORIES: CATEGORIES,
        LAYOUTS: LAYOUTS,
        find: find,
        resolveLayout: resolveLayout,
        suggestLayouts: suggestLayouts,
        describeArtboard: describeArtboard,
        describeShort: describeShort
    };
}));
