# Windows Illustrator release check

Use this checklist on a Windows 10 or 11 computer with Illustrator 2022 or
later. It takes about one hour. The tester does not need development tools or
access to the source code.

Record these first:

- Windows edition, version, and OS build from **Settings > System > About**
- Illustrator's full version from **Help > About Illustrator**
- Screen scale from **Settings > System > Display**
- The GuideComposer `.zxp` filename and published SHA-256

## 1. Confirm the download

Open PowerShell in the folder containing the downloaded files:

```powershell
Get-FileHash .\guidecomposer-0.1.0.zxp -Algorithm SHA256
```

The result must exactly match the `.sha256` file on the GitHub Release. Stop and
report the mismatch if it does not.

## 2. Install the signed build

Do not enable CEP `PlayerDebugMode`; this test must prove that the real signed
package installs. Quit Illustrator, then run PowerShell as the same user who
runs Illustrator:

```powershell
& "C:\Program Files\Common Files\Adobe\Adobe Desktop Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent\UnifiedPluginInstallerAgent.exe" /install "$env:USERPROFILE\Downloads\guidecomposer-0.1.0.zxp"
```

Start Illustrator and open **Window > Extensions > GuideComposer**. Some
versions call the submenu **Extensions (Legacy)**.

Pass only if:

- GuideComposer appears in the menu and opens without a blank panel.
- The panel works at Windows display scaling of 100% or the tester's normal
  scale, and no controls are clipped at its minimum size.
- **More > Draw test line** draws a line; **Clear** removes it.

## 3. Exercise the real workflow

Use a new document and then a copy of an ordinary `.ai` document:

1. Generate a column grid, modular grid, baseline grid, composition guide, and
   pattern. Preview should update and **Clear** should remove only the grids.
2. In **Layouts**, apply at least one grid system and one screen or social
   layout, then choose **Edit settings**.
3. Select two rectangles, apply a grid to **Selected objects**, and use
   **Align objects > Check** and **Snap to grid**.
4. Select a simple outlined logo and generate **Construct** lines.
5. Save a preset, restart Illustrator, and confirm it remains.
6. After each Generate or Clear, press Undo once. One Undo should reverse the
   entire GuideComposer action without changing unrelated artwork.
7. Try both Illustrator's light and dark interface themes.

## 4. Update and uninstall

This part needs two signed builds that use the same certificate.

1. With the older build installed, save a preset and change a setting.
2. Install the newer `.zxp` over it and restart Illustrator.
3. Confirm the preset and setting remain.
4. Export the presets from **More**.
5. Remove GuideComposer using the same Adobe installer agent, restart
   Illustrator, and confirm the panel is gone.
6. Reinstall, import the exported presets, and confirm they work.

## 5. Return the result

Open a GitHub issue and include:

- The four recorded version/scale details
- Pass or fail for sections 1–4
- **More > Copy diagnostics** for any panel failure
- The exact installer output for any install, update, or uninstall failure
- A screenshot or short recording for anything visual

Do not attach confidential client artwork. A tiny document that reproduces the
problem is more useful.
