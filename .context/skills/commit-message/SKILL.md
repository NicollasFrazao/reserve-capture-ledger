---
type: skill
name: Commit Message
description: Write a Conventional Commits message that passes commitlint and states the right version bump. Use when committing in this repository
skillSlug: commit-message
phases: [E, C]
generated: 2026-11-01
status: filled
scaffoldVersion: "2.0.0"
---

# Commit message

Format, checked by commitlint (`@commitlint/config-conventional`) in the `commit-msg` hook and in CI:

```
type(scope): imperative summary in lower case, no period

Why the change was needed and what it does, wrapped at 72 columns.

Closes #12
```

- **type decides the version**: `feat` (minor), `fix` / `perf` / `refactor` (patch), `!` or a
  `BREAKING CHANGE:` footer (major); `docs`, `test`, `build`, `ci`, `chore`, `style` release nothing.
  Use `!` only when a client integration breaks (a changed response shape, a removed endpoint).
- **scope** is optional and names an area: `domain`, `http`, `db`, `lint`, `context`, `ci`.
- The body explains why; the diff already shows what.
- English only. One concern per commit; a refactor and a behaviour change are two commits.

Examples from this repository:

```
feat(http): add the REST API with Idempotency-Key and the expiry sweep
test: enforce 80% coverage on all four metrics
build: check the layer rules with dependency-cruiser
```
