# What Mullion runs on

Last updated for Mullion [VERSION].

## Applications

| Application | Versions | Status |
| --- | --- | --- |
| Adobe Illustrator | 2022 (26.0) and later, including [TESTED_ILLUSTRATOR_VERSIONS] | Supported |
| Adobe InDesign | 2022 (17.0) and later | **Beta** — see below |
| Any other Adobe application | — | Not supported. Mullion is not offered for Photoshop, After Effects, Premiere Pro, or Express. |

Mullion is one plugin that serves both Illustrator and InDesign: install it
once, and it appears in both.

**Why "beta" for InDesign.** Mullion's InDesign support is complete and tested
automatically, but it has not yet been confirmed by us in a real copy of
InDesign for long enough to promise it. Buy it for InDesign only if you are
happy to tell us when something is wrong; if it doesn't work for you,
[REFUND_POLICY_SHORT].

**Version ranges.** The plugin declares support for Illustrator 26.0 and later
and InDesign 17.0 and later. Adobe only lets a plugin state a range, not "every
future version", so the declared range reaches further than the versions we have
actually run. A newly released Illustrator or InDesign should work; tell us
quickly if it doesn't, and we will publish a fix.

## Operating systems

| System | Status |
| --- | --- |
| macOS, Apple Silicon (M-series) | Supported. Runs natively inside Illustrator/InDesign; no Rosetta needed. |
| macOS, Intel | Supported |
| Windows 10 and 11, 64-bit | Supported |
| Windows on Arm | Untested. It should work wherever Illustrator or InDesign themselves run, but we have not tried it. |
| Linux, ChromeOS, iPad | Not supported — Illustrator and InDesign for those platforms do not take this kind of plugin. |

We have run Mullion on [TESTED_MACOS_VERSIONS] and [TESTED_WINDOWS_VERSIONS]. On
other versions of macOS or Windows, if your Illustrator or InDesign runs,
Mullion is expected to run.

Minimum system requirements are Adobe's, not ours: if your computer runs
Illustrator 2022 or later, it runs Mullion. The plugin adds no meaningful memory
or disk requirement (it is under a megabyte).

## What Mullion needs, and doesn't

- **Needs:** your own licensed copy of Adobe Illustrator or Adobe InDesign, and
  the Creative Cloud desktop app to install the plugin.
- **Does not need:** an internet connection (during use — you need one once to
  download it), an account with us, a licence key, a subscription, Node.js, or
  any other plugin.
- **Screens:** the panel works docked from 240 pixels wide upward, and follows
  all four of Illustrator's and InDesign's interface brightness settings.

## Document types

- Illustrator documents in RGB or CMYK; grid colors are converted to the
  document's color mode.
- InDesign documents, including multi-page documents and facing pages.
- Units: points, pixels, millimetres, and inches.

## Languages

The panel's interface is in English only. It runs in any language version of
Illustrator or InDesign.

## Accessibility

Every control is reachable with the keyboard and shows a focus ring. The panel
follows the host application's interface brightness. It has not been tested with
a screen reader.

---

If you are unsure whether your setup is supported, email [SUPPORT_EMAIL] before
buying and ask — we would rather answer a question than issue a refund.
