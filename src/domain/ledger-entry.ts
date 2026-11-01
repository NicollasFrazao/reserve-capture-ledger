/** Why a balance moved: a top-up, or the charge of a captured reservation. */
export type LedgerEntryKind = 'credit' | 'capture';

/** A balance movement about to be appended. Credits are positive, captures negative. */
export interface NewLedgerEntry {
  accountId: string;
  kind: LedgerEntryKind;
  amount: number;
  balanceAfter: number;
  reservationId: string | null;
}

/** A ledger entry as stored and returned to clients. */
export interface LedgerEntryView extends NewLedgerEntry {
  id: number;
  createdAt: string;
}
