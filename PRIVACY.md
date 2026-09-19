# Privacy policy

_Last updated: [DATE]. Every `[PLACEHOLDER]` below is listed in
`docs/LAUNCH-CHECKLIST.md`; fill them all in before publishing._

GridComposer is an extension for Adobe Illustrator and Adobe InDesign published by
[PUBLISHER_NAME] ("we").

## What GridComposer collects

Nothing. GridComposer does not collect, transmit, sell, or share personal data or
usage data.

- **No network access.** GridComposer makes no network requests of any kind. It
  contains no analytics, advertising, crash reporting, update checks, or
  tracking code. The panel loads no remote scripts, stylesheets, fonts, or
  images: every file it uses ships inside the extension. This is enforced
  automatically on every build — a test fails the build if any panel file
  references a remote address.
- **No accounts.** GridComposer never asks for a sign-in, an email address, or a
  licence key, and has no way to send one anywhere.
- **No telemetry, ever.** If a future version needed a network connection for
  any reason, this policy would be updated and the change stated in the release
  notes before that version was released.

## What GridComposer stores on your computer

Everything GridComposer saves stays on your own computer. None of it is readable by
us.

- **Panel settings, interface state, and saved presets** are stored in the
  panel's local browser storage, which Adobe's CEP runtime keeps per extension,
  on your computer only, under three keys: `mullion.settings.v1` (the current
  grid settings), `mullion.presets.v1` (presets you save), and `mullion.ui.v1`
  (which mode and category the panel was in). They contain only numbers, colors,
  units, and any names you typed for your own presets.
- **Removing the extension deletes them.** So does clearing Adobe's CEP cache.
  Export your presets first if you want to keep them — see the update and
  reinstall guide in `docs/UPDATING.md`.
- **Your documents** gain a layer named "GridComposer grids" containing the grids you
  create. Grids carry small tags that identify them as GridComposer grids, so GridComposer
  can find and clear them without touching your artwork. These stay in your
  documents like any other artwork, and travel with the file if you send it to
  someone else.
- **Preset files** are written only when you choose Export presets, to the
  folder and filename you pick, and read only when you choose Import presets.
  GridComposer reads no other file on your computer, and writes nowhere else.

## Purchases

If you bought GridComposer through a store (for example the Adobe Creative Cloud
Marketplace, or [STORE_NAME]), that store processes your payment and personal
information under its own privacy policy, not this one. We receive only what the
store shares with sellers, such as [ORDER_DETAILS].

## Support requests

If you email us for support, we use your email address, your message, and
anything you attach (such as the diagnostics text the panel can copy, a
screenshot, or a file you send us) only to answer you. The diagnostics the panel
copies contain the plugin version, the host application and its version, your
operating system and browser engine string, the **name** and size of the
document you have open, how many artboards it has, your current panel settings,
and the last error the panel showed. They contain no artwork, no document
contents, and nothing else about you — but the document name is yours to check
before you paste it, and you can edit it out. We keep support email for [RETENTION_PERIOD], then delete
it. We do not use it for marketing unless you ask to be told about updates.

## Children

GridComposer is a professional design tool. It is not directed at children and
collects nothing from anyone.

## Your rights

Because we hold no data about you except any support email you chose to send, a
request to see or delete what we hold means, in practice, the support email
thread. Write to [SUPPORT_EMAIL] and we will [DATA_REQUEST_RESPONSE_TIME].

## Changes

If a future version changes what GridComposer collects or stores, we will update this
policy, and say so in the release notes, before releasing that version.

## Contact

[PUBLISHER_NAME]
[PUBLISHER_ADDRESS]
[SUPPORT_EMAIL]
