# Troubleshooting Mullion

Everything here is safe to do yourself. Nothing on this page asks you to edit
the Windows registry, run terminal commands as an administrator, or change any
setting outside Illustrator, InDesign, and the Creative Cloud desktop app.

If you get stuck, jump to [Reporting a problem](#reporting-a-problem) — it takes
about two minutes and tells us almost everything we need.

## Contents

- [The panel doesn't appear in the Window menu](#the-panel-doesnt-appear-in-the-window-menu)
- [The panel opens but is blank, grey, or white](#the-panel-opens-but-is-blank-grey-or-white)
- [The panel shows a message I don't understand](#the-panel-shows-a-message-i-dont-understand)
- [I clicked Generate and nothing appeared](#i-clicked-generate-and-nothing-appeared)
- [The panel looks wrong or text is cut off](#the-panel-looks-wrong-or-text-is-cut-off)
- [My presets or settings disappeared](#my-presets-or-settings-disappeared)
- [Finding your version](#finding-your-version)
- [Reporting a problem](#reporting-a-problem)

## The panel doesn't appear in the Window menu

Work through these in order.

1. **Look in the right place.** It is **Window > Extensions > Mullion**. In
   recent releases of Illustrator and InDesign the submenu is called
   **Extensions (Legacy)**. Both are correct; Mullion is a CEP extension, which
   is what that submenu lists.
2. **Restart the application completely.** Newly installed extensions only
   appear after a full restart. On macOS, quitting the window is not enough:
   quit the application itself (Cmd+Q) and reopen it.
3. **Check that it actually installed.** Open the **Creative Cloud desktop
   app**, go to the plugins area (**Stock & Marketplace > Plugins > Manage
   plugins**, or **Marketplace > Plugins**, depending on your version), and look
   for Mullion in the list of installed plugins. If it isn't there, the
   installation didn't complete — install the `.zxp` again with the steps in the
   installation guide that came with your download.
4. **Check your application version.** Mullion needs Illustrator 2022 (26.0) or
   later, or InDesign 2022 (17.0) or later. Older versions will not list it. See
   `COMPATIBILITY.md` for the full matrix. Your application version is under
   **Illustrator > About Illustrator** (macOS) or **Help > About Illustrator**
   (Windows).
5. **Check that you restarted the right application.** Mullion installs once and
   serves both Illustrator and InDesign. If it appears in one and not the other,
   restart the other one too, and check that application's version.
6. **If you have several Creative Cloud accounts or a managed/enterprise
   install**, make sure the account you installed the plugin with is the account
   signed in to the application.

Still missing? Send us a bug report with the diagnostics text if you can reach
another machine, or just tell us your operating system, application version, and
how you installed it.

## The panel opens but is blank, grey, or white

This means the panel's own interface failed to start.

1. **Close the panel and open it again** from the Window menu. This reloads it.
2. **Restart the application.**
3. **If the panel says "Mullion was updated"** with a **Reload panel** button,
   click it. That message appears when the plugin's files changed while the
   panel was open — for example just after an update.
4. **Reinstall the plugin.** Install your `.zxp` again over the top, then
   restart the application. Reinstalling in place keeps your presets; see
   `UPDATING.md`.
5. **Check you are not running two copies.** If you tried a development or beta
   copy earlier, remove it from the plugins list in the Creative Cloud desktop
   app before reinstalling the release version.

If it is still blank, report it: a blank panel is always a bug on our side, and
your application version and operating system are usually enough for us to
reproduce it.

## The panel shows a message I don't understand

Mullion explains problems in the status line at the bottom of the panel. The
common ones:

| Message | What it means | What to do |
| --- | --- | --- |
| "Open or create a document…" | No document is open. | Open a document. The panel updates by itself. |
| "Select…" / "Nothing is selected" | The action needs artwork selected. | Select the object(s), then try again. |
| "Outline the text first" | Construct can only read outlined text. | **Type > Create Outlines** on a copy, then try again. |
| A number is highlighted in red | That setting is impossible for the page (for example margins wider than the page). | Fix the highlighted field; nothing was drawn. |
| "Too many shapes" | The grid would draw more shapes than the limit that keeps the application responsive (10,000 in one go, 5,000 per artboard or page). | Use fewer columns, rows, or artboards at a time. |
| "…can't be guides" | InDesign guides are only horizontal or vertical, so dots, curves, hexagons, and diagonals can't be drawn as guides. | Choose Lines or Boxes instead of Guides. |
| "Mullion is missing …. Reinstall the extension." | Part of the plugin is missing or was blocked. | Reinstall the `.zxp` and restart the application. |
| "Mullion could not start…" | The part that runs inside Illustrator/InDesign failed to load. | Restart the application; if it persists, reinstall, then report it with the full message. |
| "…did not answer" (after a long wait) | The application didn't answer within 90 seconds, usually because it was busy with a dialog or a very large document. | Close any open dialog in the application, then try again with a smaller selection or fewer artboards. |

Copy the exact message into your bug report — it identifies the failure
precisely.

## I clicked Generate and nothing appeared

- **Check the grid layer.** Mullion draws into a layer called "Mullion grids".
  If it was hidden, use the eye button in the panel (or the Layers panel) to
  show it. The panel's own eye and lock buttons match the Layers panel.
- **The grid layer is non-printing by design.** It appears on screen but not in
  print or PDF export. That is intentional, so grids never end up in a client
  proof.
- **Check where you told it to go.** If **Apply to** is set to Selected objects,
  the grid is drawn inside the selected objects only. If it is set to a list of
  artboards, check that the list includes the one you are looking at.
- **If you chose Guides**, the grid is drawn as application guides, which are
  hidden when guides are hidden (**View > Guides > Show Guides**).

## The panel looks wrong or text is cut off

- Mullion is designed to work down to 240 pixels wide when docked. If it is
  narrower than that, widen the dock.
- If the panel's colors don't match the application after you change the
  interface brightness, close and reopen the panel.
- If text looks oversized or tiny, it follows your application's UI scaling;
  change it in the application's preferences (**Preferences > User Interface**)
  and reopen the panel.

## My presets or settings disappeared

Presets and settings are stored by the plugin on your own computer, and are
deleted when the plugin is uninstalled or the Creative Cloud plugin cache is
cleared. Read `UPDATING.md` before you uninstall, reinstall, or move to a new
computer — and export your presets first (**More > Export presets**) whenever
you are about to do any of those.

## Finding your version

- **Easiest:** open the panel and open the **More** section. The version is
  printed there, next to the plugin's name.
- **For a bug report:** in the same **More** section, click **Copy
  diagnostics**. That puts a short block of text on your clipboard: the plugin
  version, the host application and its version, your operating system, the name
  and size of the document you have open, your current panel settings, and the
  last error the panel showed. Paste it into an email. It contains no artwork
  and no document contents — only the document's name, which you can delete
  before sending if it is confidential.
- **If the panel won't open:** open the Creative Cloud desktop app's plugins
  list (**Stock & Marketplace > Plugins > Manage plugins**). The installed
  version is shown next to Mullion.
- **The file you bought** is named with its version, for example
  `mullion-0.1.0.zxp`.

## Reporting a problem

Email [SUPPORT_EMAIL] with:

1. **The diagnostics text** (**More > Copy diagnostics**), pasted into the
   email. If you can't open the panel, tell us instead:
   - the plugin version (see above),
   - the application and version (**Help > About**, e.g. "Illustrator 2025,
     29.3"),
   - your operating system **and its build/version number** — macOS: Apple menu
     > About This Mac (e.g. "macOS 15.3, Apple Silicon"); Windows: Settings >
     System > About, and copy the **Edition, Version and OS build** lines (e.g.
     "Windows 11 Pro 24H2, build 26100.2894").
2. **What you did**, step by step, starting from opening the panel.
3. **What you expected**, and **what happened instead**.
4. **The exact text in the panel's status line**, if there was any.
5. **A screenshot or short screen recording**, if the problem is visual.
6. **Whether it happens every time**, or only sometimes.

If the problem involves a specific document, tell us its page or artboard size
and units. Please don't send client files unless we ask; a small example file
that shows the same problem is more useful.

We answer at [SUPPORT_EMAIL] within [SUPPORT_RESPONSE_TIME].
