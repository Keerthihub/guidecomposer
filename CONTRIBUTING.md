# Contributing to GuideComposer

Thanks for helping make GuideComposer more useful to Illustrator designers.
Bug reports, UX feedback, documentation fixes, tests, and focused code changes
are welcome.

## Before you start

- Search the existing issues before opening a new one.
- Use the bug or feature issue form so the report includes the information
  needed to act on it.
- Open an issue before a large feature, dependency, UI redesign, host-app
  addition, or change to file formats or extension ownership. Wait for agreement
  on the approach before writing the implementation.
- Keep each pull request focused on one problem.

## Set up the project

GuideComposer needs Node.js 20 or later for its development checks. The shipped
extension itself has no Node.js or runtime dependencies.

```sh
npm install
npm run check
npm run test:ui
```

See [README.md](README.md) for browser UI development, loading the unsigned
panel in Illustrator, host QA, and the project architecture.

## Submit a pull request

1. Branch from `main`.
2. Add or update tests when behavior changes.
3. Run `npm run check` and `npm run test:ui`.
4. Describe the user problem, the change, and how you verified it.
5. Include before-and-after screenshots for visible UI changes.

Automated checks run on Linux, macOS, and Windows. Passing checks do not merge a
pull request automatically: a maintainer reviews every change. By contributing,
you agree that your contribution is licensed under this repository's MIT
License.

## Project boundaries

- Illustrator is the only host in the current release.
- Host JavaScript must remain compatible with ExtendScript ES3.
- The panel must continue to work offline, without telemetry, accounts, remote
  assets, or Node.js integration.
- Never commit certificates, passwords, customer files, or confidential artwork.
- Do not use the GuideComposer name or logo to imply that a fork is an official
  release.

## Security issues

Do not open a public issue for a vulnerability. Use the repository's private
**Security > Report a vulnerability** form instead.
