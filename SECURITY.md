# Security

## Reporting a vulnerability

Use GitHub private vulnerability reporting on this repository (Security tab, Report a vulnerability). Please do not open a public issue for a security problem.

## Scope and known limits

- `web-research-saver` fetches URLs that appear in search results. It blocks non-http(s) schemes and local or private addresses. It does not follow redirect chains or resolve DNS itself, so a public URL that redirects to an internal address is not blocked.
- `large-file-reader` reads saved tool outputs only from `~/.claude/projects/<project>/<session>/tool-results/`. The check is on the path text, so a symlink placed inside that folder is not detected.
- Fetched web text is passed to Claude fenced and labelled as untrusted data. This lowers prompt-injection risk but does not remove it.
