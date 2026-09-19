# Launch checklist

Everything still standing between this repository and a launch. Only you can do
these: they need a legal name, a certificate, a clean machine, or a decision.

**The model.** The extension is free and open source under the MIT licence.
Nobody pays to unlock it, and nothing in it may ever be gated. Revenue comes
from an optional Supporter Pack and from custom work, sold beside it. That
changes what this list is for: the goal is no longer "a stranger can buy it",
it is **"a stranger can install it in two minutes without being asked for
anything"** — because adoption is what the paid things depend on.

Work top to bottom — later steps depend on earlier ones (the certificate before
the signing; the signing before anyone can test what users will install). Each
step says **how you know it is done**.

Nothing here is blocked by code. The code is finished and tested; this list is
the business.

---

## 1 and 2. Name and rename — done

The product is **GuideComposer**, id `com.keerthi.guidecomposer`, renamed
throughout by `npm run rename`. Tagline: *Professional Layout Grids for
Illustrator*.

**The id is now frozen.** `Clear` finds grids by it, so changing it again after
the first public release would strand every grid drawn by an earlier version.

One thing was deliberately skipped and is still worth doing before you publish
widely: a trademark search on the name (USPTO TESS, EUIPO eSearch, UK IPO, WIPO
Global Brand Database — all free), plus a look through Adobe Exchange for a
confusable plugin name. Cheap now; expensive after people know the name.

---

## 3. Fill in every legal placeholder

Every `[PLACEHOLDER]` in the repository is listed in the table at the bottom of
this file. They are single tokens so you can find them all in one pass:

```sh
grep -rn "\[[A-Z_]\{3,\}\]" --include="*.md" --include="*.yml" \
     --include="LICENSE" --include="NOTICE" . | grep -v node_modules
```

The MIT licence cut most of this work away. `LICENSE` now needs **one** token —
the copyright holder — and needs no lawyer. What remains is about the paid pack
and about support.

- [ ] `LICENSE` — `[COPYRIGHT_HOLDER]` only. The name you want on the copyright
      line of every copy, forever. A personal name is normal for a solo project.
- [ ] `NOTICE` — the same name.
- [ ] `TERMS.md` — **Part 2 only.** Part 1 (the free extension) is finished; the
      pack's terms need the store, seat holder, update and refund policies.
- [ ] `PRIVACY.md` — your identity, support address, retention periods, and what
      your store passes you about a buyer.
- [ ] `SECURITY.md` — support address and response time.
- [ ] `docs/COMPATIBILITY.md`, `docs/TROUBLESHOOTING.md` — support address and
      the versions you actually tested.
- [ ] `.github/ISSUE_TEMPLATE/config.yml` — your GitHub owner/repo and support
      address. The repository is public now, so keep this rather than deleting
      it: issues are how free users reach you without costing you an inbox.

**Done when:** the `grep` above returns nothing. A lawyer is no longer needed for
`LICENSE` — MIT is a standard, widely-litigated text and changing a word of it
makes it worse. Have someone qualified read `TERMS.md` Part 2 before you take
money, and note that selling to consumers in the EU and UK brings statutory
rights (withdrawal period, guarantees) that a template cannot cover for you.

*Reference: `../LICENSE`, `../TERMS.md`, `../PRIVACY.md`, `../NOTICE`.*

---

## 4. Stand up a support address

- [ ] Create a dedicated address (`support@yourdomain`), not your personal inbox.
- [ ] Send a test email to it from outside, and confirm it arrives and you can
      reply from it.
- [ ] Decide and write down your answer time, and put the same figure in
      `TERMS.md`, `PRIVACY.md`, `docs/TROUBLESHOOTING.md`, and the store listing.
- [ ] Set an autoresponder that says when you will reply, so a customer at
      midnight is not left wondering.
- [ ] Decide where bug reports go (a file, a spreadsheet, GitHub Issues) and
      how a customer's report reaches it. Issue templates for a public
      repository are in `.github/ISSUE_TEMPLATE/`.

**Done when:** an email sent by a stranger reaches you and gets an automatic
acknowledgement, and the same address appears everywhere a customer might look.

