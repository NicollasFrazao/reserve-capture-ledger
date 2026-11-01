import type { Account } from '../domain/account.js';
import type { LedgerEntryView, NewLedgerEntry } from '../domain/ledger-entry.js';
import type { Reservation } from '../domain/reservation.js';
import type { StoredOutcome } from './idempotency.js';

/** Persistence of accounts, inside the current transaction. */
export interface AccountRepository {
  /** Reads an account without locking it; null when it does not exist. */
  find(id: string): Promise<Account | null>;
  /** Reads the account and locks its row until the transaction ends; null when it does not exist. */
  lock(id: string): Promise<Account | null>;
  /** Creates the account with a zero balance if it does not exist yet. */
  ensureExists(id: string): Promise<void>;
  /** Writes the account's balance and held amount. */
  save(account: Account): Promise<void>;
}

/** Persistence of reservations, inside the current transaction. */
export interface ReservationRepository {
  /** Reads a reservation without locking it; null when it does not exist. */
  find(id: string): Promise<Reservation | null>;
  /** Reads the reservation and locks its row until the transaction ends; null when it does not exist. */
  lock(id: string): Promise<Reservation | null>;
  /** Stores a new reservation. */
  insert(reservation: Reservation): Promise<void>;
  /** Writes the reservation's status, captured amount and finalization time. */
  save(reservation: Reservation): Promise<void>;
  /** Lists active reservations whose expiry time is at or before `now`, oldest first. */
  findDueIds(now: Date, limit: number): Promise<string[]>;
}

/** The append-only ledger, inside the current transaction. */
export interface LedgerRepository {
  /** Appends one balance movement and returns it as stored. */
  append(entry: NewLedgerEntry): Promise<LedgerEntryView>;
}

/** An idempotency key as stored. */
export interface IdempotencyRecord {
  operation: string;
  fingerprint: string;
  outcome: StoredOutcome | null;
}

/** Idempotency keys and their outcomes, inside the current transaction. */
export interface IdempotencyRepository {
  /**
   * Inserts the key; resolves to false if it already exists.
   *
   * @remarks
   * A concurrent transaction holding the same uncommitted key makes this call
   * wait for it to finish, which is what serializes duplicate requests.
   */
  claim(key: string, operation: string, fingerprint: string): Promise<boolean>;
  /** Reads a key; null when it was never claimed. */
  find(key: string): Promise<IdempotencyRecord | null>;
  /** Stores the outcome of the operation that claimed the key. */
  complete(key: string, outcome: StoredOutcome): Promise<void>;
}

/** The repositories bound to one database transaction. */
export interface Transaction {
  readonly accounts: AccountRepository;
  readonly reservations: ReservationRepository;
  readonly ledger: LedgerRepository;
  readonly idempotency: IdempotencyRepository;
  /** Runs `work`; if it throws, undoes only what it wrote and rethrows. */
  savepoint<T>(work: () => Promise<T>): Promise<T>;
}

/** Opens transactions. Everything `work` does commits together or not at all. */
export interface TransactionRunner {
  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
}
