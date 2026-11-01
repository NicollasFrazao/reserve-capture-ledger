---
type: skill
name: Test Generation
description: Add unit and integration tests for an operation or a bug fix in this repository. Use when a change needs tests or coverage dropped
skillSlug: test-generation
phases: [E, V]
generated: 2026-11-01
status: filled
scaffoldVersion: "2.0.0"
---

# Test generation

Follow [agents/test-writer.md](../../agents/test-writer.md). The procedure:

1. **Domain rule?** Add a unit test in `test/unit/` for the allowed case and each refusal (assert
   the `LedgerError` subclass and that state did not change).
2. **Operation?** Add to `test/integration/`:
   - the happy path through `post()`, asserting the response and the account view;
   - the replay: same key twice, `raw` equal, `replayed` true, one row;
   - the conflict: same key, other payload, 409 and no effect;
   - a race if money is involved: `Promise.all` on a `slowAccountLocks(50)` context.
3. **Bug fix?** Write the failing test first, from the report, then fix.
4. **Database guard?** A raw-SQL test in `invariants.test.ts` that expects the statement to be
   rejected.
5. Run `npm run test:coverage`; the gate is 80% on lines, branches, functions and statements.
