// Pure formatting. Nothing here imports the engine.

/** 842, 1.2k, 12.3k, 1.20M. */
export function fmtTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  const r = Math.round(n)
  if (r < 1000) return String(r)
  if (r < 999_950) return `${(r / 1000).toFixed(1)}k`
  return `${(r / 1_000_000).toFixed(2)}M`
}

/** 0.4%, 4.1%, 12%. */
export function fmtPct(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return '0%'
  return p < 9.95 ? `${p.toFixed(1)}%` : `${Math.round(p)}%`
}

/** A bar of `width` cells, `share` (0 to 1) filled. */
export function bar(share: number, width: number): string {
  const s = Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 0
  const filled = Math.round(s * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}
