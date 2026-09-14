# Beta test kit

Everything you need to run a two-week beta with 5–10 designers before launch. Replace "Mullion" with your product name if you have renamed it.

## 1. Who to invite

Aim for variety, because each group finds different problems:

| Tester | Why |
| --- | --- |
| 2 editorial or book designers | Baseline grids, InDesign page margins, classic layouts |
| 2 brand or identity designers | Composition guides, golden spiral, grids inside objects |
| 2 social or marketing designers | Screen and social layouts, artboard resizing, many artboards |
| 1–2 UI or web designers | Column grids in px, snapping objects to the grid |
| At least 2 Windows users | Windows hasn't been tested yet |
| At least 2 InDesign users | The InDesign version hasn't been run in InDesign yet |

Mix Illustrator versions (2022 through the latest) and screen setups (docked, floating, small laptop screens).

## 2. Invitation message

> **Subject:** Try a new grid panel for Illustrator and InDesign (free, 2-week beta)
>
> Hi [name],
>
> I'm building Mullion, a panel that makes layout grids in Illustrator and InDesign: columns, modular and baseline grids, composition guides like the golden spiral, and patterns. You can put a grid inside any object, snap artwork to it, and pick from over a hundred ready-made layouts.
>
> I'm looking for a few designers to use it on real work for two weeks and tell me what's confusing, broken, or missing. It takes about 15 minutes to get started, plus a short feedback form at the end. Beta testers get the full version free when it launches.
>
> It works offline, needs no account, and never touches artwork it didn't create.
>
> Interested? Reply with your operating system and your Illustrator or InDesign version, and I'll send the installer.
>
> Thanks,
> [your name]

## 3. What to send testers

1. The signed `.zxp` file (see `scripts/package.md` to build and sign it).
2. Install steps for their operating system (below).
3. The first-session tasks (section 4).
4. The feedback form link (section 5).
5. How to report a bug (section 6).

**Install on macOS** (Terminal):

```sh
"/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent" --install ~/Downloads/mullion-0.1.0.zxp
```

**Install on Windows** (PowerShell):

```powershell
& "C:\Program Files\Common Files\Adobe\Adobe Desktop Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent\UnifiedPluginInstallerAgent.exe" /install "$env:USERPROFILE\Downloads\mullion-0.1.0.zxp"
```

Then restart Illustrator or InDesign and open **Window > Extensions > Mullion**.

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
10. InDesign users: click **More > Set page margins and columns**, then check **Layout > Margins and Columns**.

## 5. Feedback form

Create this in Google Forms, Tally, or similar.

1. Operating system and version
2. App and version (Illustrator or InDesign, year)
3. What kind of design work do you do?
4. Did installation work the first time? If not, what happened?
5. Which tasks were easy? (checkboxes for tasks 1–10)
6. Which tasks were confusing or didn't work? What happened?
7. Did Mullion ever change or delete something you didn't expect? (Yes/No, and details)
8. Which feature would you miss most if it were removed?
9. What's missing that would make you use it every day?
10. How likely are you to recommend it to a colleague? (0–10)
11. What would you expect to pay for it? (under $20 / $20–30 / $30–40 / $40–60 / more)
12. Anything else?

## 6. Bug report template

> **What I did:** (steps, starting from opening the panel)
> **What I expected:**
> **What happened instead:**
> **Status line text:** (the message at the bottom of the panel)
> **App and version / operating system:**
> **Screenshot or screen recording:**

If the panel won't open, ask for the CEP log (see README, Debugging).

## 7. Tracking

Keep one row per issue:

| # | Tester | App / OS | Area | Summary | Severity | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | | | | | Blocker / Major / Minor | Open / Fixed / Won't fix |

**Severity:** *Blocker* stops installation or damages artwork. *Major* makes a feature unusable. *Minor* is confusing or cosmetic.

## 8. After the beta

- Fix every blocker and every major issue reported by two or more testers.
- Re-run `npm run check`, `npm run test:ui`, and the README QA checklist on macOS and Windows.
- If no one has confirmed InDesign works, launch with InDesign labeled **beta** or leave it out of the listing.
- Ask testers who scored 9–10 for a one-line quote for the sales page, with permission to use their name.
