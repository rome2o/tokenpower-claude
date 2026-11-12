/** A short line under the list after a press: "Prompt Cache Timer is off in every chat." */
export type Note = string

declare module 'claude-code' {
  interface PluginState {
    'mods-manager': { note: Note }
  }
}
