import type { Account } from '../domain/account.js';
import type { LedgerEntryView, NewLedgerEntry } from '../domain/ledger-entry.js';
import type { Reservation } from '../domain/reservation.js';
import type { StoredOutcome } from './idempotency.js';

export interface AccountRepository {
  find(id: string): Promise<Account | null>;
  /** Reads the account and locks its row until the transaction ends. */
  lock(id: string): Promise<Account | null>;
  /** Creates the account with a zero balance if it does not exist yet. */
  ensureExists(id: string): Promise<void>;
  save(account: Account): Promise<void>;
}

export interface ReservationRepository {
  find(id: string): Promise<Reservation | null>;
  lock(id: string): Promise<Reservation | null>;
  insert(reservation: Reservation): Promise<void>;
  save(reservation: Reservation): Promise<void>;
  findDueIds(now: Date, limit: number): Promise<string[]>;
}

export interface LedgerRepository {
  append(entry: NewLedgerEntry): Promise<LedgerEntryView>;
}

export interface IdempotencyRecord {
  operation: string;
  fingerprint: string;
  outcome: StoredOutcome | null;
}

export interface IdempotencyRepository {
  /**
   * Inserts the key. Returns false if it already exists. A concurrent
   * transaction holding the same uncommitted key makes this call wait for
   * it to finish, which is what serializes duplicate requests.
   */
  claim(key: string, operation: string, fingerprint: string): Promise<boolean>;
  find(key: string): Promise<IdempotencyRecord | null>;
  complete(key: string, outcome: StoredOutcome): Promise<void>;
}

export interface Transaction {
  readonly accounts: AccountRepository;
  readonly reservations: ReservationRepository;
  readonly ledger: LedgerRepository;
  readonly idempotency: IdempotencyRepository;
  /** Runs `work`; if it throws, undoes only what it wrote and rethrows. */
  savepoint<T>(work: () => Promise<T>): Promise<T>;
}

export interface TransactionRunner {
  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
}
