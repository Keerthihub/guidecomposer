# Launch checklist

Everything still standing between this repository and a product someone can buy.
Only you can do these: they need a legal name, a bank account, a certificate, a
clean machine, or a decision.

Work top to bottom — later steps depend on earlier ones (the name has to be
final before the artwork; the certificate before the signing; the signing before
anyone can test what customers will install). Each step says **how you know it
is done**.

Nothing here is blocked by code. The code is finished and tested; this list is
the business.

---

## 1. Choose the final name, and clear it

The product still carries a placeholder name and the placeholder extension id
`com.keerthi.guidecomposer`. (Once you have run step 2, this page renames itself along
with everything else, and steps 1 and 2 are behind you.)

- [ ] Search national trademark registers for the name in the classes that cover
      computer software, at minimum where you will sell and where you live
      (USPTO TESS, EUIPO eSearch, UK IPO, WIPO Global Brand Database — all free).
- [ ] Search the Adobe Exchange / Creative Cloud Marketplace and the app stores
      for an existing plugin with a confusable name.
- [ ] Check that the matching domain and social handles are available, if you
      want them.
- [ ] If the stakes are high, have a trademark attorney do a clearance search.
      This is the one piece of legal advice that is cheap relative to the cost of
      being wrong after launch.

**Done when:** you have written the final name and the final reverse-DNS id
(e.g. `com.yourstudio.yourproduct`) somewhere permanent, and you are willing to
put it on a receipt.

**Then:** *Reference: `../README.md` → Renaming.*

---

## 2. Run the rename tool

```sh
npm run rename -- --name "Your Product" --id com.yourstudio.yourproduct --dry-run
npm run rename -- --name "Your Product" --id com.yourstudio.yourproduct
npm run check && npm run test:ui
npm run icons        # only if you also changed the icon
```

The tool renames everything customers see, and leaves internal identifiers
alone. The **Rename rehearsal** job in `.github/workflows/check.yml` runs this
same sequence on a throwaway copy on every push, so it is exercised
continuously — but it has never been run on *your* chosen name.

- [ ] Rename run, `npm run check` and `npm run test:ui` pass afterwards.
- [ ] Development extension reinstalled
      (`scripts/install-dev-mac.sh --uninstall && scripts/install-dev-mac.sh`)
      and the panel opens under its new name.
- [ ] The placeholder-name note has disappeared from `README.md` (the tool
      removes it).

**Done when:** `grep -ri mullion . --exclude-dir=node_modules --exclude-dir=.git`
returns only internal identifiers (`MullionCore`, `Mullion.api`,
`mullion.settings.v1`, and the rename tool and its test), and nothing a customer
could read.

**Do this before any artwork, any listing text, and any sale.** After the first
public release the id must never change again: `Clear` finds grids by it, so
grids made by earlier versions would become unremovable (`docs/UPDATING.md`,
last table row).

*Reference: `../README.md` → Renaming; `../scripts/rename.js`.*

---

## 3. Fill in every legal placeholder

Every `[PLACEHOLDER]` in the repository is listed in the table at the bottom of
this file. They are single tokens so you can find them all in one pass:

```sh
grep -rn "\[[A-Z_]\{3,\}\]" --include="*.md" --include="*.yml" \
     --include="LICENSE" --include="NOTICE" . | grep -v node_modules
```

- [ ] `LICENSE` — the end-user licence agreement the buyer accepts.
- [ ] `TERMS.md` — the short public summary.
- [ ] `PRIVACY.md` — already accurate about behaviour; needs your identity,
      support address, and retention periods.
- [ ] `NOTICE` — needs your name and the year only.
- [ ] `SECURITY.md` — support address and response time.
- [ ] `docs/COMPATIBILITY.md`, `docs/TROUBLESHOOTING.md` — support address, the
      versions you actually tested, refund wording.
- [ ] `.github/ISSUE_TEMPLATE/config.yml` — your GitHub owner/repo and support
      address, **or** delete that folder if the repository stays private.
- [ ] `MARKETING.md` — price and update policy (step 9).

**Done when:** the `grep` above returns nothing, and a lawyer qualified in your
jurisdiction has read `LICENSE` and `TERMS.md`. Selling to consumers in the EU
and UK brings statutory rights (withdrawal period, guarantees) that a template
cannot cover for you.

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

## 9. Set the price

- [ ] Read the price question in your beta survey (`../BETA.md`, section 5).
- [ ] Decide the launch price, the regular price, and whether there is a studio
      or multi-seat licence — the seat count you choose must match `[SEAT_COUNT]`
      in `LICENSE` and `TERMS.md`.
- [ ] Decide the update policy (free within a major version is the usual
      answer), and write it into `[UPDATE_POLICY]`.
- [ ] Decide the refund policy, and write it into `[REFUND_POLICY]`.
- [ ] Check what your store keeps (platform fee, payment fee, VAT/sales tax
      handling) and whether it acts as merchant of record — if it does not, tax
      registration is your problem, in every jurisdiction you sell into.

**Done when:** the price, the seat terms, the update policy, and the refund
policy say the same thing in the licence, the terms, the listing, and the
checkout page. `../MARKETING.md` has a starting recommendation, not a decision.

