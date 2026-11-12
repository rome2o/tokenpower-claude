// A saved-output path comes out of tool-result text, so it is checked before anything is read from it. Genuine
// saved outputs live under <home>/.claude/projects/<project>/<session>/tool-results/.
export function isSafeSavedPath(p: string, home: string) {
  if (!home || !p.startsWith('/') || p.includes('\0')) return false
  if (p.split('/').includes('..')) return false
  return p.startsWith(`${home}/.claude/projects/`) && p.includes('/tool-results/')
}
