import { atom } from 'claude-code'
import type { AutoView, FoundView, RunView } from '../types'

export const runsAtom = atom({ plugin: 'web-research-saver', key: 'runs' } as const, [] as RunView[], { shape: 'runs-2' })

export const autoAtom = atom({ plugin: 'web-research-saver', key: 'auto' } as const, [] as AutoView[], { shape: 'auto-1' })

export const foundAtom = atom({ plugin: 'web-research-saver', key: 'found' } as const, null as FoundView | null, { shape: 'found-1' })

export const offAtom = atom({ plugin: 'web-research-saver', key: 'off' } as const, false)

export const routerAtom = atom({ plugin: 'web-research-saver', key: 'router' } as const, false)

export const busyAtom = atom({ plugin: 'web-research-saver', key: 'busy' } as const, 0)

export const openAtom = atom({ plugin: 'web-research-saver', key: 'open' } as const, [] as number[], { shape: 'open-1' })