---

## 10. Build the sales package and the listing

- [ ] Assemble the sales zip: the `.zxp`, the installation guide PDF,
      `LICENSE.txt`, `PRIVACY.txt`, the troubleshooting page, and a quick-start
      link (`../scripts/package.md` → Distribute). **The licence cannot go inside
      the `.zxp`** — the package may only contain the extension's own files — so
      the zip is how it reaches the customer, and the listing page is where they
      read it before buying.
- [ ] Produce the listing artwork (`LISTING-ARTWORK.md`), and confirm the exact
      pixel sizes in the submission form before drawing anything.
- [ ] Write the listing text from `../MARKETING.md`, and check every claim in it
      against what you have actually verified.
- [ ] Publish the privacy policy and terms at stable public URLs — a store
      listing needs to link to them, not to a repository file.
- [ ] Direct sale: set up the store (Gumroad, Lemon Squeezy, your own),
      test-buy your own product end to end, and confirm the delivery email
      contains the download and the licence.
- [ ] Adobe Marketplace (optional, later): publisher profile, listing, upload the
      signed `.zxp`, declare supported versions, submit for review.

**Done when:** a stranger can buy it, download it, install it from the
instructions in the zip, and read the licence they agreed to — without emailing
you.

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
| `[PRODUCT_NAME]` | Final product name (the rename tool fills the rest of the repository; these files use the token because they are written before the name exists) | `LICENSE`, `NOTICE` |
| `[PUBLISHER_NAME]` | The legal name you sell under — a person or a company | `LICENSE`, `NOTICE`, `PRIVACY.md`, `TERMS.md` |
| `[PUBLISHER_ADDRESS]` | The postal address on the licence. Required by consumer law in many places; a registered business address, not your home, if you can | `LICENSE`, `PRIVACY.md`, `TERMS.md` |
| `[JURISDICTION]` | Country (and state/province) whose law governs, and whose courts hear disputes | `LICENSE`, `TERMS.md` |
| `[SUPPORT_EMAIL]` | The support address from step 4 | `LICENSE`, `PRIVACY.md`, `TERMS.md`, `SECURITY.md`, `docs/TROUBLESHOOTING.md`, `docs/COMPATIBILITY.md`, `.github/ISSUE_TEMPLATE/config.yml` |
| `[SUPPORT_LANGUAGE]` | The language(s) you answer in | `LICENSE`, `TERMS.md` |
| `[SUPPORT_PERIOD]` | How long support lasts after purchase (e.g. "12 months") | `LICENSE`, `TERMS.md` |
| `[SUPPORT_RESPONSE_TIME]` | How quickly you answer (e.g. "two working days") | `docs/TROUBLESHOOTING.md`, `SECURITY.md` |
| `[DATA_REQUEST_RESPONSE_TIME]` | How quickly you answer a data request (e.g. "within 30 days") | `PRIVACY.md` |
| `[RETENTION_PERIOD]` | How long you keep support email | `PRIVACY.md` |
| `[SEAT_COUNT]` | How many computers one licence covers | `LICENSE`, `TERMS.md` |
| `[SEAT_HOLDER]` | Who may use those installations (e.g. "one named person") | `LICENSE`, `TERMS.md` |
| `[UPDATE_POLICY]` | Which updates are free (e.g. "all 1.x updates are free") | `LICENSE`, `TERMS.md`, `MARKETING.md` |
| `[REFUND_POLICY]` | Your refund terms in full | `LICENSE`, `TERMS.md` |
| `[REFUND_POLICY_SHORT]` | One clause version, for the InDesign beta note | `docs/COMPATIBILITY.md` |
| `[LIABILITY_PERIOD]` | Look-back period for the liability cap (e.g. "12 months") | `LICENSE` |
| `[PRICE]` | The launch price | `MARKETING.md` |
| `[STORE_NAME]` | The store you sell through | `PRIVACY.md` |
| `[ORDER_DETAILS]` | What that store passes to you about a buyer | `PRIVACY.md` |
| `[VERSION]` | The version these documents were written for | `LICENSE`, `docs/COMPATIBILITY.md` |
| `[DATE]` / `[YEAR]` | Publication date; copyright year | `LICENSE`, `NOTICE`, `PRIVACY.md`, `TERMS.md` |
| `[TESTED_ILLUSTRATOR_VERSIONS]` | The Illustrator versions you have actually run it in | `docs/COMPATIBILITY.md` |
| `[TESTED_MACOS_VERSIONS]` | The macOS versions you tested (from step 7) | `docs/COMPATIBILITY.md` |
| `[TESTED_WINDOWS_VERSIONS]` | The Windows versions and builds you tested (from step 7) | `docs/COMPATIBILITY.md` |
| `[GITHUB_OWNER]` / `[GITHUB_REPO]` | Your GitHub account and repository name, if you make the repository public for issue reporting. If you keep it private, delete `.github/ISSUE_TEMPLATE/` instead and point customers only at email | `.github/ISSUE_TEMPLATE/config.yml` |

Two things deliberately left blank because no one but you can know them: the
identity you trade under, and what you charge.
