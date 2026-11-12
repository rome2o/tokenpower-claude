import type { Elements } from 'claude-code'

import type { Meter } from '../types'

import { buildBar, fillPercent, fitPieces } from './bar.ts'
import type { Piece } from './bar.ts'
import { BAD, BAD_AT, BAND, FILL_COLORS, GOOD, LEGEND_MAX, WARN, WARN_AT } from './constants.ts'
import { clip, costText, kTokens, levelOf, percentText, savedText } from './format.ts'

type Ui = Pick<Elements['terminal'], 'Box' | 'Text'>

// A piece with how it is drawn. `swatch` is a coloured square before the text.
type Run = Piece & { color?: string; swatch?: string; bold?: boolean }

const LEVEL_COLOR = { ok: GOOD, warn: WARN, bad: BAD } as const

function pieces(m: Meter): { legend: Run[]; compacts: Run; saved: Run; cost: Run } {
  const legend: Run[] = m.used.slice(0, LEGEND_MAX).map((c, i) => ({
    id: `legend-${i}`,
    text: `■ ${clip(c.name, /^[\x20-\x7e]*$/.test(c.name) ? 24 : 12)} ${kTokens(c.tokens)}`,
    keep: 4,
    swatch: FILL_COLORS[i % FILL_COLORS.length],
  }))
  const compacts: Run = {
    id: 'compacts',
    text: m.autoCompact === false ? 'auto-compact off' : m.threshold !== null ? `compacts at ${kTokens(m.threshold)}` : '',
    keep: 3,
  }
  const saved: Run = {
    id: 'saved',
    text: m.saved.kind === 'ok' ? `saved today ${savedText(m.saved.tokens)} tokens` : m.saved.kind === 'big' ? 'saved today: ledger too large to read' : '',
    keep: 2,
  }
  const c = costText(m.costUsd)
  const cost: Run = { id: 'cost', text: c ? `est. session cost ${c}` : '', keep: 1 }
  return { legend, compacts, saved, cost }
}

/** The band: a stacked bar and, when there are rows for it, a line of figures. One line when maxRows is 1. */
export function band(ui: Ui, m: Meter, columns: number, maxRows: number) {
  const { Box, Text } = ui
  const cols = Number.isFinite(columns) ? Math.max(10, Math.floor(columns)) : 80
  const fill = fillPercent(m)
  const level = levelOf(fill, WARN_AT, BAD_AT)
  const badge: Run = { id: 'badge', text: percentText(fill), keep: 9, color: LEVEL_COLOR[level], bold: true }
  const p = pieces(m)

  const draw = (xs: Run[]) =>
    xs.flatMap((r, i) => {
      const el = r.swatch ? (
        <Text key={r.id}>
          <Text color={r.swatch}>{'■'}</Text>
          <Text>{r.text.slice(1)}</Text>
        </Text>
      ) : (
        <Text key={r.id} color={r.color} bold={r.bold}>
          {r.text}
        </Text>
      )
      return i === 0 ? [el] : ['  ', el]
    })

  const bar = (width: number) =>
    buildBar(m, width).map((s, i) =>
      s.kind === 'used' ? (
        <Text key={`b${i}`} color={FILL_COLORS[s.index % FILL_COLORS.length]}>
          {'█'.repeat(s.cells)}
        </Text>
      ) : s.kind === 'buffer' ? (
        <Text key={`b${i}`} color={WARN} dimColor>
          {'▒'.repeat(s.cells)}
        </Text>
      ) : (
        <Text key={`b${i}`} dimColor>
          {'░'.repeat(s.cells)}
        </Text>
      ),
    )

  if (maxRows <= 1) {
    const barW = Math.min(16, Math.max(4, Math.floor(cols / 4)))
    const rest = fitPieces<Run>([badge, ...p.legend, p.compacts, p.saved, p.cost], cols - barW - 1)
    return (
      <Box key={BAND} flexDirection="column">
        <Text wrap="truncate-end">
          {bar(barW)}
          <Text> </Text>
          {draw(rest)}
        </Text>
      </Box>
    )
  }

  const prefix = cols >= 24 ? 'context ' : ''
  const barW = Math.max(1, Math.min(48, cols - prefix.length - 1 - badge.text.length))
  const rest = fitPieces<Run>([...p.legend, p.compacts, p.saved, p.cost], cols)
  return (
    <Box key={BAND} flexDirection="column">
      <Text wrap="truncate-end">
        <Text dimColor>{prefix}</Text>
        {bar(barW)}
        <Text> </Text>
        {draw([badge])}
      </Text>
      {rest.length ? <Text wrap="truncate-end">{draw(rest)}</Text> : null}
    </Box>
  )
}