*Reference: `../BETA.md` → bug reports; `TROUBLESHOOTING.md` → Reporting a problem.*

---

## 5. Create the signing certificate

Adobe accepts a self-signed certificate for `.zxp` packages.

```sh
ZXPSignCmd -selfSignedCert US CA "Your Company" "Your Name" "<password>" ~/Certificates/product.p12 -validityDays 3650
```

- [ ] Certificate created **outside** this repository, with a long validity.
- [ ] Password stored in a password manager; certificate backed up somewhere you
      will still have it in five years.
- [ ] Both added to GitHub as repository secrets: `ZXP_CERT_BASE64`
      (`base64 -i cert.p12`) and `ZXP_CERT_PASSWORD`.

**Done when:** the secrets exist and a manual run of the **Signed release**
workflow completes signing and verification.

**Why it matters later:** updates signed with a *different* certificate may
refuse to install over the previous version. Use one certificate for the life of
the product.

*Reference: `../scripts/package.md` → One-time setup.*

---

## 6. Cut the first signed release

The release pipeline now refuses to produce a mislabelled package: the tag must
match `package.json`, and the tests and the panel smoke test must pass on
macOS, Windows and Linux before anything is signed.

- [ ] Versions agreed in `package.json`, `CSXS/manifest.xml` (twice),
      `host/index.jsx`, and a dated `CHANGELOG.md` section
      (`node scripts/release-checks.js` proves it).
- [ ] Tag pushed (`git tag v1.0.0 && git push origin v1.0.0`).
- [ ] The workflow published a GitHub Release with the `.zxp`, its `.sha256`,
      and the changelog notes.
- [ ] You downloaded the `.zxp` from that release and checked its SHA-256
      against the published one.

**Done when:** a permanent release page exists that you could send a customer
six months from now — which is the point: workflow artefacts expire, releases do
not.

*Reference: `../.github/workflows/release.yml`, `../scripts/package.md`.*

---

## 7. Verify on clean macOS and Windows accounts

The most expensive step, and the one nobody can do for you. Use a fresh user
account or a virtual machine, with `PlayerDebugMode` **off**, so you are testing
the signature and the real install path.

For **each** of macOS and Windows:

- [ ] Install the signed `.zxp` with Adobe's Unified Plugin Installer Agent, from
      a written instruction sheet — the same sheet the customer will get. Fix the
      sheet wherever you had to improvise.
- [ ] Restart the application; the panel appears under **Window > Extensions**
      (or **Extensions (Legacy)**).
- [ ] **Draw test line** works; **Clear** removes it.
- [ ] Work through the manual QA checklist in `../README.md`.
- [ ] Save a preset, then **update in place** with the next version's `.zxp`:
      **the preset and the settings must still be there afterwards.** Record the
      result in `docs/UPDATING.md` if it differs from what that page predicts.
- [ ] Uninstall, reinstall, and confirm the presets are gone — so you can tell
      customers the truth, and so the warning in `docs/UPDATING.md` is proven.
- [ ] Confirm an exported preset file imports cleanly after the reinstall.
- [ ] Check the panel icon in the tab and the Window menu, on a HiDPI/Retina
      screen and a standard one, in the light and dark interface.
- [ ] Uninstall cleanly: no panel left in the menu, no error on next launch.

**Done when:** you have done all of the above on both operating systems, and
noted the exact OS builds and application versions — they go into
`docs/COMPATIBILITY.md` and the store listing.

*Reference: `../scripts/package.md` → Test the signed package; `UPDATING.md`.*

---

## 8. InDesign — decided: not in this release

**This is done.** The decision was to launch Illustrator only.
`CSXS/manifest.xml` declares `ILST` alone, so the panel does not appear in
InDesign at all; `tests/release.test.js` fails the build if any other host is
declared, and `docs/COMPATIBILITY.md`, `MARKETING.md` and `BETA.md` all say
Illustrator only. Nothing further is needed to ship.

What follows is the recipe for the *later* release that adds InDesign.

The InDesign adapter is tested only against a simulated InDesign. It has never
run in InDesign.

There is one command for this. Open InDesign, then:

```sh
npm run qa:indesign
```

