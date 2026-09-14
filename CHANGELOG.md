# Changelog

All notable changes to Mullion are recorded here. Versions follow [Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

First release candidate.

### Grids

- Column, modular, and baseline grids with margins per side (linked or separate), gutters, and baseline spacing and offset.
- Composition guides: rule of thirds, golden sections, diagonals, center lines, and a golden spiral with a choice of focus corner.
- Patterns: square grid, dot grid, isometric grid, hexagons, diagonal grid, and radial grid.
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

- Layout library: 114 layouts in ten categories with live thumbnails drawn on the active artboard, search, and suggestions for the artboard's shape. Proportional layouts size margins and gutters to the page.
- Saved presets, with export and import as files.

### Panel

- Live drawing of the grid with column width, module size, and shape count; collapsible.
- Matches all four host UI brightness settings; keyboard accessible; works docked down to 240 px wide.
- Draw test line diagnostic.

### Hosts

- Illustrator 2022 (26.0) and later on macOS and Windows.
- InDesign 2022 (17.0) and later, including Set page margins and columns, which writes InDesign's own page margins, columns, and baseline grid. Not yet verified in InDesign.

### Development

- ES3 checker for host scripts, 176 automated tests, a headless Chrome panel test, CI on macOS, Windows, and Linux, a signed-release workflow, and a rename tool.
