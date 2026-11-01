---
type: skill
name: Code Review
description: Review a change in this repository against its invariants and gate. Use when reviewing a pull request or a local diff before merge
skillSlug: code-review
phases: [R, V]
generated: 2026-11-01
status: filled
scaffoldVersion: "2.0.0"
---

# Code review

1. Run the gate on the branch, one command at a time: `npm run lint`, `npm run typecheck`,
   `npm run check:architecture`, `npm run check:unused`, `npm run test:coverage`,
   `npm run check:context`. Record the numbers.
2. Read the diff by layer, domain first. For each change to money or state, check the list in
   [agents/code-reviewer.md](../../agents/code-reviewer.md): `Money`, `idempotent()`, lock order,
   ledger entry, error mapping, check-then-act, layer imports, migrations.
3. Check the docs moved with the code: TSDoc on new exports (lint enforces presence, not accuracy),
   README endpoints and error table, `.context/docs/` when a rule or a decision changed.
4. Ask for the missing test rather than describing the bug: the reviewer's best evidence is a test
   that fails on the current code.
5. Leave one comment per finding, with the file and line, what goes wrong, and the smallest fix.
