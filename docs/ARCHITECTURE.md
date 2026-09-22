# How GuideComposer is put together

For anyone who wants to change the code — whether this is your first plugin or
your fiftieth. It explains the shape of the project and, more usefully, *why*
it has that shape, because several decisions here look odd until you know what
Adobe's plugin runtime does and does not allow.

Start here, then read the header comment of whichever file you need. Every file
opens with one.

## The one thing to understand first

A CEP plugin is **two programs that cannot see each other**, joined by a string.

```
    ┌─────────────────────────┐            ┌──────────────────────────┐
    │  THE PANEL              │            │  THE HOST SCRIPT         │
    │  client/                │            │  host/                   │
    │                         │  a string  │                          │
    │  A web page. Modern     │ ─────────► │  ExtendScript. Adobe's   │
    │  JavaScript, HTML, CSS, │            │  own JavaScript from     │
    │  running in Chromium.   │ ◄───────── │  1999. Draws the grid.   │
    │  Draws no artwork.      │  a string  │  Has no DOM, no fetch,   │
    │                         │            │  no const, no arrow fns. │
    └─────────────────────────┘            └──────────────────────────┘
```

The panel is a web page. It can do anything a web page can do, and nothing
else — it cannot touch your document. The host script *can* touch the document,
but it runs in ExtendScript, an engine that predates almost everything you know
about JavaScript.

They talk by passing **strings**. The panel URI-encodes a JSON payload and hands
it to `CSInterface.evalScript`; the host answers with a JSON string in a fixed
envelope:

```js
{ ok: true,  data: { ... } }     // it worked
{ ok: false, error: { code, message, fields } }   // it did not
```

Nearly everything else in the project follows from this split.

## The map

```
client/                 The panel: a web page
  index.html            Markup, and the script tags that load everything
  styles.css            All styling; colours come from the host's theme
  app.js                The controller — see "What app.js still does"
  modules/              Parts of the panel that stand on their own
    constants.js          Every tunable number, field list and word list
    storage.js            Settings, presets, and the backup that survives
                          an Illustrator update
    queue.js              One host call at a time, with coalescing
    bridge.js             Talking to Illustrator, and pretending to
    theme.js              Matching the host's interface brightness
    fields.js             Which settings are visible, and where errors show
    schematic.js          Turning grid geometry into SVG
  vendor/CSInterface.js Adobe's bridge library. Do not edit.

shared/                 Used by BOTH sides, so it must be ES3-safe
  grid-core.js          The grid engine. Given a rectangle and settings,
                        returns geometry. Knows nothing about Illustrator
                        or about the DOM.
  layouts.js            The 128 ready-made layouts
  formats.js            Standard artboard sizes

host/                   The host script: ExtendScript, ES3 only
  index.jsx             Endpoints, and the boot loader
  illustrator-adapter.jsx   Everything Illustrator-specific
  indesign-adapter.jsx      Everything InDesign-specific (not shipped yet)
  vendor/json2.js       JSON for an engine that has none. Do not edit.
```

## Rules that are not negotiable

**`host/` and `shared/` must be ES3.** No `const`, `let`, arrow functions,
template literals, `Array.map`, or trailing commas. ExtendScript will throw at
parse time, which in practice means the panel appears to do nothing at all.
`npm run lint:es3` enforces this and runs as part of `npm run check` — if it
complains, it is right.

`client/` has no such limit: it runs in Chromium 88+ and uses modern syntax
freely. This is why `shared/` reads like older code than `client/`. It has to.

**The panel loads from `file://`, so ES modules do not work.** No `import`, no
`export`, no bundler. Each module is a plain script that attaches what it
exports to one shared object:

```js
(function (root) {
    "use strict";
    const { SOME_CONSTANT } = root.constants;

    function doSomething() { /* ... */ }

    Object.assign(root, { doSomething });
}(window.MullionUI = window.MullionUI || {}));
```

and `index.html` loads them in dependency order. If you add a module, add its
`<script>` tag *after* anything it reads at load time.

> **Why `MullionUI`?** "Mullion" was this project's placeholder name. The rename
> tool deliberately leaves internal identifiers alone, because renaming them
> buys nothing and risks something. It is invisible to users. `MullionCore` and
> `MullionLayouts` are the same story.

**No network access, ever.** The panel makes no requests, loads nothing
remotely, and has no analytics. A release check fails the build if a remote URL
appears in the panel's HTML or CSS. This is a promise in `PRIVACY.md`, not a
preference.

**Modules take their dependencies, they do not reach for them.** Where a module
needs something from the controller — the DOM registry, a way to speak to the
status line — it receives it once at startup:

