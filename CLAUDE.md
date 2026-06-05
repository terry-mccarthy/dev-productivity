# DevPulse — CLAUDE.md

## Project overview

DevPulse is a local developer-productivity metrics dashboard. It fetches PR events from GitHub and ticket events from Jira, stores them in a local SQLite database, and serves a React dashboard at `http://localhost:3003`.

## Repo layout

```
server/
  index.js          # Express server — all API routes
  db.js             # SQL.js (WASM) database layer — schema, migrations, query helpers
  security.js       # Security scanner — secrets, git history, deps, supply chain, CVE
  github.js         # GitHub REST API fetcher
  jira.js           # Jira Cloud REST API fetcher
  tests/
    security.test.js  # Unit tests for security.js
    db.test.js        # Unit tests for db.js
    api.test.js       # Integration tests for all HTTP endpoints
index.html          # Single-page React app (no build step)
dev-productivity.jsx  # React component source
docker-compose.yml  # Production Docker config
```

## Running

```bash
cd server && npm install && npm start    # port 3003
cd server && npm run dev                 # watch mode
cd server && npm test                   # 90 tests, no extra deps
```

## Key architectural decisions

- **sql.js (WASM)** instead of better-sqlite3 — runs in the Docker container without native compilation. The entire DB is exported to disk (`devpulse.db`) on every write.
- **No build step** — the frontend is plain JSX loaded via a CDN Babel transform. No webpack/vite.
- **SSE streaming** for long operations (`/api/sync`, `/api/security/scan`, `/api/security/scan-all`).
- **Local-only security scanning** — no network calls from the Security tab.

## Database schema

`security_scans` stores one row per scan run per repo. The `findings` column is a JSON blob. `local_threat_intel` tracks how many packages matched the bundled threat-intel feeds.

Migrations are idempotent `ALTER TABLE ... ADD COLUMN` statements wrapped in try/catch at the bottom of the schema block in `db.js`.

## Security scanner

`security.js` exports:
- `findGitRepos(roots?)` — walks the filesystem to discover git repos
- `scanFileSecrets(path)` — regex scan of source files
- `scanGitHistory(path)` — `git log -p` over last 300 commits
- `scanDependencies(path)` — `npm audit` / `pip-audit`
- `scanBumblebee(path)` — external `bumblebee` CLI (optional, needs `BUMBLEBEE_THREAT_INTEL_PATH`)
- `scanLocalThreatIntel(path)` — checks installed packages against `server/threat-intel/*.json` feeds
- `scanOsv(path)` — `osv-scanner` against lockfiles (optional)
- `runFullScan(path, onProgress?)` — runs all of the above

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3003` | HTTP listen port |
| `DB_PATH` | `../devpulse.db` (relative to `server/`) | SQLite file location |
| `LOG_FILE` | `server/devpulse.log` | Log file path |
| `REPO_ROOTS` | (auto-detect) | Colon-separated roots for workspace discovery |
| `BUMBLEBEE_THREAT_INTEL_PATH` | (empty) | Path to bumblebee threat intel catalog |
| `THREAT_INTEL_DIR` | `server/threat-intel/` | Directory for local threat intel JSON feeds |

## Development conventions

- Tests use `node:test` and `node:assert/strict` — no Jest, no Mocha.
- Run `npm test` before marking any feature done.
- Each test cleans up its own temp directories with `rmSync`.
- Secrets in test files are constructed at runtime (not literal) to avoid triggering the scanner on this repo itself.
- Suppressions for scanner false positives go in `.devpulseignore` at the repo root.