It creates its own documents, runs 31 checks covering everything InDesign does
differently — the cursor sitting in text, localised stroke names, facing-page
margins, the baseline grid's reference point, inserting a page under an existing
grid, master pages, guides, rollback, and a 200-page document — closes what it
opened, and prints a pass or fail for each. The same 31 checks already pass
against a simulated InDesign, so a failure here means InDesign genuinely differs
from what the adapter expects: exactly what you need to know.

- [x] **Chosen:** InDesign removed from this release — undeclared in the
      manifest, absent from the listing.
- [ ] *For the InDesign release:* run `npm run qa:indesign` in a real copy of
      InDesign and fix what it reports, on macOS and on Windows.
- [ ] *Then:* add a Host entry named `IDSN` with range `[17.0,99.9]` to
      `CSXS/manifest.xml`, update the host assertion in `tests/release.test.js`,
      and restore InDesign to `docs/COMPATIBILITY.md`, `MARKETING.md` and
      `BETA.md`.

**Done when:** what the listing promises and what you have actually run are the
same thing. For this release they already are.

---

## 9. Publish the free extension

This is the launch. Everything that earns money depends on it, and nothing here
involves a payment page.

- [ ] Create the public GitHub repository, push, and check that `LICENSE`,
      `NOTICE`, `README.md` and `docs/` read correctly to someone who has never
      seen the project.
- [ ] Attach the signed `.zxp` to a GitHub Release, with its SHA-256 checksum
      and install instructions for both operating systems in the release notes.
      Tagging is what produces it — `../scripts/package.md`.
- [ ] Write the README's opening for a stranger: what it does, one screenshot or
      GIF, how to install, and that it is free. Not the internal README's
      audience — that file is for whoever works on the code.
- [ ] Add `CONTRIBUTING.md` and a code of conduct if you want contributions, or
      say plainly in the README that issues are welcome and pull requests are
      not, if you would rather keep control. Either is fine; silence is not.
- [ ] Decide what support you actually promise free users, and write it in the
      README. "Issues are read, replies are not guaranteed" is honest and
      sustainable. A promise you cannot keep at 1,000 users is worse than none.
- [ ] Adobe Exchange listing: publisher profile, listing text from
      `../MARKETING.md`, artwork from `LISTING-ARTWORK.md`, the signed `.zxp`,
      declared versions, submit for review. Free listings are still reviewed,
      and review takes time — start it early.

**Done when:** someone who has never spoken to you can find the project, install
it, and use it, without an account, a key, or an email address.

---

## 10. Set up the Supporter Pack

Only after step 9. The pack is worth nothing until people are using the
extension.

- [ ] **Decide what is actually in it.** The free extension already ships 128
      layouts, including print, screen, social and modular. A pack of "more
      presets" competes with the free product and loses. See the Pricing section
      of `../MARKETING.md` for what to sell instead: Illustrator documents,
      teaching, and supporting the project.
- [ ] Make the materials. This is real design work and it is not in this
      repository; budget for it honestly.
- [ ] Set up the store (Gumroad or similar), and check whether it is merchant of
      record. If it is not, VAT and sales-tax registration is your problem in
      every jurisdiction you sell into — for a $12 product that can cost more
      than it earns.
- [ ] Fill `[STORE_NAME]`, `[UPDATE_POLICY]`, `[REFUND_POLICY]`, `[SEAT_HOLDER]`
      and `[SUPPORT_PERIOD]` in `../TERMS.md`, and make the checkout page say the
      same thing.
- [ ] Test-buy your own pack end to end and confirm the delivery email arrives
      with the download and the terms.
- [ ] Publish the privacy policy and terms at stable public URLs — a checkout
      page must link to them, not to a repository file.

**Done when:** you have bought your own pack from a different email address and
received something you would be happy to have paid $12 for.

---

## 10a. Donations inside the panel — optional, and not yet possible

You asked for a "Support this project" link in an About section. There is no
About section in the panel today, and no URL to point it at. When you have a
GitHub Sponsors or Gumroad page, this is a small change: one line in the More
section beside the version number, opening in the system browser.

