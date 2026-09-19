# Security

## Reporting a vulnerability

Email **[SUPPORT_EMAIL]** with "security" in the subject. Please do not open a
public issue for anything that could be used against a user before there is a
fix.

Tell us what you found, how to reproduce it, and what you think an attacker
could do with it. We will acknowledge within [SUPPORT_RESPONSE_TIME], tell you
whether we can reproduce it, and say when we expect to ship a fix. We will
credit you in the changelog unless you prefer otherwise. There is no bug bounty:
this is a one-person product.

## Supported versions

The latest released version receives fixes. Older versions do not; every release
is permanently downloadable, so upgrading is always possible.

## What the plugin does and doesn't do

Facts that shape the threat model, all enforced by the automated checks in
`npm run check` and the build:

- **No network access.** The plugin makes no network requests, loads no remote
  scripts, stylesheets, fonts or images, and has no update check or telemetry. A
  test fails the build if any panel file references a remote address.
- **Node.js is off.** The panel runs without CEP's Node.js integration
  (`--enable-nodejs` and `--mixed-context` are rejected by the release checks),
  so panel code has no filesystem or process access beyond what CEP allows a
  plain web page.
- **No code injection across the bridge.** Every payload sent from the panel to
  the host application is JSON passed through `encodeURIComponent`, whose output
  contains no quotes, backslashes or line breaks, and is decoded with
  `decodeURIComponent` + `JSON.parse` on the other side. Script text is never
  assembled from user input.
- **File access is user-initiated only.** The plugin reads and writes files only
  when you choose Export presets or Import presets, to the location you pick.
  Imported preset files are validated and capped before use.
- **Local storage only.** Settings and presets live in the panel's own
  per-extension storage on the user's machine (`docs/UPDATING.md`).
- **Nothing development-related ships.** The build copies only `CSXS/`,
  `client/`, `host/`, `shared/` and `icons/`, and then verifies the output
  contains no tests, scripts, debug configuration, certificates, or source maps.

## Supply chain

- The product has **no runtime dependencies**. The single development dependency
  (`acorn`, used by the ES3 checker) never reaches a customer's machine.
- `npm audit` runs on every push, advisory only, because a dev-only advisory
  must not be able to block a release — but it is always visible in CI.
- The signing tool (Adobe's `ZXPSignCmd`) is pinned to a specific commit in
  Adobe's repository and verified against a recorded SHA-256 before it is run,
  because it runs in the same job as the signing certificate and its password.
- Signing secrets live only in GitHub Actions secrets, are written to a
  temporary file that is deleted in a `finally` block, and are never printed.
- Every release publishes the SHA-256 of the `.zxp` so a customer can verify
  what they downloaded.

## What we ask of you

- Verify the checksum published with each release before installing.
- Get releases from the official release page or the store listing only. A
  `.zxp` from anywhere else may not be the one we signed.
