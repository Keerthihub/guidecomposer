# Changelog

All notable changes to Mullion are recorded here. Versions follow [Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

First MVP.

### Added

- Generate replaces the grids already on the target artboards, so regenerating never stacks copies. Check "Add to existing grids" to combine grid types instead.
- Previewing over an existing grid hides that grid until the preview ends.
- Patterns tab: square grid, dot grid, isometric grid, hexagons, diagonal grid, and radial grid.
- Line styles: solid, dashed, or dotted strokes, a separate margin color, and shaded gutters for column and modular grids.
- Layout library: 105 layouts in ten categories (Columns, Modular, Asymmetric, Baseline, Classic, Print, Screen, Social, Composition, Patterns) with live thumbnails drawn on the active artboard, search, and suggestions for the artboard's shape. Proportional layouts size margins and gutters to the artboard.
- Composition guides: rule of thirds, golden sections, diagonals, center lines, and a golden spiral with a choice of focus corner.
- Boxes output: one rectangle per column or module.
- Apply to this artboard, all artboards, or a list such as 1-3, 5, for Preview, Generate, and Clear. Every target is validated before anything is drawn.
- Show/hide and lock/unlock buttons for the grid layer, and a button to re-read the document.
- − / + buttons for columns and rows, repeating while held.
- Collapsible drawing and Appearance section; presets moved into the footer.
- Column, modular, and baseline grids.
- Margins per side (with a linked mode), column and row gutters, baseline spacing and offset.
- Units: points, pixels, millimeters, inches, with lossless conversion between them.
- Output as editable lines (color, width, opacity) or Illustrator guides.
- Option to extend grid lines to the artboard edges.
- Live preview in Illustrator, debounced and serialized.
- Generate, Clear, and Reset.
- Named presets and remembered settings, stored locally in the panel.
- Grids placed in a non-printing "Mullion grids" layer, with optional locking.
- Ownership tags so Preview and Clear never remove artwork Mullion didn't create.
- Panel drawing of the grid with column width, module size, and line count.
- Matches all four Illustrator UI brightness settings.
- Draw test line diagnostic.
- Illustrator 2022 (26.0) and later on macOS and Windows.