```js
configureFields({ field, rescueFocus, say, els, panelMode: () => panelMode });
```

`panelMode` is passed as a *function* because the mode changes while the panel
is open. A value would be a snapshot of whatever it happened to be at startup.

## What app.js still does

Roughly three thousand lines, and deliberately not split further. It is the
controller: it owns the DOM, the panel's live state, and what happens when you
click something. Its sections are marked with banner comments — `// ---- status`,
`// ---- preview`, and so on.

Splitting it further would mean passing `els` and half a dozen state variables
into every new file. That produces more files that are each harder to
understand, not easier. A module earned its own file here only when it could
stand on its own, or when its dependencies could be stated in one short list.

## How a grid actually gets drawn

Worth following once end to end:

1. You change a setting. `readSettings()` collects every control into a plain
   object.
2. `MullionCore.buildGrid(rect, settings)` (in `shared/grid-core.js`) turns that
   into geometry — segments, boxes, dots — or into errors naming the settings at
   fault. **This is pure.** No DOM, no Illustrator, same input always gives the
   same output, which is why the engine is the easiest part to test.
3. `modules/schematic.js` draws that geometry as SVG in the panel. Still nothing
   has touched your document.
4. If Preview is on, the settings go through `modules/queue.js` to the host,
   which runs the *same* `buildGrid` and draws real artwork.

The engine running on both sides is the point: the picture in the panel cannot
drift from what you get on the page, because they are the same calculation.

## Ownership: why Clear never deletes your artwork

Every item GuideComposer draws is tagged with the extension id, and the layer
and group carry tags too. `Clear` finds grids by those tags. Artwork it did not
create has no tag, so it is never touched — and if you *edit* a grid, the panel
notices and hands it back to you rather than deleting your work.

This is why the extension id must never change after release: grids drawn by an
earlier version would stop being recognised. See `docs/UPDATING.md`.

## Running it

```sh
npm install
npm run check        # ES3 lint + unit tests — run this before every commit
npm run test:ui      # the whole panel in headless Chrome
npm run qa:illustrator   # 84 checks in a real, running Illustrator
```

**You can develop the whole panel without Illustrator.** Open
`client/index.html` in a browser and it switches to a mock host with a fake
document. Add `?theme=light`, `?theme=mediumdark`, `?nodoc` or `?host=indesign`
to the URL to see other states. This is also how `npm run test:ui` works.

To run it inside Illustrator, `scripts/install-dev-mac.sh` (or
`install-dev-windows.ps1`) links the folder into Illustrator's extensions
directory and turns on the setting that allows unsigned extensions.

## If you are adding something

**A new setting:** add the control to `index.html`, add its name to the right
list in `modules/constants.js` (`NUMBER_FIELDS`, `BOOLEAN_FIELDS`, …), handle it
in `shared/grid-core.js`, and add a test in `tests/grid-core.test.js` asserting
the exact coordinates it produces.

**A new host call:** it needs a name in `HOST_METHODS`
(`modules/constants.js`), an endpoint in `host/index.jsx`, and an answer from
the mock bridge in `modules/bridge.js`. Forgetting the third is the easy
mistake — everything works in Illustrator and the browser build silently breaks.

**A new grid type:** `shared/grid-core.js` is where it belongs, and it should
produce geometry only. If you find yourself wanting Illustrator there, the
design has gone wrong somewhere.

## Where the tests are, and what each is for

| Command | Proves |
| --- | --- |
| `npm test` | The engine's exact output, the host logic against a fake Illustrator DOM, and that the docs describe the code they claim to |
| `npm run test:ui` | The real panel, in a real browser, clicked through end to end |
| `npm run qa:panel` | The real panel inside a running Illustrator, driven over CEP's debugging port — the gap between the two above. Open the panel first |
| `npm run qa:illustrator` | The host code in a running Illustrator, in documents it creates and closes |
| `npm run qa:indesign` | The same, in InDesign |

The unit tests are fast and the first place to add one. The panel smoke test is
what catches a module that throws on load — it prints any startup error before
the checks that would fail because of it.

`qa:panel` exists because the other two leave a gap: `test:ui` drives the whole
panel but in headless Chrome against a mock host, and `qa:illustrator` runs the
host code but never the panel that calls it. Nothing covered the thing a user
actually does — open the panel in Illustrator and press a button. That gap is
how the module split could have shipped having only ever run in headless
Chrome: `index.html` went from loading two panel scripts to nine, and a script
that fails in CEP's embedded Chromium leaves the panel blank while every
headless test still passes.
