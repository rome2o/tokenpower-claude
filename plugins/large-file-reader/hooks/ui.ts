import type { Card } from '../types'
import { HAIKU, HAIKU_DARK } from './constants.ts'

// ============================================================================
// Pane
// ============================================================================

export const MASCOT_PX = 56

// The Haiku reader: a round teal reader with glasses and a sprout, holding a page. Smooth shapes, not pixel
// rects, so it never reads as Helper Desk's crab. It moves (eyes scan, page bobs, sprout sways) only while
// Haiku is working; at rest it stands still.
export function mascotSvg(working: boolean) {
  const motion = working
    ? `<style>
.eye{animation:scan 1.4s ease-in-out infinite}
.pg{animation:bob 1.4s ease-in-out infinite}
.sp{animation:sway 2.8s ease-in-out infinite;transform-origin:32px 12px}
.ln{animation:glow 1.4s ease-in-out infinite}.l2{animation-delay:-.45s}.l3{animation-delay:-.9s}
@keyframes scan{0%,100%{transform:translateX(-1.6px)}50%{transform:translateX(1.6px)}}
@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.4px)}}
@keyframes sway{0%,100%{transform:rotate(-8deg)}50%{transform:rotate(8deg)}}
@keyframes glow{0%,100%{opacity:.35}50%{opacity:.9}}
@media (prefers-reduced-motion: reduce){.eye,.pg,.sp,.ln{animation:none}}
</style>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${MASCOT_PX}" height="${MASCOT_PX}">${motion}
<g class="sp"><path d="M32 13 C31 9 28 6 24 6 C25 10 28 12 32 13 Z" fill="${HAIKU}"/><path d="M32 13 C33 8 37 5 41 6 C39 10 36 12 32 13 Z" fill="${HAIKU_DARK}"/><rect x="31.2" y="12" width="1.6" height="5" rx=".8" fill="${HAIKU_DARK}"/></g>
<ellipse cx="25" cy="58.5" rx="5" ry="2.6" fill="${HAIKU_DARK}"/><ellipse cx="39" cy="58.5" rx="5" ry="2.6" fill="${HAIKU_DARK}"/>
<circle cx="32" cy="35" r="20" fill="${HAIKU}"/>
<circle cx="24.5" cy="30" r="6.2" fill="#ffffff" stroke="${HAIKU_DARK}" stroke-width="2.2"/><circle cx="39.5" cy="30" r="6.2" fill="#ffffff" stroke="${HAIKU_DARK}" stroke-width="2.2"/>
<path d="M30.7 30 Q32 28.6 33.3 30" fill="none" stroke="${HAIKU_DARK}" stroke-width="2"/>
<g class="eye"><circle cx="24.5" cy="31" r="2.2" fill="#10302b"/><circle cx="39.5" cy="31" r="2.2" fill="#10302b"/></g>
<g class="pg"><rect x="17" y="40" width="30" height="17" rx="2.2" fill="#ffffff" stroke="${HAIKU_DARK}" stroke-width="1.6"/>
<rect class="ln" x="21" y="44" width="22" height="2" rx="1" fill="${HAIKU}" opacity=".6"/><rect class="ln l2" x="21" y="48" width="18" height="2" rx="1" fill="${HAIKU}" opacity=".6"/><rect class="ln l3" x="21" y="52" width="20" height="2" rx="1" fill="${HAIKU}" opacity=".6"/>
<circle cx="17.5" cy="48" r="3.2" fill="${HAIKU_DARK}"/><circle cx="46.5" cy="48" r="3.2" fill="${HAIKU_DARK}"/></g>
</svg>`
}

// Which tool the hand-off came from. Cards from before 2026-11-03 have no tool: Read or connector.
export const toolOf = (c: Card) => {
  const t = c.tool ?? (c.part === 'file' ? 'Read' : 'connector')
  return t === 'connector' ? 'Connector' : t
}
export const clockOf = (ms: number) => new Date(ms).toTimeString().slice(0, 5)
export const usdText = (usd: number | null) => (usd === null ? 'cost unknown' : `$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(3)}`)
export const fileUrl = (path: string) => `file://${encodeURI(path)}`
export const cutText = (text: string, n: number) => (text.length > n ? `${text.slice(0, Math.max(0, n - 1))}…` : text)
