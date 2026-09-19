# Beta test kit

Everything you need to run a two-week beta with 5–10 designers before launch. Replace "GuideComposer" with your product name if you have renamed it.

## 1. Who to invite

Aim for variety, because each group finds different problems:

| Tester | Why |
| --- | --- |
| 2 editorial or book designers | Baseline grids, classic book layouts, margins |
| 2 brand or identity designers | Composition guides, golden spiral, grids inside objects |
| 2 social or marketing designers | Screen and social layouts, artboard resizing, many artboards |
| 1–2 UI or web designers | Column grids in px, snapping objects to the grid |
| At least 2 Windows users | Windows hasn't been tested yet |
| At least 2 Illustrator 2022 or 2023 users | Only the newest Illustrator has been run |

Mix Illustrator versions (2022 through the latest) and screen setups (docked, floating, small laptop screens).

## 2. Invitation message

> **Subject:** Try a new grid panel for Illustrator (free, 2-week beta)
>
> Hi [name],
>
> I'm building GuideComposer, a panel that makes layout grids in Illustrator: columns, modular and baseline grids, composition guides like the golden spiral, and patterns. You can put a grid inside any object, snap artwork to it, and pick from over a hundred ready-made layouts.
>
> I'm looking for a few designers to use it on real work for two weeks and tell me what's confusing, broken, or missing. It takes about 15 minutes to get started, plus a short feedback form at the end. It is free and open source, and it will stay that way — you are not testing a trial.
>
> It works offline, needs no account, and never touches artwork it didn't create.
>
> Interested? Reply with your operating system and your Illustrator version, and I'll send the installer.
>
> Thanks,
> [your name]

## 3. What to send testers

1. The signed `.zxp` file (see `scripts/package.md` to build and sign it).
2. Install steps for their operating system (below).
3. The first-session tasks (section 4).
4. The feedback form link (section 5).
5. How to report a bug (section 6).
6. `docs/TROUBLESHOOTING.md`, so a tester whose panel doesn't appear can get
   themselves unstuck instead of dropping out of the beta.
7. `docs/UPDATING.md` — testers will be sent several builds during the beta, and
   need to know to export their presets before each one.
8. The beta terms: that this is a pre-release, that it may lose their presets,
   and that they should not use it on work they can't afford to redo. If you
   have a beta licence text, send it; otherwise say this in the email.

**Install on macOS** (Terminal):

```sh
"/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent" --install ~/Downloads/guidecomposer-0.1.0.zxp
```

**Install on Windows** (PowerShell):

```powershell
& "C:\Program Files\Common Files\Adobe\Adobe Desktop Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent\UnifiedPluginInstallerAgent.exe" /install "$env:USERPROFILE\Downloads\guidecomposer-0.1.0.zxp"
```

Then restart Illustrator and open **Window > Extensions > GuideComposer**.

## 4. First-session tasks (about 15 minutes)

Ask testers to do these on a copy of real work, and to note anything that surprises them.

1. Open the panel and click **More > Draw test line**. Did a line appear? Click **Clear**.
2. Click **Layouts** and pick one that suits your current project. Click **Generate**.
3. Change the number of columns with the − and + buttons while **Preview** is on. Click **Generate** again. Is there exactly one grid?
4. Select a rectangle or photo frame, set **Apply to** to **Selected objects**, and generate a grid inside it.
5. Place a few objects roughly, open **Align objects**, click **Check**, then **Snap to grid**.
6. Try **Compose**, turn on **Golden spiral**, and try each focus corner. Then select a logo, open **Construct**, and click **Generate**.
7. Turn on **Add a baseline grid**, select some text, and click **From text**.
8. Save your settings as a preset, then use **More > Export presets**.
9. Press Undo once after Generate. Did the whole grid disappear?

## 5. Feedback form

Create this in Google Forms, Tally, or similar.

1. Operating system and version
2. Illustrator version (year)
3. What kind of design work do you do?
4. Did installation work the first time? If not, what happened?
5. Which tasks were easy? (checkboxes for tasks 1–10)
6. Which tasks were confusing or didn't work? What happened?
7. Did GuideComposer ever change or delete something you didn't expect? (Yes/No, and details)
8. Which feature would you miss most if it were removed?
9. What's missing that would make you use it every day?
10. How likely are you to recommend it to a colleague? (0–10)
11. What would you expect to pay for it? (under $20 / $20–30 / $30–40 / $40–60 / more)
12. Anything else?

## 6. Bug report template

Send this to testers as a template they can copy. The first line does most of
the work: **More > Copy diagnostics** puts the plugin version, the host application
and version, the operating system, the open document's name and size, the
current panel settings, and the last error on the clipboard in one click. It
contains no artwork and no document contents; tell testers they can delete the
document name if a project is confidential.

> **Diagnostics:** (paste the output of More > Copy diagnostics — if the panel
> won't open, fill in the next three lines by hand instead)
> **Plugin version:** (e.g. 0.1.0 — from the diagnostics, from the Creative
> Cloud desktop app's plugin list, or from the filename you installed)
> **App and version:** (Help > About — the full number, e.g. "Illustrator 2025,
> 29.3", not just the year)
> **Operating system and build:** (macOS: Apple menu > About This Mac, and say
> Apple Silicon or Intel — e.g. "macOS 15.3, Apple Silicon". Windows: Settings >
> System > About, copy the Edition, Version and OS build lines — e.g. "Windows
> 11 Pro 24H2, build 26100.2894")
> **What I did:** (steps, starting from opening the panel)
> **What I expected:**
> **What happened instead:**
> **Status line text:** (the message at the bottom of the panel)
> **Does it happen every time?**
> **Screenshot or screen recording:**

Why the OS *build* and not just "Windows 11": CEP's embedded Chromium and the
Creative Cloud plugin installer behave differently across feature updates, and
"Windows 11" covers several years of them.

The same fields are in `.github/ISSUE_TEMPLATE/bug_report.yml` if you open the
repository to testers, and in `docs/TROUBLESHOOTING.md` for customers after
launch.

If the panel won't open, first point testers at `docs/TROUBLESHOOTING.md` — it
covers the common causes without asking anyone to edit a registry. Only if that
fails, ask for the CEP log (see README, Debugging), and send them the exact
commands rather than asking them to find them.

## 7. Tracking

Keep one row per issue:

| # | Tester | App / OS | Area | Summary | Severity | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | | | | | Blocker / Major / Minor | Open / Fixed / Won't fix |

**Severity:** *Blocker* stops installation or damages artwork. *Major* makes a feature unusable. *Minor* is confusing or cosmetic.

## 8. After the beta

- Fix every blocker and every major issue reported by two or more testers.
- Re-run `npm run check`, `npm run test:ui`, and the README QA checklist on macOS and Windows.
- InDesign is not in this beta and not in this launch: the manifest declares Illustrator alone. Do not mention it to testers.
- Ask testers who scored 9–10 for a one-line quote for the sales page, with permission to use their name.
