# What GuideComposer runs on

Last updated for GuideComposer [VERSION].

## Applications

| Application | Versions | Status |
| --- | --- | --- |
| Adobe Illustrator | 2022 (26.0) and later, including [TESTED_ILLUSTRATOR_VERSIONS] | Supported |
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

We have run GuideComposer on [TESTED_MACOS_VERSIONS] and [TESTED_WINDOWS_VERSIONS]. On
other versions of macOS or Windows, if your Illustrator runs, GuideComposer is
expected to run.

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

If you are unsure whether your setup is supported, email [SUPPORT_EMAIL] before
buying and ask — we would rather answer a question than issue a refund.
