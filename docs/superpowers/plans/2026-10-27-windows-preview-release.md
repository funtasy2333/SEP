# Windows launcher and 0.1.0 Preview release

Goal: double-click startup/shutdown on Windows; official downloads first with mainland mirror fallback only in Windows; separate clean Windows/macOS release ZIPs.

Architecture: PowerShell 5.1 launcher with local portable Node/pnpm bootstrap, HTTPS download fallback, process ownership records and SQLite backup; preserve macOS launcher. A Python standard-library packager uses an explicit runtime allowlist, relocates the MCP authoring reference into runtime resources, excludes development documents, tests, machine data and dependencies. Tag v0.1.0-preview and publish a GitHub prerelease with two assets after verification.

- [x] Add Windows scripts and executable fallback tests (official success, failure→mirror, both fail, SHA mismatch).
- [x] Package runtime-only source ZIPs and verify extracted builds; preserve macOS executable bits.
- [ ] Run launcher tests, workspace build and relevant existing checks; review diff.
- [ ] Commit source, publish tag and release via GitHub Actions if the local release API is unavailable; verify both assets.

Review focus: paths containing spaces/Chinese, occupied ports, PID reuse, partial startup cleanup, clean install with native SQLite and browser dependencies, development documents excluded without breaking the MCP runtime reference.

Progress: current branch work is an isolated cloud checkout with no user edits. Updated to current main by fast-forward (three existing commits). GitHub CLI API access is unavailable through current cloud network policy; git remote works, so publication will use a tag-triggered GitHub workflow.

Verification: Windows PowerShell-compatible source loads in PS7; 8 network/version/ownership tests pass. Source and extracted-runtime builds pass; extracted backend API smoke passes. Full workspace tests running. Fresh review found Node ABI caching, wildcard ownership, and unsupported Node versions; all repaired with regressions. Native Windows/macOS smoke tests gate prerelease publication.
