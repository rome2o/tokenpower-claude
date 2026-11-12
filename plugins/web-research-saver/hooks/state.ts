import type { Done, Kit } from './shapes.ts'
import type { TurnUsage } from 'claude-code'

// Module variables start over on a reload; the pane's values live in $.state.
// An import cannot be reassigned, so the values that change live as fields of one object.
export const S = {
  home: '',
  off: false,
  router: false,
  kit: null as Kit | null,
  // Set on the first "no tool named WebFetch": later pages go straight to a plain read.
  webFetchMissing: false,
  // The person closed the pane: auto mode stops opening it until /research-router asks.
  closed: false,
  // switches.json says "web-research-saver:hidden": the pane opens only when asked.
  switchHidden: false,
  switchError: '',
  routerKnown: false,
  session: '',
}
// Deep mode: a subagent's answer arrives as its own turn.complete, matched by agentId.
export const waiters = new Map<string, (d: Done) => void>()
// Answers that arrived before anyone waited (a fast subagent), and the ids this mod started.
export const answers = new Map<string, Done>()
export const owned = new Set<string>()
// Deep mode: the characters each subagent's tools handed it, and each of its requests' usage, by agentId.
export const agentChars = new Map<string, number>()
export const agentSteps = new Map<string, TurnUsage[]>()
