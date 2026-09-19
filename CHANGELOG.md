# Changelog

All notable changes to GridComposer are recorded here. Versions follow [Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

First release candidate.

### Grids

- Column, modular, and baseline grids with margins per side (linked or separate), gutters, and baseline spacing and offset.
- Composition guides: rule of thirds, rule of fifths, golden sections, diagonals, center lines, harmonic armature, dynamic rectangle, Villard's figure, and a golden spiral with a choice of focus corner.
- Compound grids (overlay columns) and square modules.
- Patterns: square grid, dot grid, isometric grid, hexagons, diagonal grid at any angle, and radial grid.

### Safety and ownership

- Which artboard a grid belongs to is worked out from where the grid sits, so deleting or reordering artboards no longer sends Clear to the wrong one.
- Grids stay GridComposer's own at any depth, so grouping one with your artwork no longer makes it impossible to clear.
- Object and construction grids are matched by overlap, so moving the artwork replaces its grid instead of drawing a second one on top.
- A new grid is drawn before the old one is removed, so a failure can never leave you with neither; in InDesign the failure now reaches InDesign's own rollback.
- Grids you have edited are handed back to you rather than deleted, and reported as kept.
- Previews left behind by a crash, or by a file saved while a preview was on screen, are cleared the next time the panel reads the document, and any grid they hid is shown again.
- Ending a preview puts back a grid layer you had hidden.
- Every call pins the coordinate system it reads and writes in, so another script's settings cannot place grids, construction lines or snapped objects away from where they belong.
- Modal dialogs are suppressed while GridComposer runs, so a stray alert can no longer park a call for ever.
- Every grid records the settings that drew it, and **More > Use this document's grid settings** reads them back, so a document carries the recipe for its own grid.

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
- One Undo reverses each GridComposer action.
- Ownership tags so Preview, Generate, and Clear never remove artwork GridComposer didn't create.

### Library and presets

- Layout library: 128 layouts in ten categories, led by Systems, with icon thumbnails drawn on the active artboard, search, and suggestions for the artboard's shape. Proportional layouts size margins and gutters to the page.
- Saved presets, with export and import as files.

### Editing fields

- Illustrator swallows the ordinary editing shortcuts before a panel sees them, so Select All, Copy, Paste, Cut and Undo did nothing inside a field: selecting "12" and typing 8 gave "128", and the field felt stuck. The panel now claims those keys from the host.
- Clicking or tabbing into a number field selects what is in it, so typing replaces the number. Fields you type a list into keep the caret where you put it.

### Speed

- Previewing redraws on every keystroke, and used to search the whole document each time to find what to remove. A live preview now remembers the grids it drew and the grids it hid, and ends them by reference. On a 20,000-item document, each preview while typing went from 216 ms to 36 ms, Generate from 256 ms to 34 ms, and a preview with three documents open from 573 ms to 22 ms.
- Whether a grid has been edited is worked out only when something is about to be removed, not on every scan.
- The grid layer is no longer deleted and made again between preview ticks.

### Panel

- Three modes: Grid, Layouts, and Construct. Grid types as icon buttons, quick color swatches, an opacity slider, and success, warning, and error messages with icons.
- Live drawing of the grid with column width, module size, and shape count; collapsible.
- Matches all four host UI brightness settings; keyboard accessible; works docked down to 240 px wide.
- Draw test line diagnostic.
- Live preview pauses for grids over 1,500 shapes, which would stall the app on every edit; Generate still draws them.
- Construct reads the selected artwork only when the selection changes, and at most 1,500 points; the panel says when it used part of a selection.
- A host call that gets no answer for 90 seconds is abandoned with a message, so the panel never stays busy.
- Applying a layout in other units converts the lengths it doesn't set (24 pt spacing no longer becomes 24 in).
- When the extension's files change while the panel is open, the panel says so and offers Reload panel, so it never runs stale code against newer host scripts.

### Hosts

- Illustrator 2022 (26.0) and later on macOS and Windows.
- **Illustrator only.** InDesign support is written, and tested against a simulated InDesign, but it has never been run in InDesign, so `CSXS/manifest.xml` does not declare it and the panel does not appear there. It will ship in a later release, in the same purchase, once `npm run qa:indesign` passes in a real copy.
- Photoshop is not supported and is not planned.

> **The declared Illustrator range is wider than what has been tested.**
> `CSXS/manifest.xml` declares `ILST [26.0,99.9]`, because CEP manifests have
> no way to say "this version and later". The extension has been run in
> Illustrator 30.8.1 on macOS only: no other Illustrator version and no Windows.
> Narrow the range, or state the tested versions plainly in the listing, before
> selling. Tested versions belong in `docs/COMPATIBILITY.md`; what has actually
> been run is recorded in README.md → Verification status.

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

- `npm run qa:illustrator` runs 84 checks in a real Illustrator and fails the run if any of them do, so the host can be verified the same way every release. It includes a 20,000-item document, where status takes 5 ms and a preview tick 216 ms.
- `npm run qa:indesign` runs the same kind of check in a real InDesign, covering what InDesign does differently. The script is dry-run against the fake InDesign DOM by the test suite, so it fails in InDesign only where InDesign really differs.

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
