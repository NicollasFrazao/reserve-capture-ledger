# Agent playbooks

Playbooks tailored to this repository. The generic ones the scaffold offers were removed: a
playbook that says nothing specific to this code is noise an agent has to read past.

| Agent | Use it for |
| --- | --- |
| [Code reviewer](./code-reviewer.md) | Reviewing a diff against the invariants, the lock order and the gate |
| [Database specialist](./database-specialist.md) | Schema changes, constraints, triggers, locks, migrations |
| [Test writer](./test-writer.md) | Unit and integration tests, race tests, fault injection |

Every playbook assumes the reader has read [`development-conventions.md`](../docs/development-conventions.md).
