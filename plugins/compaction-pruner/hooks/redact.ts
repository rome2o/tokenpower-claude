// Pure: masks common secret shapes in text. Pattern based and best effort; it can miss unusual secrets.
// Every step is linear in the text length (no pattern can backtrack over the whole text from each start).

const MASK = '[masked]'
const PEM_SEARCH = 16_384
const PEM_UNFINISHED = 4096

// Private key blocks only. A whole block is masked; a cut-off one is masked for at most PEM_UNFINISHED
// characters. Certificates and public keys are kept as they are.
function maskPem(text: string): string {
  let out = ''
  let i = 0
  // The next END line at or after the scan point, found once and reused until the scan passes it.
  let nextEnd = -2
  for (;;) {
    const b = text.indexOf('-----BEGIN ', i)
    if (b < 0) break
    const label = /^[A-Z0-9 ]{1,40}-----/.exec(text.slice(b + 11, b + 11 + 60))
    if (!label || !label[0].includes('PRIVATE KEY')) {
      out += text.slice(i, b + 11)
      i = b + 11
      continue
    }
    const bodyAt = b + 11 + label[0].length
    if (nextEnd !== -1 && nextEnd < bodyAt) nextEnd = text.indexOf('-----END ', bodyAt)
    let stop = Math.min(text.length, bodyAt + PEM_UNFINISHED)
    if (nextEnd >= 0 && nextEnd - bodyAt <= PEM_SEARCH) {
      const close = text.slice(nextEnd + 9, nextEnd + 9 + 60).indexOf('-----')
      stop = close < 0 ? nextEnd + 9 : nextEnd + 9 + close + 5
    }
    out += `${text.slice(i, b)}${MASK}`
    i = stop
  }
  return out + text.slice(i)
}

const PATTERNS: RegExp[] = [
  /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}/g,
  /(?<![A-Za-z0-9])[spr]k_(?:live|test)_[A-Za-z0-9]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bglpat-[A-Za-z0-9_-]{16,}/g,
  /\bshp(?:at|ss|ca|pa)_[A-Za-z0-9]{16,}/g,
  /\bnpm_[A-Za-z0-9]{30,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\bya29\.[0-9A-Za-z_-]{20,}/g,
  /\bxox[abeprs]-[0-9A-Za-z-]{10,}/g,
  /\bxapp-[0-9A-Za-z-]{10,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
]
const BEARER = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{16,}/g
const BASIC = /\b(Authorization:[ \t]*Basic)[ \t]+[A-Za-z0-9+/=]{12,}/gi
const URL_USER = /:\/\/[^/\s:@]+:[^/\s@]+@/g
// NAME=value or NAME: value where the name holds a secret word. The value is masked to the end of the line.
const KEY_VALUE = /((?:PASSWORD|PASSWD|SECRET|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|TOKEN)[A-Za-z0-9_]{0,40}[ \t]{0,3}[=:][ \t]{0,3}["']?)[^\s"'][^\r\n]{5,}/gi

export function redact(text: string): string {
  let out = maskPem(text)
  for (const re of PATTERNS) out = out.replace(re, MASK)
  return out
    .replace(BEARER, `$1 ${MASK}`)
    .replace(BASIC, `$1 ${MASK}`)
    .replace(URL_USER, `://${MASK}@`)
    .replace(KEY_VALUE, `$1${MASK}`)
}
