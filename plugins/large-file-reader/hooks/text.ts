export function tokens(text: string) {
  return Math.ceil(text.length / 4)
}

export function fmt(n: number) {
  return n.toLocaleString('en-US')
}

export function baseName(path: string) {
  return path.split('/').pop() ?? path
}

export function extOf(path: string) {
  const base = baseName(path)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

export function slug(path: string) {
  return baseName(path).replace(/[^\w.-]+/g, '_')
}

export function safe(name: string) {
  return name.replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 60)
}

export function hash(text: string) {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0
  return h.toString(36)
}

export function stamp(ms: number) {
  return new Date(ms).toISOString().slice(0, 19).replace('T', '-').replace(/:/g, '')
}

// Helper text reaches the transcript: no em or en dashes.
export function clean(text: string) {
  return text.replace(/\s*[\u2014\u2013]\s*/g, ' - ').trim()
}
