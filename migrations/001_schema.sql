-- Accounts hold two numbers in integer minor units:
--   balance: what the account owns (always the sum of its ledger entries)
--   held:    the part of the balance promised to active reservations
-- available = balance - held. The CHECKs make an overdraft impossible to
-- commit, whatever the application does.
CREATE TABLE accounts (
  id          text        PRIMARY KEY,
  balance     bigint      NOT NULL DEFAULT 0 CHECK (balance >= 0),
  held        bigint      NOT NULL DEFAULT 0 CHECK (held >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT held_within_balance CHECK (held <= balance)
);

CREATE TABLE reservations (
  id               uuid        PRIMARY KEY,
  account_id       text        NOT NULL REFERENCES accounts (id),
  amount           bigint      NOT NULL CHECK (amount > 0),
  status           text        NOT NULL DEFAULT 'reserved'
                               CHECK (status IN ('reserved', 'captured', 'released', 'expired')),
  captured_amount  bigint      CHECK (captured_amount > 0 AND captured_amount <= amount),
  expires_at       timestamptz NOT NULL,
  created_at       timestamptz NOT NULL,
  finalized_at     timestamptz,
  CONSTRAINT captured_amount_iff_captured
    CHECK ((status = 'captured') = (captured_amount IS NOT NULL)),
  CONSTRAINT finalized_iff_not_reserved
    CHECK ((status = 'reserved') = (finalized_at IS NULL))
);

CREATE INDEX reservations_due_idx ON reservations (expires_at) WHERE status = 'reserved';
CREATE INDEX reservations_account_idx ON reservations (account_id);

-- A reservation leaves 'reserved' exactly once, and nothing else about it
-- ever changes. The domain enforces the same rule; this is the backstop.
CREATE FUNCTION reservations_guard_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'reserved' THEN
    RAISE EXCEPTION 'reservation % is % and cannot change', OLD.id, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.id <> OLD.id OR NEW.account_id <> OLD.account_id OR NEW.amount <> OLD.amount
     OR NEW.expires_at <> OLD.expires_at OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'reservation % has immutable fields', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reservations_guard_transition
  BEFORE UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION reservations_guard_transition();

CREATE FUNCTION reservations_forbid_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'reservations are never deleted' USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER reservations_forbid_delete
  BEFORE DELETE ON reservations
  FOR EACH ROW EXECUTE FUNCTION reservations_forbid_delete();

-- Every change to a balance is one row here, and rows are never changed or
-- removed. Signed amounts: credits are positive, captures negative.
CREATE TABLE ledger_entries (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id      text        NOT NULL REFERENCES accounts (id),
  kind            text        NOT NULL CHECK (kind IN ('credit', 'capture')),
  amount          bigint      NOT NULL CHECK (amount <> 0),
  balance_after   bigint      NOT NULL CHECK (balance_after >= 0),
  reservation_id  uuid        UNIQUE REFERENCES reservations (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sign_matches_kind CHECK (
    (kind = 'credit' AND amount > 0 AND reservation_id IS NULL)
    OR (kind = 'capture' AND amount < 0 AND reservation_id IS NOT NULL)
  )
);

CREATE INDEX ledger_entries_account_idx ON ledger_entries (account_id, id);

CREATE FUNCTION ledger_entries_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only' USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_append_only();

CREATE TRIGGER ledger_entries_no_truncate
  BEFORE TRUNCATE ON ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_entries_append_only();

-- One row per Idempotency-Key. The key is claimed (inserted) in the same
-- transaction that performs the operation and stores its outcome, so a
-- visible row always carries a final outcome.
CREATE TABLE idempotency_keys (
  key          text        PRIMARY KEY CHECK (length(key) BETWEEN 1 AND 255),
  operation    text        NOT NULL,
  fingerprint  text        NOT NULL,
  outcome      json,          -- json, not jsonb: keeps the stored response byte for byte
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Accounts whose stored numbers disagree with the facts they summarize.
-- Must always be empty; the test suite checks it after every scenario.
CREATE VIEW account_discrepancies AS
SELECT a.id,
       a.balance,
       coalesce(e.total, 0) AS ledger_total,
       a.held,
       coalesce(r.total, 0) AS active_holds_total
FROM accounts a
LEFT JOIN (SELECT account_id, sum(amount) AS total FROM ledger_entries GROUP BY account_id) e
  ON e.account_id = a.id
LEFT JOIN (SELECT account_id, sum(amount) AS total FROM reservations
           WHERE status = 'reserved' GROUP BY account_id) r
  ON r.account_id = a.id
WHERE a.balance <> coalesce(e.total, 0)
   OR a.held <> coalesce(r.total, 0);
