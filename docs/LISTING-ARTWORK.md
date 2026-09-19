# Artwork: what is generated, and what you must draw yourself

Two different sets of images are involved in shipping this plugin, and they are
easy to confuse:

1. **Panel icons** — tiny images Illustrator and InDesign show in the panel tab
   and the Window menu. These ship *inside* the `.zxp`. They are generated:
   `npm run icons`.
2. **Listing artwork** — the product icon, screenshots and video a customer sees
   on a store page or your sales page. These are *not* in the `.zxp`. Nobody can
   generate them for you.

## 1. Panel icons — generated, but replaceable

`npm run icons` (`scripts/make-icons.js`) writes ten files into `icons/`:

| File | Size | Manifest entry |
| --- | --- | --- |
| `icon-normal.png` | 23 × 23 | `<Icon Type="Normal">` |
| `icon-rollover.png` | 23 × 23 | `<Icon Type="RollOver">` |
| `icon-dark-normal.png` | 23 × 23 | `<Icon Type="DarkNormal">` |
| `icon-dark-rollover.png` | 23 × 23 | `<Icon Type="DarkRollOver">` |
| `icon-disabled.png` | 23 × 23 | `<Icon Type="Disabled">` — **not yet in the manifest; add it** |
| the same five with `@2X` | 46 × 46 | none — the host finds them by name |

**Where these requirements come from** (checked, not assumed):

- **The five types, and only those five.** Adobe's manifest schema
  `ExtensionManifest_v_7_0.xsd` — the schema version this project's
  `CSXS/manifest.xml` declares — allows at most five `<Icon>` elements and
  restricts `Type` to exactly `Normal`, `Disabled`, `RollOver`, `DarkNormal`,
  `DarkRollOver`. The schema is published in Adobe's `Adobe-CEP/CEP-Resources`
  repository. Note there is **no** `DarkDisabled`: one disabled icon has to work
  on light and dark themes, which is why the generated one is mid-grey and
  semi-transparent.
- **`@2X` for HiDPI.** The CEP 11.1 and CEP 12 HTML Extension Cookbooks, section
  "High DPI Panel Icons", say to ship `<name>@2X.png` next to `<name>.png` at
  200%, and that the host picks it up automatically without a manifest entry.
  (The same section notes Photoshop additionally accepts `_x2`; Illustrator and
  InDesign are only documented for `@2X`.)
- **23 × 23 pixels.** This is *not* stated as a rule in either Cookbook. It is
  the size of the icons in Adobe's own sample extension
  (`CEP_12.x/Samples/CEP_HTML_Test_Extension-12.0/TeEx_HTML_TEST_23x23_*.png`)
  and the size this project has always used. Treat it as the convention. I could
  not find a documented minimum, maximum, or required size, and did not want to
  invent one.
- **Not established:** whether Illustrator and InDesign actually render the
  `Disabled` icon (the Cookbooks never mention it), and whether `@2X` icons are
  picked up on Windows HiDPI as well as Retina Macs. Both need to be looked at
  once on a real machine with the signed package installed. Until then, the
  extra files are harmless: unreferenced files in `icons/` are packaged but
  ignored.

**To use the disabled icon**, add this line inside `<Icons>` in
`CSXS/manifest.xml` (the generator prints it too):

```xml
<Icon Type="Disabled">./icons/icon-disabled.png</Icon>
```

**Should you replace the generated icons?** The generated icon is a legible
schematic page with two mullions, drawn pixel by pixel. It is honest, and it is
not distinctive. Before launch, draw the panel icon by hand (in Illustrator,
obviously) and export it at 23 × 23 and 46 × 46 for each of the five states. A
hand-drawn icon is the one piece of "generated" artwork a customer sees inside
the product, and it sits in the tab bar next to Adobe's own icons all day.

## 2. Listing artwork — you must produce all of this

None of this exists in the repository today.

### Required for any store or sales page

| Item | Notes |
| --- | --- |
| **Product icon**, three sizes | Adobe's plugin submission material asks for three icon sizes — reported as **48 × 48, 96 × 96 and 192 × 192 px**, PNG or JPG, under 1 MB each. See the caution below. |
| **Screenshots**, 5–10 | Reported requirement: PNG or JPG, under 5 MB, **1360 × 800 px**. See the caution below. The shot list is in `../MARKETING.md`. |
| **Sales page hero image** | Only for your own site; no fixed size. |
| **Demo video**, about 60 seconds | Script in `../MARKETING.md`. Optional for Adobe's listing, decisive for a direct sale. |
| **Installation guide** with screenshots, as a PDF | Ships inside the sales zip (`../scripts/package.md`). Customers cannot double-click a `.zxp`; this is the single biggest source of support email for CEP plugins. |

**Caution about those pixel sizes.** The 48/96/192 icons and 1360 × 800
screenshots come from Adobe's *UXP plugin* submission checklist on
developer.adobe.com; the Creative Cloud Developer Distribution guide confirms
that "3 plugin icon sizes" are required but does not publish the numbers in the
documentation I could read. **Confirm the exact sizes in the Developer
Distribution submission form itself before you spend a day on artwork.** I have
not been able to establish them from a source that names CEP/ZXP listings
specifically, and I did not want to state a number as fact that would cost you a
rejected submission.

### Worth producing, not required

- A short animated GIF of the preview updating as you change columns — the one
  thing that sells this plugin in a tweet.
- Before/after images: a scattered layout, then the same layout snapped to the
  grid.
- A one-page "what's in the box" image for the sales page.
- Social preview image (Open Graph) for your sales page link.

### Rules to follow in all of it

- Do not use Adobe's logos, product icons, or the Creative Cloud logo in your
  own artwork or icon. You may say "for Adobe Illustrator" in text.
- Do not put a real client's work in a screenshot without permission.
- Keep the product name in the artwork consistent with the final name you chose
  (see `LAUNCH-CHECKLIST.md`) — regenerating a video because the name changed is
  a wasted afternoon.
- Take screenshots at 2× on a Retina display, in both the light and the dark
  interface, and pick whichever reads better per shot.
