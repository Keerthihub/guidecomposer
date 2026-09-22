# Changelog

All notable changes to GuideComposer are recorded here. Versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

Changes made after 0.1.1 was published. None of them are in the package on the
Releases page; they ship with the next version.

### Verified for the first time

- **The panel was run inside Illustrator, not just against a mock.** `npm run qa:panel` drives the real panel over CEP's debugging port: every module present, each grid type generated against the real host, overlays, gallery tiles, and the preset backup file actually written. 11 checks. Until now `test:ui` covered the panel but in headless Chrome, and `qa:illustrator` covered the host but never the panel — so nothing covered opening the panel in Illustrator and pressing a button.
- **InDesign was run in InDesign.** 32 checks, 0 failures, InDesign 2026 (21.6.0). It found two real bugs first; see below.

### Fixed

- **Baseline grids were placed one margin too low in InDesign**, for any document measuring its baseline grid from the top of the margin. The adapter asked for an enum constant InDesign does not have, ExtendScript threw, and a `try`/`catch` turned that into "measured from the page" — so the margin was counted twice. The hand-written fake InDesign used for testing had the same wrong name, so every test agreed with the bug.
- **The one-command InDesign proof could never have run.** Its AppleScript sent `do script` to a file rather than to InDesign. Nothing caught it because the script had never been run in InDesign.

### Added

- `npm run zip` builds the file you hand to a person: the signed package, its checksum, install steps for macOS and Windows, the licence, and the pages people need afterwards. It refuses to build with an unfilled placeholder in any included file, or around a package that is not the one published.
- The README shows the panel, captured from it running inside Illustrator.

### Documentation

- Support for the free extension is GitHub issues, and the user-facing pages now say so instead of naming an email address that does not exist.
- The README no longer claims nothing has been released while a release sits on the Releases page, and records Windows as untested rather than implying otherwise.

---

## [0.1.1] - 2026-09-21

Second release candidate. Everything in 0.1.0 plus one fix that had to happen
before anyone installed it.

### Fixed

- **Presets are no longer lost when Illustrator updates itself.** CEP names each extension's storage after the extension id *and the host application's version*, so a new Illustrator silently gives the panel a brand-new empty store — every few weeks. Presets are now mirrored to a file outside that store and restored when the panel opens to find its storage empty. Full explanation in `docs/UPDATING.md`.

The 0.1.0 signed beta predates this and carries the bug. It is kept only as the
older of the two builds the update-in-place check needs.

---

## [0.1.0] - Unreleased

First release candidate.

### Grids

- Column, modular, and baseline grids with margins per side (linked or separate), gutters, and baseline spacing and offset.
- Composition guides: rule of thirds, rule of fifths, golden sections, diagonals, center lines, harmonic armature, dynamic rectangle, Villard's figure, and a golden spiral with a choice of focus corner.
- Compound grids (overlay columns) and square modules.
- Patterns: square grid, dot grid, isometric grid, hexagons, diagonal grid at any angle, and radial grid.

### Presets survive an Illustrator update

- **Presets are no longer lost when Illustrator updates itself.** CEP names each extension's storage after the extension id *and the host application's version*, so a new Illustrator gives the panel a brand-new empty store — silently, every few weeks. Presets are now mirrored to a file outside that store (`~/Library/Application Support/GuideComposer/presets-backup.json`, `%APPDATA%\GuideComposer\` on Windows) and restored when the panel opens to find its storage empty, with a message saying so.
- Settings are deliberately not restored: reopening at defaults costs seconds, not months of work. Presets you deleted yourself are not resurrected — deleting your last preset empties the backup too.
- This does not replace **Export presets**, which is still the only copy you control and the only one that survives an uninstall or a new computer.

### Safety and ownership

- Which artboard a grid belongs to is worked out from where the grid sits, so deleting or reordering artboards no longer sends Clear to the wrong one.
- Grids stay GuideComposer's own at any depth, so grouping one with your artwork no longer makes it impossible to clear.
- Object and construction grids are matched by overlap, so moving the artwork replaces its grid instead of drawing a second one on top.
- A new grid is drawn before the old one is removed, so a failure can never leave you with neither; in InDesign the failure now reaches InDesign's own rollback.
- Grids you have edited are handed back to you rather than deleted, and reported as kept.
- Previews left behind by a crash, or by a file saved while a preview was on screen, are cleared the next time the panel reads the document, and any grid they hid is shown again.
- Ending a preview puts back a grid layer you had hidden.
- Every call pins the coordinate system it reads and writes in, so another script's settings cannot place grids, construction lines or snapped objects away from where they belong.
- Modal dialogs are suppressed while GuideComposer runs, so a stray alert can no longer park a call for ever.
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
- One Undo reverses each GuideComposer action.
- Ownership tags so Preview, Generate, and Clear never remove artwork GuideComposer didn't create.

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

### InDesign, run in InDesign for the first time

- `npm run qa:indesign` now passes **32 checks, 0 failures, in a real InDesign 2026 (21.6.0)**. Until now the InDesign adapter had only ever been tested against a hand-written simulation of InDesign. The first real run found two bugs the simulation could not, which is exactly what it was written to do.
- **Fixed: the baseline grid was placed one margin too low** in any document whose baseline grid is measured from the top of the margin rather than the top of the page. InDesign spells the enum constant `TOP_OF_MARGIN_OF_BASELINE_GRID_RELATIVE_OPTION`; the adapter asked for `TOP_OF_MARGIN`, ExtendScript threw, and a `try`/`catch` turned that into "measured from the page" — so the margin was added a second time. Silently, and correctly, in every test: the fake InDesign had been written with the same wrong name, so the simulation agreed with the bug.
- **Fixed: the one-command InDesign proof could never have run.** `scripts/qa/run-indesign-qa.sh` built its AppleScript as `do script (POSIX file …)`, which sends `do script` to the file rather than to InDesign and dies with error -1708. Nothing caught it because the script had never been run in InDesign.
- Also learned, and now modelled: InDesign refuses `app.undo()` while a script is running, so a script undoes through `doc.undo()`; and lengths must be read with the measurement unit pinned, or a correct 40 pt baseline reads back as 3.33 on a document whose ruler is in picas.

### Licence and distribution

- **Free and open source under the MIT licence.** The extension is not sold, and nothing in it is gated behind a payment: there is no licence key, no trial, no locked feature, and no account. Revenue, where there is any, comes from optional materials and custom work sold beside it, which are not part of this repository.
- `LICENSE` replaces the proprietary end-user agreement with MIT, plus a plain section on what MIT does not cover: the vendored Adobe and public-domain files, the Adobe application itself, separately sold materials, and the name.
- `TERMS.md` is now in two parts — the free extension under MIT, and the optional paid pack — so the two can never be confused for one another.
- The vendored files keep their own terms: `client/vendor/CSInterface.js` is Adobe's, `host/vendor/json2.js` is public domain. See `NOTICE`.

### Hosts

- Illustrator 2022 (26.0) and later on macOS and Windows.
- **Illustrator only.** InDesign support is written, and tested against a simulated InDesign, but it has never been run in InDesign, so `CSXS/manifest.xml` does not declare it and the panel does not appear there. It will ship in a later release, once `npm run qa:indesign` passes in a real copy.
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
