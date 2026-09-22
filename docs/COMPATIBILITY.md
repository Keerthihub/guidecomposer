# What GuideComposer runs on

Last updated for GuideComposer 0.1.1.

## Applications

| Application | Versions | Status |
| --- | --- | --- |
| Adobe Illustrator | 2022 (26.0) and later. Tested in Illustrator 2026 (30.8.1) | Supported |
| Adobe InDesign | — | Not in this release. Planned; see below. |
| Any other Adobe application | — | Not supported. GuideComposer is not offered for Photoshop, After Effects, Premiere Pro, or Express. |

GuideComposer is an Illustrator plugin. In any other Adobe application it will
not appear in the Extensions menu at all — nothing to uninstall, nothing to
configure, it simply is not there.

**InDesign.** It is coming, and it is not here yet. Do not buy this expecting
it. When InDesign support ships it will say so on this page and in the
changelog, and it will be part of the same purchase.

**Version ranges.** The plugin declares support for Illustrator 26.0 and later.
Adobe only lets a plugin state a range, not "every future version", so the
declared range reaches further than the versions we have actually run. A newly
released Illustrator should work; tell us quickly if it doesn't, and we will
publish a fix.

## Operating systems

| System | Status |
| --- | --- |
| macOS, Apple Silicon (M-series) | Supported. Runs natively inside Illustrator; no Rosetta needed. |
| macOS, Intel | Supported |
| Windows 10 and 11, 64-bit | Supported |
| Windows on Arm | Untested. It should work wherever Illustrator itself runs, but we have not tried it. |
| Linux, ChromeOS, iPad | Not supported — Illustrator for those platforms does not take this kind of plugin. |

We have run GuideComposer on macOS 26.4.1 (Apple Silicon). **Its installation
has not been verified on Windows.** The automated tests and the build run on
Windows in CI, and the package contains no platform-specific code — it is the
same file on both systems — but nobody has recorded installing the panel in
Illustrator on Windows. On other versions of macOS, if your Illustrator runs,
GuideComposer is expected to run.

Minimum system requirements are Adobe's, not ours: if your computer runs
Illustrator 2022 or later, it runs GuideComposer. The plugin adds no meaningful memory
or disk requirement (it is under a megabyte).

## What GuideComposer needs, and doesn't

- **Needs:** your own licensed copy of Adobe Illustrator, and the Creative
  Cloud desktop app to install the plugin.
- **Does not need:** an internet connection (during use — you need one once to
  download it), an account with us, a licence key, a subscription, Node.js, or
  any other plugin.
- **Screens:** the panel works docked from 240 pixels wide upward, and follows
  all four of Illustrator's interface brightness settings.

## Document types

- Illustrator documents in RGB or CMYK; grid colors are converted to the
  document's color mode.
- Units: points, pixels, millimetres, and inches.

## Languages

The panel's interface is in English only. It runs in any language version of
Illustrator.

## Accessibility

Every control is reachable with the keyboard and shows a focus ring. The panel
follows the host application's interface brightness. It has not been tested with
a screen reader.

---

If you are unsure whether your setup is supported, ask at
https://github.com/Keerthihub/guidecomposer/issues before
buying and ask — we would rather answer a question than issue a refund.
