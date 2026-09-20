# Packaging, signing, and releasing GuideComposer

CEP extensions ship as signed `.zxp` files. Don't package GuideComposer as `.ccx`; that is the UXP format, and Illustrator doesn't run UXP plugins.

## 1. One-time setup

**Choose where to sign.**

- **On GitHub (no local tools).** Push the repository to GitHub, then add two repository secrets under Settings > Secrets and variables > Actions: `ZXP_CERT_BASE64` (on macOS: `base64 -i cert.p12 | pbcopy`) and `ZXP_CERT_PASSWORD`. Push a tag such as `v0.1.0`, or run **Signed release** from the Actions tab. See [What the release workflow does](#what-the-release-workflow-does) below — a tag publishes a permanent GitHub Release; a manual run only signs.
- **On your computer.** Download ZXPSignCmd for your OS from Adobe's [CEP-Resources repository](https://github.com/Adobe-CEP/CEP-Resources) (`ZXPSignCMD` folder). On macOS, run `chmod +x ZXPSignCmd` and approve it in System Settings > Privacy & Security if blocked. Adobe's macOS build is Intel-only: on Apple Silicon Macs install Rosetta once with `softwareupdate --install-rosetta --agree-to-license`.

  On the current development Mac, Adobe's macOS 4.1.1 tool creates certificates
  successfully but crashes while packaging on macOS 26. Use the GitHub workflow
  for releases; it uses Adobe's newer Windows 4.1.103 signer. Keep the local
  commands below as a fallback for systems where Adobe's macOS binary runs.

**Create a certificate.** Adobe accepts self-signed certificates for ZXP
packages. Store the certificate **outside this repository** and the password in
a password manager. On the prepared development Mac, run the helper with the
correct two-letter country code and state/province; it prompts privately for the
password and refuses to overwrite an existing lifetime certificate:

```sh
scripts/create-signing-cert-mac.sh IN "Tamil Nadu"
```

Change `IN` and `Tamil Nadu` if they are not the certificate owner's correct
location. The helper uses Adobe's `ZXPSignCmd`, organization `Keerthihub`,
common name `GuideComposer ZXP Signing`, a 3,650-day validity, and writes to
`~/Documents/GuideComposer Signing/guidecomposer-signing.p12`. Set
`ZXPSIGNCMD` or `GUIDECOMPOSER_CERT_DIR` to override those two paths.

Use the same certificate for every release. Updates signed with a different certificate may fail to install over the previous version.

Passing a password as a command argument can expose it to other processes on the machine. Create certificates on a machine you control.

## 2. Prepare the release

1. Update the version in **all four** places (the build refuses to run if they differ):
   - `package.json` → `version`
   - `CSXS/manifest.xml` → `ExtensionBundleVersion` and the `<Extension ... Version>` in `ExtensionList`
   - `host/index.jsx` → `M.VERSION`
   - `CHANGELOG.md` → a new top entry `## [x.y.z] - YYYY-MM-DD`
2. Narrow `<Host Name="ILST" Version="[26.0,99.9]"/>` in the manifest to the versions you have actually tested, if appropriate.
3. Run the automated checks:

   ```sh
   npm run check
   npm run test:ui
   ```

4. Complete the manual QA checklist in `README.md` on macOS and Windows.

## 3. Build and sign

`npm run build` runs the checks, then copies only `CSXS/`, `client/`, `host/`, `shared/`, and `icons/` to `dist/guidecomposer/`. It then verifies the output contains no `.debug`, tests, scripts, `node_modules`, certificates, or source maps.

**macOS / Linux**

```sh
export ZXPSIGNCMD=~/Tools/Adobe-ZXPSignCmd-4.1.1/ZXPSignCmd
export MULLION_CERT=~/Documents/GuideComposer\ Signing/guidecomposer-signing.p12
npm run sign:mac          # prompts for the password; writes dist/guidecomposer-<version>.zxp
```

**Windows** (PowerShell)

```powershell
npm run build
$version = node -p "require('./package.json').version"
$password = Read-Host "Certificate password" -AsSecureString
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($password))
& C:\Tools\ZXPSignCmd.exe -sign dist\guidecomposer "dist\guidecomposer-$version.zxp" C:\Certificates\guidecomposer-signing.p12 $plain -tsa http://timestamp.apple.com/ts01
& C:\Tools\ZXPSignCmd.exe -verify "dist\guidecomposer-$version.zxp" -certinfo
```

The timestamp (`-tsa`) keeps the signature valid after the certificate expires. If the timestamp server is unreachable, do not publish an untimestamped package. Adobe's Windows 4.1.103 tool rejected Certum's response and crashed with DigiCert and Comodo on the GitHub runner tested on 2026-09-20. Apple's endpoint granted a valid SHA-256 RFC 3161 test request and is the compatible default used by the release workflow.

### What the release workflow does

`.github/workflows/release.yml`, on a pushed `v*` tag:

1. **Refuses a mismatched tag.** `node scripts/release-checks.js --tag <tag>`
   fails the run unless the tag is `v` + `package.json`'s version, every version
   in the manifest and the host agrees with it, and `CHANGELOG.md` has notes
   under a heading for it. Pushing `v0.2.0` on a `0.1.0` commit can no longer
   produce a `guidecomposer-0.1.0.zxp` under a release called 0.2.0.
2. **Gates on the real tests.** The unit tests, the production build, **and the
   headless-Chrome panel smoke test** must pass on Ubuntu, macOS and Windows
   before anything is signed. A panel that throws on load cannot be signed.
3. **Pins the signing tool.** `ZXPSignCmd` is downloaded from a specific commit
   of Adobe's `CEP-Resources` repository, not from `master`, and its SHA-256 is
   verified before it runs — it shares a job with the certificate and its
   password. The pin and hash are recorded in the workflow file. If Adobe
   publishes a new build, the run fails loudly; check the change, then update
   both values deliberately.
4. **Signs and timestamps**, verifies the signature, and deletes the certificate
   file in a `finally` block.
5. **Publishes a permanent GitHub Release** with the `.zxp`, a `.sha256` file,
   and release notes taken from the matching `CHANGELOG.md` section plus the
   checksum and how to verify it.

The workflow artefact is only a hand-off between jobs and expires in 7 days. The
Release is the permanent copy — it is what lets you hand a customer the previous
version a year later, which workflow artefacts never could.

To verify a downloaded package by hand:

```sh
shasum -a 256 guidecomposer-0.1.0.zxp          # macOS/Linux
```

```powershell
Get-FileHash guidecomposer-0.1.0.zxp -Algorithm SHA256   # Windows
```

## 4. Test the signed package

Test on **clean user accounts** (or virtual machines) on macOS and Windows, with debug mode **off** so the signature is what's being tested.

1. Remove the development link: `scripts/install-dev-mac.sh --uninstall` or `install-dev-windows.ps1 -Uninstall`.
2. Turn off `PlayerDebugMode` (see the install scripts' header comments).
3. Install the `.zxp` with Adobe's Unified Plugin Installer Agent, which ships with Creative Cloud:

   ```sh
   # macOS
   "/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent" --install /path/to/guidecomposer-0.1.0.zxp
   ```

   ```powershell
   # Windows
   & "C:\Program Files\Common Files\Adobe\Adobe Desktop Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent\UnifiedPluginInstallerAgent.exe" /install C:\path\to\guidecomposer-0.1.0.zxp
   ```

   List installed extensions with `--list all` (macOS) or `/list all` (Windows). Remove one with `--remove` / `/remove` followed by the name exactly as the list shows it.

4. Verify in Illustrator **and InDesign**: install, launch, Draw test line, generate each grid type, Clear, restart the app, **update** (install the next version over this one), and **uninstall**.

Don't promise customers that a `.zxp` installs by double-clicking. Document the installer command above, or a ZXP installer app you have tested, for both operating systems.

## 5. Distribute

**Direct sale (for example Gumroad)**. Ship a zip like:

```text
guidecomposer-0.1.0.zip
├── guidecomposer-0.1.0.zxp             the signed package
├── guidecomposer-0.1.0.zxp.sha256      from the GitHub Release, so buyers can verify
├── Installation.pdf              tested steps for macOS and Windows, with screenshots
├── LICENSE.txt                   the end-user licence agreement (from LICENSE)
├── PRIVACY.txt                   from PRIVACY.md
├── NOTICE.txt                    third-party notices (from NOTICE)
├── Troubleshooting.pdf           from docs/TROUBLESHOOTING.md
├── Updating-and-presets.pdf      from docs/UPDATING.md — read before updating
└── Quick-start-video-link.txt
```

**How the licence reaches the customer.** It cannot be inside the `.zxp`: the
build copies only `CSXS/`, `client/`, `host/`, `shared/` and `icons/`, and
`checkPackageContents` fails the build on anything else, so a `LICENSE` file in
the package would break the release. The licence therefore reaches the buyer in
three places, and all three must exist before you sell:

1. **On the listing page, before purchase** — a link to the licence text at a
   stable public URL, so the buyer can read it before paying. Stores generally
   require this, and consumer law in several countries does too.
2. **In the sales zip**, as `LICENSE.txt` above — the copy they keep.
3. **In the delivery email** from the store, as a link.

Convert the Markdown sources to `.txt` and `.pdf` at release time (any Markdown
tool will do); do not hand a customer a `.md` file. Check first that every
`[PLACEHOLDER]` is gone — `docs/LAUNCH-CHECKLIST.md` has the list and the
one-line `grep` that finds them.

**Adobe Creative Cloud Marketplace**. Through [Adobe Developer Distribution](https://developer.adobe.com/developer-distribution/): complete the publisher profile, create a listing, and upload the signed `.zxp`. Add the description, icons, screenshots, support email, help URL, privacy policy (`PRIVACY.md`), and terms (`TERMS.md`). Declare supported Illustrator and OS versions, then submit for review. Paid listings require Adobe's commerce setup. Marketplace listings need larger icon artwork than the panel icons in `icons/`, plus screenshots — `../docs/LISTING-ARTWORK.md` lists exactly what you must produce by hand, and where the stated sizes come from.

If you sell through both channels, keep separate release records and document how each channel delivers updates.

## Release checklist

Run this for **every** release, not just the first one.

**Before tagging**

- [ ] Versions updated in package.json, manifest (2 places), host/index.jsx, and a dated CHANGELOG.md section — `node scripts/release-checks.js` proves all four agree and that the changelog section exists
- [ ] `npm run check` and `npm run test:ui` pass locally
- [ ] Manual QA checklist (README.md) complete on macOS and Windows
- [ ] `npm run build` succeeds; `dist/guidecomposer/` contains no development files
- [ ] Anything the release changes about behaviour is reflected in `docs/` — especially `docs/COMPATIBILITY.md` (versions actually tested) and `docs/UPDATING.md` (what survives an update)

**Tag and sign**

- [ ] Tag pushed as `v<version>`, matching package.json exactly (the workflow fails otherwise)
- [ ] Signed with the release certificate — the same one as every previous release — and a timestamp; `-verify` passes
- [ ] GitHub Release published with the `.zxp`, its `.sha256`, and the changelog notes
- [ ] Downloaded the `.zxp` from the Release and confirmed its SHA-256 matches the published one

**Verify what the customer will actually do — on macOS *and* on Windows, with debug mode off**

- [ ] Install, launch, Draw test line, generate each grid type, Clear, restart the app
- [ ] **Update over the previous version: settings and saved presets must survive.** Save a preset on the old version, install the new `.zxp` over it, restart, and check the preset is still listed. This is the promise `docs/UPDATING.md` makes to customers, and CEP storage is the kind of thing an installer change can quietly break — so it is re-verified every release, on both operating systems, not just once
- [ ] Export presets, uninstall, reinstall, import: the export/import path still works, and the uninstall still clears storage as documented
- [ ] Uninstall leaves no panel in the Window menu and no error on next launch
- [ ] Record the OS builds and app versions used, and update `docs/COMPATIBILITY.md` if they widen what you can claim

**Afterwards**

- [ ] Release notes published; the previous release is still downloadable for customers who need to go back
- [ ] Sales zip rebuilt with the new `.zxp`, its checksum, and the current licence and documents
