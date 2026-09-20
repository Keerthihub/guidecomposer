# GuideComposer

A free, open-source layout-grid panel for Adobe Illustrator.

GuideComposer draws column, modular, and baseline grids, classic grid systems, composition guides, and patterns, on artboards, pages, or inside selected objects. It draws construction lines around logos, checks and snaps artwork to the grid, and ships with a visual library of 128 layouts. Grids live on their own layer and carry ownership tags, so previews, regenerating, and clearing never touch your artwork.


- Platform: CEP panel extension (Illustrator has no UXP support)
- Declared support: Illustrator 2022 (26.0) or later; macOS and Windows. **The declared range is wider than what has been run** — see [Verification status](#verification-status), and give customers [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) instead of that table.
- **This release ships Illustrator only.** The InDesign adapter, its tests and its QA script stay in the tree and stay green, but `CSXS/manifest.xml` declares `ILST` alone, so the panel does not appear in InDesign. Declaring `IDSN` is gated on `npm run qa:indesign` passing in a real InDesign — see the InDesign row below.
- Free and open source (MIT). Never sold, nothing gated — see [Licence and third-party code](#licence-and-third-party-code)
- No network access, no accounts, no Node.js inside the panel

GuideComposer is currently preparing for its first public release. A signed,
timestamped `0.1.0` beta has passed Adobe's signature verification, but it has
not yet completed clean-machine installation testing and has not been published
as a GitHub Release. When that testing is complete, download the public build
from this repository's **Releases** page. User documentation lives in
[docs/](docs/README.md), and the remaining pre-release work is tracked in
[docs/LAUNCH-CHECKLIST.md](docs/LAUNCH-CHECKLIST.md).

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before
opening an issue or pull request. Large changes should begin with an issue so
the approach can be agreed before anyone spends time implementing it.

For help, search or open a GitHub issue and include **More > Copy diagnostics**
when possible. Issues are read, but this volunteer project cannot promise a
reply or a fix by a particular date. Report security problems privately through
GitHub's **Security > Report a vulnerability** form.

## Contents

- [Features](#features)
- [Verification status](#verification-status)
- [Project layout](#project-layout)
- [Development](#development)
- [Load the panel in Illustrator](#load-the-panel-in-illustrator)
- [Debugging](#debugging)
- [How it works](#how-it-works)
- [Manual QA checklist](#manual-qa-checklist)
- [Known limitations](#known-limitations)
- [Packaging and distribution](#packaging-and-distribution)
- [Renaming](#renaming)
- [Licence and third-party code](#licence-and-third-party-code)

## Features

The panel has three modes: **Grid** (grid types as icon buttons and every setting), **Layouts** (the visual gallery), and **Construct** (construction lines for selected artwork).

**Grids**
- Columns, modular grids (optionally square modules), baseline grids, and patterns (square, dots, isometric, hexagons, diagonal at any angle, radial)
- Composition guides: thirds, fifths, golden sections, diagonals, center lines, harmonic armature, dynamic rectangle (diagonals, reciprocals, and eye lines), Villard's figure, and a golden spiral with a chosen focus
- Compound grids: overlay a second column count on the first, such as 3 + 4
- Unequal column widths and row heights (`2 1 1`, `1 1 2 3 5`)
- A baseline grid inside column and modular grids, with **From text** to copy leading from selected text
- Content blocks: drag across the drawing to mark regions spanning several modules
- Units: pt, px, mm, in, with lossless conversion

**Where grids go**
- The active artboard or page, all of them, a list such as `1-3, 5`, or **inside each selected object**
- Generate replaces the grid in the same area; **Add to existing grids** stacks grid types
- Every target is validated before anything is drawn

**Construction lines**
- Select a logo or icon and draw its bounding box, key lines through every anchor and curve extreme, and the circles its round parts are made from, with center lines and diagonals as options
- A separate color for each kind of line; lines run across the artboard or just around the artwork
- Works through groups and compound paths; text must be outlined first

**Appearance**
- Lines, guides, or boxes; color with quick swatches, width, opacity slider; solid, dashed, or dotted lines; a separate margin color; shaded gutters

**Working with the grid**
- Live preview that hides the grid it would replace
- **Align objects**: check selected objects against the grid, select the off-grid ones, or snap them onto grid lines
- Show/hide and lock/unlock the grid layer; clear by area
- **Resize** artboards or pages to 29 standard formats, and one-click resize when a layout was made for another size
- InDesign only: **Set page margins and columns** writes the settings into InDesign's own page setup and baseline grid

**Library and presets**
- 128 layouts in ten categories, starting with **Systems** (golden spiral, harmonic armature, dynamic rectangle, Villard's figure, Van de Graaf canon, rules of thirds and fifths, column, modular, compound, hierarchical, manuscript, and baseline grids), with icon thumbnails drawn on your artboard, search, and suggestions for the artboard's shape
- Proportional layouts size margins and gutters to the page, so one layout suits A6 and A0
- Saved presets, with export and import as files for sharing across a studio

## Verification status

**Internal. Do not put this table, or anything derived from it, in front of a
customer** — give them [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md), which
says what is supported in the terms a buyer needs. This table says what has
actually been *run*, which is a different and smaller thing.

Each row separates evidence anyone can reproduce from this repository
(re-runnable) from evidence that exists only as the developer's record of having
done it once (**not reproducible here** — treat it as a claim to re-verify
whenever the code changes, and never let it drift into marketing copy).

| Area | Evidence in the repository | Rests on the developer's word |
| --- | --- | --- |
| Grid engine | `npm test` — exact coordinates, every grid type, validation, snapping. The suite prints its own count when it runs; read it there rather than quoting a number, which goes stale every time a test is added | — |
| Layout library | `tests/layouts.test.js` builds every one of the 128 layouts (10 categories) — count checked against `shared/layouts.js` | — |
| Artboard formats | 29 formats in `shared/formats.js`, exercised by the resize tests — count checked against the source | — |
| Illustrator host | Tests against a fake Illustrator DOM, **and** `npm run qa:illustrator` — 84 checks in a running Illustrator, in documents it creates and closes: generate, undo, replace, clear, rescue, previews, construction, artboards with negative coordinates, CMYK, limits, locked and hidden layers, error paths, and ownership after the user deletes an artboard, groups a grid, moves artwork or edits a grid | Last full run: Illustrator 30.8.1, macOS 26.4.1, Apple Silicon — 84 checks, 0 failures, including a 20,000-item document (status 5 ms, preview tick 216 ms, generate 34 ms). Re-run it yourself; that is what the script is for |
| Undo in Illustrator | `npm run qa:illustrator` checks that one Undo reverses exactly one GuideComposer action and leaves the user's artwork alone | — |
| InDesign host | Tests against a strict fake InDesign DOM, including a dry run of the real QA script (`tests/indesign-qa.test.js`): 31 checks covering text selections, localised stroke names, facing pages, the baseline reference point, page insertion, master spreads, guides, rollback and a 200-page document — all passing against the model | Nothing in InDesign itself. **InDesign has still never been run, and is therefore not declared in the manifest and does not ship.** `npm run qa:indesign` runs those same 31 checks in a real InDesign; when it passes, add `IDSN` back to the manifest and to `tests/release.test.js` |
| Panel | `npm run test:ui` — headless Chrome smoke test of every control and all three modes, in all four brightness themes, and down to the smallest panel the manifest allows. CI runs it on Ubuntu, macOS **and Windows** runners | Headless Chrome is not CEP's embedded Chromium inside a host app. The panel has never been opened in Illustrator on Windows |
| Windows | Unit tests, build and panel smoke test all run on a Windows runner in CI | Nothing. No one has installed the panel in Illustrator on Windows |
| Rename tool | The final product name is **GuideComposer** and the id is `com.keerthi.guidecomposer`. `npm run check` plus the **Rename rehearsal** CI job copies the whole tree, renames it, and re-runs the ES3 check, the tests, the build and the panel smoke test against the copy | — |
| Signing | [Manual signed-release run 35479947697](https://github.com/Keerthihub/guidecomposer/actions/runs/35479947697) built `guidecomposer-0.1.0.zxp` with Adobe's pinned signer, added a valid timestamp, and passed Adobe verification. Its SHA-256 is `1fbf403066c040b871baa82942a141ba7bb2bd70ed9a316e34f0b67d730526cc`; the downloaded copy was verified again locally | No one has installed the signed `.zxp` on a clean account, so launch, update and uninstall paths remain unobserved |
| Installation, update, uninstall | — | Nothing. See step 7 of [docs/LAUNCH-CHECKLIST.md](docs/LAUNCH-CHECKLIST.md) |

**Host version ranges.** `CSXS/manifest.xml` declares `ILST [26.0,99.9]`, and
nothing else. That is far wider than the single Illustrator version anything has been
run in, because CEP has no "and later" syntax. Narrow it, or be clear in the
listing that untested versions are untested.

## Project layout

```text
CSXS/manifest.xml             Extension manifest (host ILST, panel geometry, icons)
client/index.html             Panel markup
client/styles.css             Panel styles; theme tokens are set from the host's colors
client/app.js                 Panel controller: bridge, queue, preview, library, presets
client/vendor/CSInterface.js  Adobe CEP bridge (v12)
host/index.jsx                ExtendScript entry: boot loader and the Mullion.api endpoints
host/illustrator-adapter.jsx  All Illustrator DOM access
host/indesign-adapter.jsx     All InDesign DOM access (same interface)
host/vendor/json2.js          JSON for ExtendScript (public domain)
shared/grid-core.js           Grid geometry, validation, snapping (ES3; runs everywhere)
shared/layouts.js             Layout library: 128 layouts, proportional sizing, suggestions
shared/formats.js             Standard artboard and page sizes
tests/                        Node tests: engine, both hosts on fake DOMs, library, release
scripts/                      ES3 checker, UI smoke test, build, signing, rename, dev install
scripts/qa/                   Live QA you run in the host apps: illustrator/ (5 parts,
                              84 checks) and indesign/ (31 checks), with a runner each
.github/workflows/            CI checks and the signed-release workflow
.github/ISSUE_TEMPLATE/       Bug and feature templates (ask for version and OS build)
icons/                        Panel icons, 23 x 23 plus @2X HiDPI (generated by scripts/make-icons.js)
docs/                         Customer documentation, and the launch checklist
LICENSE NOTICE SECURITY.md    End-user licence (template), third-party notices, security policy
.debug                        Remote debugging ports for development builds only
```

## Development

Requires Node.js 20 or later.

```sh
npm install        # installs acorn, used only by the ES3 checker
npm run check      # ES3 compatibility check + all Node tests
npm run test:ui    # headless Chrome smoke test of the panel (needs Google Chrome)
```

`npm run check` must pass before every commit. It verifies that every file the host apps evaluate parses as ES3 and calls no APIs ExtendScript lacks (such as `Array.prototype.forEach`, `Object.keys`, `String.prototype.trim`), and rejects reserved words like `final` as property names.

Pushing to GitHub (`.github/workflows/check.yml`) runs four jobs:

| Job | What it does |
| --- | --- |
| Tests | `npm run check` and a production build on Ubuntu, macOS and Windows |
| Panel smoke test | `npm run test:ui` in headless Chrome, on all three, with screenshots kept for 14 days |
| npm audit | Advisory only, and deliberately so: the one development dependency never reaches a customer, so an advisory in it must not block a release. It is reported, never enforced |
| Rename rehearsal | Copies the tree, renames it, and re-runs everything against the copy (see [Renaming](#renaming)) |

Both workflows declare least-privilege `permissions:` and a `concurrency:` group.

### Work on the UI in a browser

Open `client/index.html` directly in Chrome. Outside the host apps the panel uses a mock host, so every control works. URL options:

| Query | Effect |
| --- | --- |
| `?theme=dark` | Darkest host UI (default) |
| `?theme=mediumdark`, `?theme=mediumlight`, `?theme=light` | Other brightness settings |
| `?nodoc` | No document open |
| `?selection` | Two selected objects, for the Selected objects target and Align objects |
| `?host=indesign` | InDesign vocabulary (pages) and InDesign-only controls |

`node scripts/ui-smoke.js --screenshots <folder>` saves screenshots of each state.

## Load the panel in Illustrator

Development builds are unsigned, so Illustrator must be told to allow them. The install scripts turn on `PlayerDebugMode` for CEP 11–13 and link this folder into your user extensions folder.

The manifest declares Illustrator only, so the panel will not appear in InDesign even with the link in place. To work on the InDesign adapter, add a Host entry named `IDSN` to `CSXS/manifest.xml` locally — and do not commit it until `npm run qa:indesign` passes in a real InDesign.

**macOS:** `scripts/install-dev-mac.sh` (remove with `--uninstall`)

**Windows** (PowerShell): `powershell -ExecutionPolicy Bypass -File scripts\install-dev-windows.ps1` (remove with `-Uninstall`)

**Then:**

1. Quit and restart Illustrator.
2. Choose **Window > Extensions > GuideComposer**. Some recent versions label this submenu **Extensions (Legacy)**.
3. Dock the panel. It remembers settings between sessions.
4. Open **More > Draw test line**. A line across the artboard or page confirms everything is connected. **Clear** removes it.

`PlayerDebugMode` affects every CEP extension for your user account. Turn it off when you finish testing (the scripts' header comments show how).

To pick up code changes, close and reopen the panel; host `.jsx` files reload when the panel boots.

## Debugging

**Panel:** with the panel open, visit `http://localhost:8088` (Illustrator) or `http://localhost:8089` (InDesign) in Chrome for DevTools. Ports come from `.debug`, which is never packaged.

**From a user:** ask for **More > Copy diagnostics** — panel version, installed host version, app and platform, document and artboard, current settings, and the last error, in one paste. `docs/TROUBLESHOOTING.md` is the customer-facing version of this section, and asks for nothing that requires a registry edit.

**Host scripts:** errors come back to the panel's status line as readable messages, such as `Illustrator reported an error: ... (line 42)`. Unexpected raw responses are logged to the DevTools console.

**CEP logs:** raise the log level, restart the app, and reproduce the problem.

```sh
# macOS
defaults write com.adobe.CSXS.12 LogLevel 6
# logs: ~/Library/Logs/CSXS/CEP12-ILST.log (Illustrator) or CEP12-IDSN.log (InDesign)
```

```powershell
# Windows
Set-ItemProperty -Path "HKCU:\Software\Adobe\CSXS.12" -Name LogLevel -Value "6"
# logs: %TEMP%\CEP12-ILST.log or %TEMP%\CEP12-IDSN.log
```

Use `CSXS.11` / `CEP11` for 2022 versions. When reporting a problem, include the app version, OS, status line text, DevTools console errors, and the relevant CEP log lines.

**Host scripts without the panel:** on macOS you can run ExtendScript from the terminal, which is how the Illustrator adapter was verified:

```sh
osascript -e 'tell application id "com.adobe.illustrator" to do javascript "$.evalFile(new File(\"/path/to/test.jsx\"))"'
```

## How it works

```text
client/app.js ── CSInterface.evalScript('Mullion.api.generate("<URI-encoded JSON>")')
      │
host/index.jsx ── decodes payload ─ resolves targets ─ MullionCore.buildGrid(rect, settings) ─ shapes
      │
host/<app>-adapter.jsx ── grid layer ─ tagged group ─ paths, guides, or InDesign page items
```

**One geometry engine.** `shared/grid-core.js` validates settings, converts units, and returns shapes for a rectangle `[left, top, right, bottom]` with Y growing upward: segments, boxes, polygons, Bezier curves, and dots. Each shape's kind decides its styling (margin lines, gutter and block fills, everything else). The panel runs the same file to draw its preview, validate as you type, and render library thumbnails, so the panel and the document can't disagree. The InDesign adapter converts pages' Y-down bounds to this system and back.

**One adapter per app.** `host/index.jsx` loads `illustrator-adapter.jsx` or `indesign-adapter.jsx` based on `app.name`. Both expose the same functions (documents, artboards/pages, selection, drawing, ownership, layer state, transactions), so every endpoint is shared.

**No code injection.** Every payload is JSON passed through `encodeURIComponent`, whose output contains no quotes, backslashes, or line breaks; the host decodes it with `decodeURIComponent` and `JSON.parse`.

**Structured responses.** Every endpoint returns `{"ok":true,"data":...}` or `{"ok":false,"error":{"code","message","fields"}}`.

**Host API** (`Mullion.api`). `target` is `{ mode: "active" }` (default), `{ mode: "all" }`, `{ mode: "range", range: "1-3, 5" }`, or `{ mode: "selection" }`.

| Method | Payload | Effect |
| --- | --- | --- |
| `status` | none | Host, document, artboards/pages, selection, grid counts, grid layer state |
| `preview` | `{ settings, target, mode }` | Replaces all previews; in replace mode, hides the grids it would replace |
| `clearPreview` | none | Removes previews from every open document and shows hidden grids again |
| `generate` | `{ settings, target, mode }` | Draws a grid in each target area; `mode: "add"` keeps existing grids |
| `clear` | `{ target }` | Removes GuideComposer grids from target artboards, or from inside selected objects |
| `setGridLayer` | `{ visible?, locked? }` | Shows, hides, locks, or unlocks the grid layer |
| `resizeArtboards` | `{ width, height, units, target }` | Resizes artboards/pages, keeping the top-left corner |
| `alignSelection` | `{ settings, action }` | `check`, `select` off-grid objects, or `snap` them to grid lines |
| `textMetrics` | none | Size and leading of the selected text |
| `applyPageMargins` | `{ settings, target }` | InDesign only: page margins, columns, and baseline grid |
| `drawTestLine` | none | Install diagnostic |

Error codes: `NOT_READY`, `NO_DOCUMENT`, `NO_SELECTION`, `NO_TEXT`, `INVALID_SETTINGS`, `INVALID_TARGET`, `INVALID_SIZE`, `TOO_MANY_SHAPES`, `RESIZE_FAILED`, `GUIDES_UNSUPPORTED`, `UNSUPPORTED`, `BAD_PAYLOAD`, `MISSING_FILE`, `BOOT_FAILED`, `UNEXPECTED`. One request draws at most 10,000 shapes (5,000 per area).

**Regions.** Each grid is tagged with its area: `artboard:2` or `object:left,top,right,bottom`. Generating replaces only the grid in the same region, so a grid inside a card and the page grid behind it don't replace each other. Clearing an artboard removes every grid on it, including grids inside objects there.

**Ownership: why Clear is safe.**

- Every grid is a group (InDesign: group or guides) tagged with owner, kind, artboard, and region. Every item GuideComposer draws carries the owner id.
- Only tagged grids are removed. Names are never used to decide what to delete.
- Before a grid is removed, anything inside it that GuideComposer didn't draw (artwork dragged in) is moved out, keeping its lock and visibility.
- Locked or hidden layers are unlocked for the change and restored.
- The grid layer is deleted only when completely empty, and never when it is the document's last layer.

`tests/host.test.js` and `tests/indesign.test.js` prove these rules against fake DOMs that enforce the apps' lock rules; the Illustrator scenarios also ran in Illustrator 30.8.1.

**Undo.** Illustrator records each GuideComposer action as one undo step (measured). The InDesign adapter wraps each action in `app.doScript(..., UndoModes.ENTIRE_SCRIPT)` for the same result.

**Preview.** Changes are debounced by 200 ms; host calls run one at a time and pending previews collapse to the latest settings. Generate and Clear turn preview off.

**Align objects** builds the grid for each selected object's artboard from the current settings, collects every vertical and horizontal grid position (`MullionCore.snapLines`), and moves each object by its nearer left/right and top/bottom edge (`MullionCore.snapRect`). Locked and hidden objects are skipped.

**Layout library.** Proportional layouts store margins and gutters as fractions of the artboard (shorter side, or width and height for the Van de Graaf canon) and resolve into the user's units when applied. Fixed layouts carry their own units and the size they were made for. *Suggested* lists fixed layouts with the active artboard's proportions (within 2.5%). `tests/layouts.test.js` builds every fixed layout on its size and every proportional layout on six very different artboards in two units.

## Manual QA checklist

Run on the oldest and newest versions you support, on macOS and Windows. For InDesign, run the whole list; its adapter has only been tested against a fake DOM. Record app version, OS, and result per line.

**Install and launch**
- [ ] Panel appears under Window > Extensions and opens without errors
- [ ] Draw test line works; Clear removes it
- [ ] Panel follows all four UI brightness settings, including after switching while open
- [ ] Panel resizes and docks cleanly; nothing overflows at its narrowest width
- [ ] Settings and presets survive closing the panel and restarting the app
- [ ] **Update in place:** save a preset, install the next version's `.zxp` over this one, restart, and confirm the settings and the preset are still there (run this on macOS **and** Windows every release — it is the claim [docs/UPDATING.md](docs/UPDATING.md) makes to customers)
- [ ] **Uninstall and reinstall:** confirm presets are gone afterwards, and that an exported preset file imports cleanly — so the warning we give customers is the truth

**Document states**
- [ ] With no document open: guidance message, actions disabled
- [ ] Opening a document enables actions without reopening the panel
- [ ] Switching documents, artboards, or pages updates the readout after hovering over the panel
- [ ] InDesign: the panel says "page" everywhere and shows Set page margins and columns

**Grids**
- [ ] Columns: 12 columns, 12 pt gutter, 36 pt margins on Letter give edges at 36, 70, 82 … 576
- [ ] Modular, baseline, composition, and every pattern line up with the panel drawing
- [ ] Column widths `2 1 1` and row heights `1 2 1` divide space proportionally
- [ ] Add a baseline grid draws columns and baselines in one grid; From text copies the selected text's leading (fixed and auto leading)
- [ ] Blocks: drag across modules to mark a block, click to remove it, Clear blocks; blocks generate as translucent fills beneath the lines
- [ ] Units (pt, px, mm, in) give the same grid after conversion; asymmetric margins and Extend to edges behave as labeled
- [ ] All, Chosen (`1, 3`), and bad lists (`0`, `9`, `a`) behave as labeled; a grid too big for one target draws nothing and names it
- [ ] Guides, boxes, line styles, margin color, and shaded gutters look as set; CMYK documents get CMYK colors
- [ ] Golden spiral is smooth and converges on each chosen corner, in landscape and portrait, and as a guide
- [ ] Fifths, harmonic armature, dynamic rectangle, and Villard's figure meet at the expected points; overlay columns and square modules match the drawing

**Construction lines**
- [ ] A logo made of a circle and bars: bounding box, key lines on every edge, and one circle of the right radius, each in its own color
- [ ] Groups and compound paths are read; selected text asks for outlines; nothing selected explains what to do
- [ ] Generating again replaces the construction lines; Clear in Construct removes only construction lines, not the page grid
- [ ] Full artboard and Near artwork (with Extend by) extend lines as labeled
- [ ] InDesign guides: axis-aligned grids become page guides; diagonals, curves, hexagons, and dots are refused with an explanation

**Objects, alignment, and resizing**
- [ ] Selected objects: one grid inside each object; regenerating replaces only that object's grid; Clear (Selected objects) leaves the page grid
- [ ] Check reports off-grid objects and offers Snap to grid; Select off-grid selects only those; Snap moves them onto grid lines; locked objects are skipped
- [ ] Resize to A4 keeps the top-left corner; rotate swaps orientation; an impossible size is refused with a message
- [ ] Applying a layout made for another size offers a one-click resize
- [ ] InDesign: Set page margins and columns updates Layout > Margins and Columns and the baseline grid

**Library and presets**
- [ ] The Grid, Layouts, and Construct tabs switch modes; Escape in Layouts returns to Grid; the mode and last category are remembered
- [ ] Applying a layout offers Edit settings, which opens Grid mode
- [ ] Suggested fits the artboard shape (Letter, A4, 1080 × 1080 px, 1920 × 1080 px); thumbnails match Generate
- [ ] Proportional layouts scale with the page; fixed layouts keep their units; appearance is unchanged
- [ ] Export presets writes a file; Import adds them, numbering duplicate names

**Preview and safety**
- [ ] Preview follows fast edits; turning it off restores any grid it hid; switching documents leaves nothing behind
- [ ] Generating twice leaves one grid ("Replaced"); Add to existing grids stacks them
- [ ] Artwork on the grid layer, dragged into a grid, or in look-alike groups survives Clear
- [ ] Locked or hidden grid layers can be generated into and cleared; eye and lock buttons match the Layers panel
- [ ] One Undo reverses Generate, Clear, Snap, Resize, and Set page margins (check in InDesign especially)
- [ ] Invalid input shows inline errors and never draws

**Keyboard and accessibility**
- [ ] Every control is reachable with Tab and shows a focus ring; arrows step numbers, Shift + arrow by 10; Cmd/Ctrl + Enter generates
- [ ] Typing in panel fields doesn't trigger app shortcuts

## Known limitations

- **No artboard or selection events.** The apps don't notify extensions when the active artboard or the selection changes, so the panel re-reads the document on focus, pointer entry, and document switches. The refresh button forces it.
- **Grids are found in top-level layers only** (Illustrator). A grid moved into a sublayer or another group is left alone by Clear.
- **Artboard tags store the index.** After reordering or deleting artboards, clear with Apply to All artboards.
- **Align objects uses artboard grids.** Objects are checked against the grid for their artboard, not against grids drawn inside other objects.
- **Blocks follow module positions.** Blocks outside a smaller grid are clipped or skipped when you reduce columns or rows.
- **Hexagons are whole**, leaving an even gap at the margins.
- **Dots and fills can't be guides.** InDesign guides are also only horizontal or vertical.
- **InDesign's baseline grid is document-wide**, so Set page margins and columns sets it for every page.
- **The spiral stretches to the content area**; set margins to a 1 : 1.618 area for a true golden spiral.
- **Guide color** comes from the app's preferences.

## Packaging and distribution

See [scripts/package.md](scripts/package.md) for building, signing, test installation, and the release checklist. In short:

```sh
npm run build                                    # checks + dist/<name>/
ZXPSIGNCMD=... MULLION_CERT=... npm run sign:mac # needs Rosetta on Apple Silicon
```

Or sign on GitHub: add your certificate as repository secrets and push a tag
(`.github/workflows/release.yml`). The tag must match `package.json`'s version,
the tests and the panel smoke test must pass on all three platforms first, and
the result is a permanent GitHub Release carrying the signed `.zxp`, its
SHA-256, and the release notes taken from the matching `CHANGELOG.md` section.
Workflow artefacts expire; releases do not, which is what lets you hand a
customer the previous version.

For beta testing and launch material, see [BETA.md](BETA.md) and [MARKETING.md](MARKETING.md).
Customer-facing pages (compatibility, troubleshooting, updating) are in
[docs/](docs/README.md), and everything still left to do before selling is in
[docs/LAUNCH-CHECKLIST.md](docs/LAUNCH-CHECKLIST.md).

## Renaming

The final name is **GuideComposer** and its extension id is
`com.keerthi.guidecomposer`; both are now frozen. The rename command below is
kept for maintainers creating a separate fork, not for future GuideComposer
releases:

```sh
npm run rename -- --name "Your Product" --id com.yourstudio.yourproduct --dry-run   # preview
npm run rename -- --name "Your Product" --id com.yourstudio.yourproduct
npm run check && npm run test:ui
scripts/install-dev-mac.sh --uninstall && scripts/install-dev-mac.sh
```

The tool changes everything users can see (manifest id and name, menu, grid layer name, panel text, docs, package names, ownership id) and leaves internal code identifiers alone.

It is rehearsed on every push: the **Rename rehearsal** job in
`.github/workflows/check.yml` copies the whole project to a scratch directory,
renames it to a stand-in name, and then runs the ES3 check, the unit tests, the
production build and the panel smoke test against the renamed copy. If that job
is ever removed, this paragraph stops being true and must be deleted with it.

What the rehearsal does not prove: that the rename works for *your* name and id.
Run `npm run check && npm run test:ui` yourself afterwards, and reinstall the
development extension before trusting it.

After release, don't change the id: Clear recognizes grids by it, so grids made by earlier versions would no longer be cleared. The same change also strands the user's settings and presets, which CEP stores per extension id — see [docs/UPDATING.md](docs/UPDATING.md).

## Licence and third-party code

GuideComposer is free and open source under the **MIT licence**. The extension
is never sold and nothing in it is gated; revenue comes from an optional
Supporter Pack and custom work, which are not in this repository.

- [LICENSE](LICENSE) — MIT, plus a plain-language section on what it does not
  cover: the vendored Adobe and public-domain files, the Adobe application
  itself, the separately sold materials, and the name.
- [TERMS.md](TERMS.md) — Part 1 is the free extension and is finished. Part 2 is
  the paid pack and is a **template with placeholders, not reviewed by a
  lawyer**; see [docs/LAUNCH-CHECKLIST.md](docs/LAUNCH-CHECKLIST.md), step 3.
- [NOTICE](NOTICE) — third-party attribution for `client/vendor/CSInterface.js`
  (Adobe, under Adobe's own terms) and `host/vendor/json2.js` (public domain),
  quoted from the files as shipped. The MIT licence on our code does not extend
  to theirs, and these notices must travel with every copy.
- [SECURITY.md](SECURITY.md) — how to report a vulnerability, and the properties
  the automated checks enforce (no network, no Node.js, no injection, no
  development files in the package).

**The licence cannot go inside the `.zxp`**: the build only permits `CSXS/`,
`client/`, `host/`, `shared/` and `icons/`, and the release checks reject
anything else. It reaches users through the repository and the GitHub Release
instead — see [scripts/package.md](scripts/package.md) → Distribute.
