import type { Ledger, Row } from '../types'

export type Scan = { requests: { ms: number; model: string }[]; compacts: number[] }

export type RowsOut = { kept: Row[]; skipped: number; dropped: number }
export type Parsed = Pick<Ledger, 'rows' | 'today' | 'chat' | 'all' | 'skipped' | 'dropped'>
/** A chat's scan, 'reading' while it is not read yet, 'no-chat' when it has no transcript. */
export type Found = Scan | 'reading' | 'no-chat'
