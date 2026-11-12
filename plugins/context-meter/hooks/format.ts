// Pure formatting. No engine imports.

/** 950 is "950", 12345 is "12.3k", 250000 is "250k", 1234567 is "1.2M". */
export function kTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0'
  const v = Math.min(1e12, Math.round(n))
  if (v < 1000) return String(v)
  if (v < 100_000) return `${(Math.round(v / 100) / 10).toFixed(1).replace(/\.0$/, '')}k`
  if (v < 999_500) return `${Math.round(v / 1000)}k`
  return `${(Math.round(v / 100_000) / 10).toFixed(1).replace(/\.0$/, '')}M`
}

/** The cost as the engine reported it, to two decimals. Empty when it is absent or not a believable figure. */
export function costText(usd: unknown): string {
  if (typeof usd !== 'number' || !Number.isFinite(usd) || usd < 0 || usd > 1e9) return ''
  return `$${usd.toFixed(2)}`
}

/** Most tokens a saved figure may show before it reads "over 1B". */
export const SAVED_SHOW_MAX = 999_999_999

export function savedText(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) return '0'
  return tokens > SAVED_SHOW_MAX ? 'over 1B' : kTokens(tokens)
}

/** A percentage for display: whole number, held between 0 and 999. */
export function percentText(p: number): string {
  if (!Number.isFinite(p) || p < 0) return '0%'
  return `${Math.min(999, Math.round(p))}%`
}

/** Cut a string to n characters with an ellipsis. */
export function clip(s: string, n: number): string {
  const chars = Array.from(s)
  if (n <= 0) return ''
  return chars.length <= n ? s : `${chars.slice(0, Math.max(0, n - 1)).join('')}…`
}

/** Green below 70 percent, yellow to 90, red above. */
export function levelOf(p: number, warn: number, bad: number): 'ok' | 'warn' | 'bad' {
  if (!Number.isFinite(p)) return 'ok'
  return p > bad ? 'bad' : p >= warn ? 'warn' : 'ok'
}