Two cautions. Adobe Exchange has rules about external payment links in listed
extensions — check them before adding it, not after a rejection. And the panel
currently makes **no network connections at all**, which `PRIVACY.md` and
`TERMS.md` both state as a feature; a link the user clicks does not break that,
but anything that loads remotely would.

---

## 11. After launch

- [ ] Watch the support address for the first week as if it were a job.
- [ ] Record every issue with its OS and application version
      (`../BETA.md` → Tracking).
- [ ] For each release afterwards, repeat the per-release checklist in
      `../scripts/package.md`, including the update/preset verification on both
      operating systems.
- [ ] Keep every released `.zxp` reachable: each tag leaves a permanent GitHub
      Release with a checksum, which is what lets you hand a customer the
      previous version when a new one breaks something for them.

---

## Placeholders to fill

Single-token placeholders, so one pass through this table finishes the legal and
support copy. "Files" lists every file the token appears in.

| Token | What it is | Files |
| --- | --- | --- |
| `[COPYRIGHT_HOLDER]` | The name on the copyright line of every copy of the code, for ever. Changing it later does not change copies already published | `LICENSE`, `NOTICE` |
| `[PUBLISHER_NAME]` | The name you sell the pack under — a person or a company | `PRIVACY.md`, `TERMS.md` |
| `[PUBLISHER_ADDRESS]` | The postal address on the pack's terms. Required by consumer law in many places; a registered business address, not your home, if you can | `PRIVACY.md`, `TERMS.md` |
| `[JURISDICTION]` | Country (and state/province) whose law governs the pack's terms | `TERMS.md` |
| `[SUPPORT_EMAIL]` | The support address from step 4 | `PRIVACY.md`, `TERMS.md`, `SECURITY.md`, `docs/TROUBLESHOOTING.md`, `docs/COMPATIBILITY.md`, `.github/ISSUE_TEMPLATE/config.yml` |
| `[SUPPORT_LANGUAGE]` | The language(s) you answer in | `TERMS.md` |
| `[SUPPORT_PERIOD]` | How long pack support lasts after purchase (e.g. "12 months") | `TERMS.md` |
| `[SUPPORT_RESPONSE_TIME]` | How quickly you answer (e.g. "two working days") | `docs/TROUBLESHOOTING.md`, `SECURITY.md` |
| `[DATA_REQUEST_RESPONSE_TIME]` | How quickly you answer a data request (e.g. "within 30 days") | `PRIVACY.md` |
| `[RETENTION_PERIOD]` | How long you keep support email | `PRIVACY.md` |
| `[SEAT_HOLDER]` | Who may use the pack's materials (e.g. "one named person") | `TERMS.md` |
| `[UPDATE_POLICY]` | Whether pack buyers get later versions of the pack | `TERMS.md`, `MARKETING.md` |
| `[REFUND_POLICY]` | Your refund terms for the pack, in full | `TERMS.md` |
| `[STORE_NAME]` | The store you sell the pack through | `PRIVACY.md`, `TERMS.md` |
| `[ORDER_DETAILS]` | What that store passes to you about a buyer | `PRIVACY.md` |
| `[VERSION]` | The version these documents were written for | `docs/COMPATIBILITY.md` |
| `[DATE]` | The date these documents were last updated | `PRIVACY.md`, `TERMS.md` |
| `[ISSUES_URL]` | Where free users report bugs — your GitHub issues page | `TERMS.md` |
| `[TESTED_ILLUSTRATOR_VERSIONS]` | The Illustrator versions you have actually run it in | `docs/COMPATIBILITY.md` |
| `[TESTED_MACOS_VERSIONS]` | The macOS versions you tested (from step 7) | `docs/COMPATIBILITY.md` |
| `[TESTED_WINDOWS_VERSIONS]` | The Windows versions and builds you tested (from step 7) | `docs/COMPATIBILITY.md` |
| `[GITHUB_OWNER]` / `[GITHUB_REPO]` | Your GitHub account and repository name | `.github/ISSUE_TEMPLATE/config.yml` |

Two things deliberately left blank because no one but you can know them: the
identity you trade under, and what you charge for the pack.

`[COPYRIGHT_HOLDER]` is the one that cannot be changed later. It goes on every
published copy of the code, and copies already out keep whatever it said.
