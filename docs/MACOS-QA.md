# macOS Illustrator release check

Use this on a **second macOS user account**, not the account the code is
developed on. It takes about an hour. The tester needs no development tools and
no access to the source.

> **Why a separate account, and not just "quit the panel first".** Two reasons,
> and both make a test on the development account worthless rather than merely
> risky.
>
> 1. **The development link uses the same extension id** as the signed package —
>    `com.keerthi.guidecomposer`. Install the `.zxp` alongside it and two
>    extensions claim one id. CEP loads one of them and tells you nothing about
>    which, so you can spend an hour testing the repository you were trying not
>    to test.
> 2. **`PlayerDebugMode` is on for the development account.** With it on,
>    Illustrator loads *unsigned* extensions happily — so an install that
>    "works" there proves nothing about the signature, which is the entire point
>    of this check. The setting lives in each user's own preferences, so a
>    brand-new account starts with it off, which is exactly what is wanted.
>
> Leave the development account and its link alone. Nothing in this document
> touches them.

Record these first:

- macOS version and build from  > About This Mac > More Info
- Illustrator's full version from **Help > About Illustrator**
- Whether the display is Retina/HiDPI or standard
- The `.zxp` filename and its published SHA-256

## 1. Create the test account

System Settings > Users & Groups > Add Account. A **Standard** account is
enough and is closer to what many users have than an administrator account.

Log in to it. Open Creative Cloud and sign in — Illustrator is installed for the
whole computer, but the licence is per user, and Adobe allows two activations.
Confirm Illustrator launches before going further.

Do **not** enable `PlayerDebugMode` on this account. To confirm it is off:

```sh
defaults read com.adobe.CSXS.12 PlayerDebugMode
defaults read com.adobe.CSXS.11 PlayerDebugMode
```

Both should report `does not exist`. If either prints `1`, this account has been
used for development and is not a clean test — make another one.

## 2. Confirm the download

Copy the `.zxp` and its `.sha256` file to the test account (via
`/Users/Shared`, or download both from the GitHub Release):

```sh
shasum -a 256 ~/Downloads/guidecomposer-0.1.0.zxp
```

It must match the `.sha256` file exactly. Stop and report a mismatch; do not
install a package whose checksum is wrong.

## 3. Install the signed build

Quit Illustrator, then:

```sh
"/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent" --install ~/Downloads/guidecomposer-0.1.0.zxp
```

Expect it to report success. **An error mentioning the signature or the
certificate is the most important result this whole document can produce** —
record the exact text.

List what is installed with `--list all`, and confirm GuideComposer appears.

Start Illustrator and open **Window > Extensions > GuideComposer**. Some
versions call the submenu **Extensions (Legacy)**.

Pass only if:

- GuideComposer appears in the menu and opens without a blank panel.
- The panel icon looks right in the tab and in the Window menu, on this display.
- No control is clipped at the panel's smallest size — drag it narrow.
- **More > Draw test line** draws a line; **Clear** removes it.
- **More** shows version `0.1.0`.

## 4. Exercise the real workflow

Use a new document, then a **copy** of an ordinary `.ai` document. Never a file
you cannot afford to lose.

1. Generate a column grid, a modular grid, a baseline grid, a composition guide
   and a pattern. Preview updates as you change values; **Clear** removes the
   grids and nothing else.
2. In **Layouts**, apply one grid system and one screen or social layout. Check
   the tiles show visible grid structure rather than blank or solid boxes.
3. Turn on a second grid type under **Draw another grid on top** and generate.
   Both grids should appear, in one undo step.
4. Switch **Draw the grid as** between Lines, Guides and Boxes, and confirm each
   does what the note under it says.
5. Select two rectangles, set **Apply to** to **Selected objects**, generate,
   then use **Align objects > Check** and **Snap to grid**.
6. Select a simple outlined logo and generate **Construct** lines.
7. After each Generate and each Clear, press Undo **once**. One Undo must
   reverse the whole action and leave unrelated artwork untouched.
8. Try Illustrator's light and dark interface themes.
9. Save a preset, quit Illustrator, reopen it, and confirm the preset is still
   there.

## 5. Update, uninstall, reinstall

This needs a second signed build made with the **same** certificate. Until one
exists, do the uninstall and reinstall parts and note that the update was not
tested.

1. With a preset saved and a setting changed, install the newer `.zxp` over the
   older one and restart Illustrator.
2. **The preset and the setting must still be there.** If they are not, say so —
   `docs/UPDATING.md` promises they survive, and that promise would be wrong.
3. Export the presets from **More**.
4. Remove the extension:
   ```sh
   "/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent" --remove GuideComposer
   ```
   Use the name exactly as `--list all` printed it. Restart Illustrator and
   confirm the panel is gone from the menu and nothing errors on launch.
5. Reinstall, confirm presets are **gone** (they should be — that is why the
   export in step 3 matters), then import the exported file and confirm they
   work.

## 6. Return the result

- The four recorded version/display details from the top.
- Pass or fail for sections 2–5.
- **More > Copy diagnostics** for any panel failure.
- The exact installer output for any install, update or uninstall failure.
- A screenshot or short recording for anything visual.

Do not attach confidential client artwork. A tiny document that reproduces the
problem is worth more than a real one.

## Afterwards

The test account can stay for the next release; keeping it is cheaper than
making a clean one each time, and it stays clean as long as nobody enables
debug mode on it.

Windows has its own sheet: `WINDOWS-QA.md`. Both operating systems must pass
before the first public Release — see `LAUNCH-CHECKLIST.md`, step 7.
