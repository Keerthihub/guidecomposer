# Changelog

All notable changes to Mullion are recorded here. Versions follow [Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

First release candidate.

### Grids

- Column, modular, and baseline grids with margins per side (linked or separate), gutters, and baseline spacing and offset.
- Composition guides: rule of thirds, rule of fifths, golden sections, diagonals, center lines, harmonic armature, dynamic rectangle, Villard's figure, and a golden spiral with a choice of focus corner.
- Compound grids (overlay columns) and square modules.
- Patterns: square grid, dot grid, isometric grid, hexagons, diagonal grid at any angle, and radial grid.

### Construction lines

- Select a logo or artwork to draw its bounding box, key lines through anchors and curve extremes, and fitted circles, with optional center lines and diagonals.
- A color per kind of line; lines across the artboard or around the artwork with padding.
- Reads groups and compound paths; asks for outlined text; replaces and clears only construction lines.
- Unequal column widths and row heights, such as 2 1 1 or 1 1 2 3 5.
- A baseline grid inside column and modular grids, with From text to copy leading from selected text.
- Content blocks: drag across the panel drawing to mark regions spanning several modules.
- Units: points, pixels, millimeters, and inches, with lossless conversion.

### Where grids go

- The active artboard or page, all of them, a list such as 1-3, 5, or inside each selected object.
- Generate replaces the grid in the same area; Add to existing grids combines grid types.
- Every target is validated before anything is drawn.

### Appearance

- Lines, guides, or boxes, with color, width, and opacity.
- Solid, dashed, or dotted lines, a separate margin color, and shaded gutters.
- Option to extend grid lines to the artboard edges.

### Working with the grid

- Live preview, debounced and serialized, that hides the grid it would replace.
- Align objects: check selected objects against the grid, select off-grid objects, or snap them to grid lines.
- Show/hide and lock/unlock the grid layer; a non-printing grid layer.
- Resize artboards or pages to 29 standard formats; layouts made for a size offer a one-click resize.
- One Undo reverses each Mullion action.
- Ownership tags so Preview, Generate, and Clear never remove artwork Mullion didn't create.

### Library and presets

- Layout library: 128 layouts in ten categories, led by Systems, with icon thumbnails drawn on the active artboard, search, and suggestions for the artboard's shape. Proportional layouts size margins and gutters to the page.
- Saved presets, with export and import as files.

### Panel

- Three modes: Grid, Layouts, and Construct. Grid types as icon buttons, quick color swatches, an opacity slider, and success, warning, and error messages with icons.
- Live drawing of the grid with column width, module size, and shape count; collapsible.
- Matches all four host UI brightness settings; keyboard accessible; works docked down to 240 px wide.
- Draw test line diagnostic.
- Live preview pauses for grids over 1,500 shapes, which would stall the app on every edit; Generate still draws them.
- Construct reads the selected artwork only when the selection changes, and at most 3,000 points.
- A host call that gets no answer for 90 seconds is abandoned with a message, so the panel never stays busy.
- Applying a layout in other units converts the lengths it doesn't set (24 pt spacing no longer becomes 24 in).
- When the extension's files change while the panel is open, the panel says so and offers Reload panel, so it never runs stale code against newer host scripts.

### Hosts

- Illustrator 2022 (26.0) and later on macOS and Windows.
- InDesign 2022 (17.0) and later, including Set page margins and columns, which writes InDesign's own page margins, columns, and baseline grid. Not yet verified in InDesign.

> **Declared host ranges are wider than what has been tested.** `CSXS/manifest.xml`
> declares `ILST [26.0,99.9]` and `IDSN [17.0,99.9]`, because CEP manifests have
> no way to say "this version and later". The extension has been run in
> Illustrator 30.8.1 on macOS only: no other Illustrator version, no Windows, and
> no InDesign at all. Narrow the ranges, or state the tested versions plainly in
> the listing, before selling. Tested versions belong in `docs/COMPATIBILITY.md`;
> what has actually been run is recorded in README.md → Verification status.

### Documentation, licensing, and delivery

- End-user licence agreement (`LICENSE`, a template for a lawyer to review),
  third-party notices (`NOTICE`), and a security policy (`SECURITY.md`).
- `PRIVACY.md` and `TERMS.md` completed wherever the answer follows from how the
  code behaves; every remaining gap is a single `[PLACEHOLDER]` token.
- Customer documentation in `docs/`: compatibility matrix, troubleshooting guide
  that needs no registry edits, and what survives an update versus a reinstall.
- `docs/LAUNCH-CHECKLIST.md` collects every owner-only decision left, in order,
  with acceptance criteria — including the one table of every placeholder.

### Development

- ES3 checker for host scripts, an automated test suite covering the grid
  engine, both host adapters against fake DOMs, the layout library and the
  release rules (`npm test` prints the count), a headless Chrome panel test, and
  a rename tool.
- CI on macOS, Windows, and Linux: unit tests, production build, **the panel
  smoke test on all three**, an advisory `npm audit`, and a rename rehearsal that
  renames a copy of the whole project and re-runs every check against it.
- Signed-release workflow: the git tag must match `package.json`, the panel test
  gates signing, Adobe's signing tool is pinned by commit and verified by
  SHA-256, and each tag publishes a permanent GitHub Release with the `.zxp`, its
  SHA-256, and these release notes.
- Panel icons now include a disabled state and `@2X` HiDPI variants
  (`npm run icons`; see `docs/LISTING-ARTWORK.md` for the sources).
