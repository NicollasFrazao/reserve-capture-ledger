# Contributing

Thanks for taking the time. This project is small on purpose; the bar is correctness under retries
and concurrency, and code a reviewer can read in one sitting.

The full rules are in [`.context/docs/development-conventions.md`](.context/docs/development-conventions.md).
This page is the short version.

## Setup

```bash
npm ci                         # installs dependencies and the git hooks
docker compose up -d --wait    # PostgreSQL 16 for the integration tests
```

## Branches

Branch from `master`, named by the kind of change:

| Prefix | For |
| --- | --- |
| `feat/` | a new capability |
| `fix/` | a defect |
| `docs/` | documentation only |
| `refactor/` | a structural change with no behaviour change |
| `chore/` | maintenance, dependencies |
| `test/` | tests only |
| `ci/` | workflows |

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), checked by commitlint in the
`commit-msg` hook and, in CI, on every commit of a pull request:

```
fix(http): answer 409 when a capture arrives after expiry

The reservation was still active in the database because the sweep had
not run yet, so the capture went through. The domain now checks the
expiry time itself.

Closes #12
```

**The commit type is the version**: `feat` → minor; `fix`, `perf`, `refactor` → patch; `!` after the
type or a `BREAKING CHANGE:` footer → major; `docs`, `test`, `build`, `ci`, `chore`, `style` → no
release. Use `!` only when a client integration breaks.

## Before pushing: the local gate

Run these one at a time (the integration tests need the database):

```bash
npm run lint                # ESLint, any warning fails
npm run typecheck
npm run check:architecture  # layer rules
npm run check:unused        # unused files, exports, dependencies
npm run test:coverage       # all tests, 80% coverage on all four metrics
npm run check:context       # agent surfaces in sync with .context/docs/README.md
```

They are the CI jobs. If they pass locally, CI passes.

## Pull requests

- Small, one concern each. A refactor and a behaviour change are two pull requests.
- Fill in the template. Verification states **results** ("137/137 tests, coverage 96/92/97/96"),
  not "tested".
- Link the issue with an English closing keyword: `Closes #12`. Other words do not link.
- Changes to balances, holds, locks or idempotency need a test that fails without the change, and
  a race test when concurrency is involved.

## Language

Code, comments, docs, commits, issues and pull requests are in English.

## Repository settings (maintainers)

After the repository is published, configure on GitHub:

- **Branch ruleset on `master`**: require a pull request; require the status checks `lint`,
  `typecheck`, `architecture`, `unused`, `test`, `audit`, `context`, `commitlint` and
  `CodeQL`; block force pushes; require linear history.
- **Code security**: enable secret scanning, push protection, Dependabot alerts and private
  vulnerability reporting (used by [SECURITY.md](SECURITY.md)).
