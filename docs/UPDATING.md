# Updating, reinstalling, and moving to a new computer

**Short version: export your presets before you update, reinstall, or change
computers.** Open the panel, then **More > Export presets**, and keep the file
somewhere you back up. It takes five seconds and it is the only copy of your
presets that you control.

## Where your settings and presets live

GuideComposer saves three things on your own computer, in the panel's private browser
storage, which Adobe's CEP plugin runtime keeps **per extension**:

| What | Key | Contains |
| --- | --- | --- |
| Your current grid settings | `mullion.settings.v1` | The settings the panel reopens with |
| Your saved presets | `mullion.presets.v1` | Every preset you saved, with its name |
| Panel state | `mullion.ui.v1` | Which mode and layout category you were last in |

Two consequences follow from "per extension", and they explain everything below:

- The storage belongs to **the extension's identity**, not to your Adobe
  account, your documents, or the application. It is not in your Documents
  folder, it is not synced by Creative Cloud, and it is not in your document
  files.
- Anything that removes the extension, or gives it a new identity, takes the
  storage with it.

## What survives what

| Action | Settings | Presets | Grids already in your documents |
| --- | --- | --- | --- |
| Quitting and reopening the panel | Kept | Kept | Kept |
| Restarting Illustrator or InDesign | Kept | Kept | Kept |
| Restarting the computer | Kept | Kept | Kept |
| **Updating in place** — installing a newer `.zxp` over the installed one, same product | **Expected to be kept** (verified per release: see below) | **Expected to be kept** | Kept, and still recognised by Clear |
| **Uninstalling, then installing again** | **Lost** | **Lost** | Kept in the documents, and still recognised by Clear once the same product is reinstalled |
| Clearing Adobe's CEP plugin cache | **Lost** | **Lost** | Kept |
| Moving to a new computer | Not carried over | Not carried over — import your exported file | Kept, they are in the document files |
| Using a different user account on the same computer | Not carried over | Not carried over | Kept |
| Installing a version published under a **different plugin id** (a rebrand, or a different seller's build) | Not carried over | Not carried over | Kept as artwork, but **Clear and Generate no longer recognise them**: the new plugin looks for its own ownership tag. Delete those old grid layers by hand. |

Nothing in the list damages your documents. Grids are ordinary artwork on their
own layer; they stay in the file whatever happens to the plugin.

## Before you update

1. Open the panel and choose **More > Export presets**. Save the file with a
   name that includes the date.
2. Note your current version (**More > Copy diagnostics**), so you can tell us
   exactly what you upgraded from if something goes wrong.
3. Install the new `.zxp` **over** the existing installation — do not uninstall
   first. Installing over the top is the path that keeps your settings.
4. Restart Illustrator or InDesign completely.
5. If the panel was open during the update, it will say **GuideComposer was updated**
   and offer **Reload panel**. Click it, or close and reopen the panel.
6. Check that your presets are still listed. If they are not, use **More >
   Import presets** and pick the file from step 1.

## If you must uninstall first

Some installer problems are only fixed by removing the plugin and installing it
again. In that case:

1. **Export your presets first.** After the uninstall they are gone.
2. Uninstall, install the new version, restart the application.
3. **Import presets** from your exported file.

Your exported preset file is plain JSON and is not tied to a version or a
computer: importing it into a newer version works, and duplicate names are
numbered rather than overwritten.

## Moving to a new computer

1. On the old computer: **More > Export presets**.
2. Install GuideComposer on the new computer, restart the application.
3. **More > Import presets**, and pick the file.

Settings (as opposed to presets) are not exported. Save any grid setup you care
about as a preset before you export.

## Downgrading

Installing an older `.zxp` over a newer one is not supported and may leave you
with a mix of old and new files. If you need to go back to a previous version,
uninstall first, then install the old version — and remember that your presets
go with the uninstall, so export them first. Every released version stays
available permanently on the releases page, with a checksum you can verify.

## Note for the publisher

The "expected to be kept" rows above are the behaviour CEP's per-extension
storage is designed to give, but this project has not yet observed an in-place
update on a clean machine. **Verify the update path on macOS and on Windows for
every release** before publishing, and correct this page if reality differs —
the per-release steps are in `../scripts/package.md` ("Release checklist") and
in `LAUNCH-CHECKLIST.md`. Changing the extension id after release is what turns
the last row of the table from a rebrand note into a support problem; see the
Renaming section of `../README.md`.
