// Pure text helpers.

/** 12345 becomes "12,345". */
export function fmt(n: number): string {
  const v = Number.isFinite(n) ? Math.round(n) : 0
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export function plural(n: number, one: string, many: string): string {
  return `${fmt(n)} ${n === 1 ? one : many}`
}
