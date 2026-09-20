/*
 * Drawing a grid as an SVG picture inside the panel.
 *
 * The panel shows the grid before Illustrator does. The engine hands back plain
 * geometry — line segments, boxes, curves, dots, polygons, in the artboard's own
 * coordinates — and this module turns that into SVG at panel size. The same code
 * draws the large preview at the top of the panel and every thumbnail in the
 * Layouts gallery, which is why it takes options rather than existing twice.
 *
 * Nothing here reads the panel's state: give it geometry and a rectangle and it
 * returns a picture. That is what makes it the easy part of the panel to change.
 *
 * Two details that exist for real reasons:
 *
 *  - **Zoom.** A dense pattern drawn whole at thumbnail size is a solid block of
 *    colour rather than a grid, so past a legibility threshold a tile shows a
 *    crop instead and you can see what the layout actually is.
 *  - **Append.** Overlay grids paint into the picture already there instead of
 *    replacing it, so a 3 + 4 compound grid looks in the panel the way it will
 *    look on the page.
 */
(function (root) {
    "use strict";

    const { MAX_SCHEMATIC_CELLS, THUMBNAIL_MAX_MARKS, TILE_LEGIBLE_MARKS } = root.constants;

    const SVG_NS = "http://www.w3.org/2000/svg";

    function svgNode(name, attrs) {
        const node = document.createElementNS(SVG_NS, name);
        Object.keys(attrs).forEach((key) => node.setAttribute(key, attrs[key]));
        return node;
    }

    /*
     * Draws a built grid into an SVG. Used by the main drawing and by library tiles.
     * options: { empty: draw the page as an outline, thumb: thin out dense marks,
     *            icon: draw in the panel accent, artwork: selected paths to draw beneath }
     */
    /*
     * How much of the page a tile should show. A tile is about 120 px wide, so
     * more than a dozen or so marks across it turn into a solid block: past
     * that, the tile shows a corner of the page at a size you can actually read.
     */
    function tileZoom(result) {
        const across = {};
        const down = {};
        (result.segments || []).forEach((seg) => {
            if (seg.x1 === seg.x2) {
                across[Math.round(seg.x1)] = true;
            } else if (seg.y1 === seg.y2) {
                down[Math.round(seg.y1)] = true;
            }
        });
        // Diagonals (isometric, angled patterns) have no axis to count along,
        // so their number stands in for how dense they look.
        let diagonals = 0;
        (result.segments || []).forEach((seg) => {
            if (seg.x1 !== seg.x2 && seg.y1 !== seg.y2) {
                diagonals++;
            }
        });
        const marks = (result.dots || []).length + (result.polygons || []).length;
        const perAxis = Math.max(
            Object.keys(across).length,
            Object.keys(down).length,
            diagonals ? diagonals / 2 : 0,
            marks ? Math.sqrt(marks) : 0
        );
        return perAxis > TILE_LEGIBLE_MARKS ? Math.min(6, perAxis / TILE_LEGIBLE_MARKS) : 1;
    }

    function paintGrid(svg, result, rect, options) {
        const opts = options || {};
        const width = rect[2] - rect[0];
        const height = rect[1] - rect[3];
        const x = (v) => v - rect[0];
        const y = (v) => rect[1] - v; // Illustrator Y grows upward; SVG Y grows downward.

        // An overlay is painted into the picture that is already there.
        if (!opts.append) {
            svg.setAttribute("viewBox", "0 0 " + width + " " + height);
            Array.from(svg.childNodes).forEach((node) => {
                if (node.nodeName !== "title") {
                    svg.removeChild(node);
                }
            });
            if (opts.thumb && result.ok) {
                const zoom = tileZoom(result);
                if (zoom > 1) {
                    svg.setAttribute("viewBox", "0 0 " + (width / zoom) + " " + (height / zoom));
                }
            }
        }
        svg.classList.toggle("schematic--invalid", !result.ok);
        const style = result.ok ? result.settings : {};
        svg.classList.toggle("schematic--guides", style.output === "guides");
        svg.classList.toggle("schematic--dashed", style.output !== "guides" && style.lineStyle === "dashed");
        svg.classList.toggle("schematic--dotted", style.output !== "guides" && style.lineStyle === "dotted");

        const frag = document.createDocumentFragment();
        if (!opts.append) {
            frag.appendChild(svgNode("rect", {
                class: "schematic__paper" + (opts.empty ? " schematic__paper--empty" : ""),
                x: 0, y: 0, width, height
            }));
        }

        (opts.artwork || []).forEach((path) => {
            const p = path.points;
            if (!p.length) {
                return;
            }
            let d = "M" + x(p[0].anchor[0]) + " " + y(p[0].anchor[1]);
            const count = path.closed ? p.length : p.length - 1;
            for (let i = 1; i <= count; i++) {
                const from = p[i - 1];
                const to = p[i % p.length];
                d += " C" + x(from.right[0]) + " " + y(from.right[1]) + " " + x(to.left[0]) + " " + y(to.left[1]) + " " + x(to.anchor[0]) + " " + y(to.anchor[1]);
            }
            frag.appendChild(svgNode("path", { class: "schematic__artwork" + (path.closed ? "" : " schematic__artwork--open"), d: d + (path.closed ? " Z" : "") }));
        });

        if (result.ok) {
            const s = result.settings;
            const guides = s.output === "guides";
            const rootStyle = getComputedStyle(document.documentElement);
            // Library tiles share the panel accent, so the gallery reads as one family of icons.
            const color = opts.icon ? rootStyle.getPropertyValue("--accent").trim()
                : guides ? rootStyle.getPropertyValue("--guide").trim() : s.strokeColor;
            const marginColor = !opts.icon && !guides && s.marginColorOn ? s.marginColor : color;
            // Overlays are drawn fainter, so the main grid still reads first.
            const strokeOpacity = (opts.icon ? 0.95 : guides ? 1 : Math.max(0.35, s.opacity / 100)) * (opts.dim ? 0.5 : 1);
            const colorFor = (kind) => {
                if (!opts.icon && !guides && s.kindColors && s.kindColors[kind]) {
                    return s.kindColors[kind];
                }
                return kind === "margin" ? marginColor : color;
            };
            const tracks = result.tracks;

            if (s.output !== "boxes" && !s.shadeGutters) {
                const top = s.extendToEdges ? result.artboard.top : result.content.top;
                const bottom = s.extendToEdges ? result.artboard.bottom : result.content.bottom;
                const cells = tracks.columns.length * Math.max(1, tracks.rows.length);
                if (tracks.rows.length && cells <= MAX_SCHEMATIC_CELLS) {
                    tracks.columns.forEach((col) => {
                        tracks.rows.forEach((row) => {
                            frag.appendChild(svgNode("rect", {
                                class: "schematic__track", fill: color,
                                x: x(col.left), y: y(row.top), width: col.right - col.left, height: row.top - row.bottom
                            }));
                        });
                    });
                } else {
                    tracks.columns.forEach((col) => {
                        frag.appendChild(svgNode("rect", {
                            class: "schematic__track", fill: color,
                            x: x(col.left), y: y(top), width: col.right - col.left, height: top - bottom
                        }));
                    });
                }
            }

            result.boxes.forEach((b) => {
                const rectAttrs = { x: x(b.left), y: y(b.top), width: b.right - b.left, height: b.top - b.bottom };
                if (b.kind === "block") {
                    frag.appendChild(svgNode("rect", Object.assign({ class: "schematic__block", fill: color }, rectAttrs)));
                } else if (b.kind === "gutter") {
                    frag.appendChild(svgNode("rect", Object.assign({ class: "schematic__gutter", fill: opts.icon ? color : s.gutterColor, "fill-opacity": opts.icon ? 0.25 : s.gutterOpacity / 100 }, rectAttrs)));
                } else {
                    frag.appendChild(svgNode("rect", Object.assign({ class: "schematic__box", stroke: color, fill: color, "stroke-opacity": strokeOpacity }, rectAttrs)));
                }
            });

            // Tiles are tiny: keep every Nth row and column of dots or hexagons so
            // they stay fast and still read as an even grid (thinning by list
            // position would leave diagonal stripes).
            const thin = (list, position) => {
                if (!opts.thumb || list.length <= THUMBNAIL_MAX_MARKS) {
                    return list;
                }
                const step = Math.ceil(Math.sqrt(list.length / THUMBNAIL_MAX_MARKS));
                const rank = (values) => {
                    const sorted = Array.from(new Set(values.map((v) => Math.round(v * 10)))).sort((a, b) => a - b);
                    const index = new Map(sorted.map((v, i) => [v, i]));
                    return (v) => index.get(Math.round(v * 10));
                };
                const points = list.map(position);
                const column = rank(points.map((p) => p[0]));
                const row = rank(points.map((p) => p[1]));
                return list.filter((_, i) => row(points[i][1]) % step === 0 && column(points[i][0]) % step === 0);
            };
            const centerOf = (poly) => [
                poly.points.reduce((sum, p) => sum + p[0], 0) / poly.points.length,
                poly.points.reduce((sum, p) => sum + p[1], 0) / poly.points.length
            ];

            thin(result.polygons, centerOf).forEach((poly) => {
                frag.appendChild(svgNode("polygon", {
                    class: "schematic__polygon", stroke: color, "stroke-opacity": strokeOpacity,
                    points: poly.points.map((pt) => x(pt[0]) + "," + y(pt[1])).join(" ")
                }));
            });

            result.segments.forEach((seg) => {
                frag.appendChild(svgNode("line", {
                    class: "schematic__line" + (seg.x1 !== seg.x2 && seg.y1 !== seg.y2 ? " schematic__line--diagonal" : ""),
                    stroke: colorFor(seg.kind), "stroke-opacity": strokeOpacity,
                    x1: x(seg.x1), y1: y(seg.y1), x2: x(seg.x2), y2: y(seg.y2)
                }));
            });

            result.curves.forEach((curve) => {
                const p = curve.points;
                const toward = (from, to) => " C" + x(from.right[0]) + " " + y(from.right[1]) +
                    " " + x(to.left[0]) + " " + y(to.left[1]) + " " + x(to.anchor[0]) + " " + y(to.anchor[1]);
                let d = "M" + x(p[0].anchor[0]) + " " + y(p[0].anchor[1]);
                for (let i = 1; i < p.length; i++) {
                    d += toward(p[i - 1], p[i]);
                }
                if (curve.closed) {
                    d += toward(p[p.length - 1], p[0]) + " Z";
                }
                frag.appendChild(svgNode("path", { class: "schematic__curve", stroke: colorFor(curve.kind), "stroke-opacity": strokeOpacity, d }));
            });

            // Keep dots at least ~1.2 screen pixels across so the drawing shows them.
            const box = svg.getBoundingClientRect();
            const scale = box.width && box.height ? Math.min(box.width / width, box.height / height) : 0.12;
            const minRadius = 0.6 / scale;
            thin(result.dots, (dot) => [dot.x, dot.y]).forEach((dot) => {
                frag.appendChild(svgNode("circle", {
                    class: "schematic__dot", fill: color, "fill-opacity": strokeOpacity,
                    cx: x(dot.x), cy: y(dot.y), r: Math.max(dot.d / 2, minRadius)
                }));
            });
        }
        svg.appendChild(frag);
    }

    // What the drawing last showed, so it can be repainted when its size changes.

    Object.assign(root, { SVG_NS, svgNode, tileZoom, paintGrid });
}(window.MullionUI = window.MullionUI || {}));
