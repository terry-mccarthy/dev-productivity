# DevPulse — Architecture

## Overview

DevPulse is a local developer-productivity metrics dashboard. It pulls PR events from GitHub and ticket events from Jira Cloud, stores them in a local SQLite database, and serves a React dashboard at `http://localhost:3003`. It also includes a local security scanner that audits git repos on the host filesystem for secrets, dependency CVEs, and supply-chain threats — without sending any findings to a remote service.

---

## System diagram

```
Browser (localhost:3003)
        │
        │  HTTP / SSE
        ▼
┌──────────────────────────────────────────────────┐
│  Express server  (server/index.js)               │
│                                                  │
│  /api/config          ──► db.js (config table)   │
│  /api/sync            ──► github.js, jira.js     │
│  /api/metrics         ──► db.js (SQL aggs)       │
│  /api/trends          ──► db.js (SQL aggs)       │
│  /api/mappings        ──► db.js (user_mappings)  │
│  /api/security/*      ──► security.js            │
│                                                  │
│  static /             ──► index.html + JSX       │
└──────────────────────────────────────────────────┘
        │                          │
        │ REST                     │ REST
        ▼                          ▼
  GitHub API               Jira Cloud API
  (github.js)              (jira.js)

        │ filesystem
        ▼
  Local git repos
  (security.js)

        │ R/W
        ▼
  devpulse.db  (sql.js WASM — exported to disk on every write)
```

---

## Module responsibilities

| File | Responsibility |
|------|---------------|
| `server/index.js` | Express app; all API route handlers; SSE streaming for long ops |
| `server/db.js` | sql.js WASM database; schema DDL; idempotent migrations; query helpers |
| `server/github.js` | GitHub REST API fetcher — paginated PRs + per-PR review times |
| `server/jira.js` | Jira Cloud REST API fetcher — paginated JQL issue search |
| `server/security.js` | Local security scanner — 6 sub-scanners, repo discovery, `.devpulseignore` |
| `index.html` | Single-page entry point — loads JSX via CDN Babel transform |
| `dev-productivity.jsx` | React app source (no build step) |
| `server/threat-intel/*.json` | Bundled supply-chain threat intelligence feeds |

---

## Data flows

### Sync (GitHub + Jira)

```
POST /api/sync  →  SSE stream to browser
  │
  ├─ fetchGitHubEvents(token, org, repo, cutoff)
  │    ├─ paginate /repos/{org}/{repo}/pulls?state=closed (100/page)
  │    └─ enrich each PR with first-review time (batches of 10)
  │         └─ upsertPRs()  →  save()  →  devpulse.db
  │
  └─ fetchJiraEvents(token, email, domain, project, cutoff)
       ├─ JQL: project = X AND updated >= -Nd
       └─ paginate /rest/api/3/search (100/page)
            └─ upsertIssues()  →  save()  →  devpulse.db
```

`sync` is guarded by a boolean mutex (`syncInProgress`) to prevent concurrent runs.

### Metrics query

```
GET /api/metrics?from=<ms>&to=<ms>
  │
  ├─ queryGitHubMetrics() — COUNT/AVG on pr_events in window
  │    ├─ totalMerged, avgCycleTime, avgReviewTime, mergeRate
  │    ├─ per-author breakdown
  │    └─ weekly bucket array (up to 8 buckets)
  │
  └─ queryJiraMetrics() — COUNT/AVG on jira_issues in window
       ├─ done/inProgress/total, throughput, avgCycleTime
       ├─ per-assignee breakdown
       └─ weekly bucket array
```

### Security scan (single repo)

```
POST /api/security/scan { path }  →  SSE stream
  │
  ├─ scanFileSecrets()      — walk source files, apply 9 regex patterns
  ├─ scanGitHistory()       — git log -p -n 300, same patterns on diff lines
  ├─ scanDependencies()     — npm audit --json / pip-audit --format json
  ├─ scanBumblebee()        — bumblebee CLI (optional, needs BUMBLEBEE_THREAT_INTEL_PATH)
  ├─ scanLocalThreatIntel() — check node_modules/venv against local JSON feeds
  └─ scanOsv()              — osv-scanner --lockfile (optional)
       │
       └─ insertSecurityScan()  →  save()  →  devpulse.db
```

### Bulk scan

```
POST /api/security/scan-all  →  SSE stream
  │
  └─ findGitRepos()  — walk filesystem from REPO_ROOTS (or defaults), max 150 repos
       └─ for each repo: runFullScan() → insertSecurityScan()
```

---

## Database schema

```sql
config          (key TEXT PK, value TEXT)
pr_events       (id TEXT PK, org, repo, author,
                 created_at, merged_at, cycle_time_days, review_time_days, synced_at)
jira_issues     (id TEXT PK, project, assignee_id, assignee_name,
                 created_at, resolved_at, cycle_time_days, status, synced_at)
user_mappings   (jira_id TEXT PK, gh_login, display_name)
teams           (id TEXT PK, name, color)
team_members    (team_id, jira_id — composite PK)
security_scans  (id AUTOINCREMENT, repo_path, repo_name, scanned_at,
                 total, critical, high, medium,
                 secrets, history, deps, bumblebee, local_threat_intel, osv,
                 findings TEXT — JSON blob)
```

Indexes on `security_scans(scanned_at)` and `(repo_path, scanned_at)` support the "latest scan per repo" and "history for one repo" query patterns.

Migrations are idempotent `ALTER TABLE … ADD COLUMN` statements in a `try/catch` block that runs on every startup.

---

## Key architectural decisions

### sql.js (WASM) instead of better-sqlite3
sql.js runs entirely in process without native compilation, which makes it work inside the Docker container without a build environment. The tradeoff is that the entire database is held in memory and exported to disk (`devpulse.db`) on every write. This is acceptable at dashboard scale but would not suit high write-throughput workloads.

### No build step for the frontend
`index.html` loads React and Babel from CDN and applies a Babel transform at page load. This keeps the repo simple (no webpack/vite/bundler config) at the cost of a slower first paint and no tree-shaking. Suitable for a local-only developer tool.

### SSE for long-running operations
`/api/sync`, `/api/security/scan`, and `/api/security/scan-all` all stream Server-Sent Events so the browser sees progress in real time. The alternative (polling a job status endpoint) would require storing job state server-side and is more complex.

### Local-only security scanning
The scanner reads local files and runs local CLI tools. No findings are ever sent to a remote service. The only outbound call in the security module is `POST /api/security/update-threat-intel`, which downloads feed JSON from GitHub and writes it to `server/threat-intel/`.

### Optional external tools
`bumblebee` and `osv-scanner` are treated as optional. If the binary is absent the scanner returns empty findings for that sub-scanner and continues. This keeps the core scanner working without any extra installation.

---

## Security scanner sub-scanners

| Sub-scanner | Checks | External dependency |
|-------------|--------|---------------------|
| `scanFileSecrets` | 9 regex patterns (AWS keys, GitHub tokens, private keys, Stripe, Slack, Google API, generic password/secret/api_key) against source files ≤ 512 KB | None |
| `scanGitHistory` | Same 9 patterns on added lines in the last 300 commits via `git log -p` | `git` (always present) |
| `scanDependencies` | npm/pip CVEs | `npm audit`, `pip-audit` |
| `scanBumblebee` | Installed packages vs external threat catalog | `bumblebee` CLI + `BUMBLEBEE_THREAT_INTEL_PATH` env |
| `scanLocalThreatIntel` | node_modules + venv packages vs local JSON feeds in `server/threat-intel/` | None |
| `scanOsv` | Lockfiles (`uv.lock`, `package-lock.json`) via osv-scanner | `osv-scanner` CLI |

False-positive suppressions are declared in `.devpulseignore` at the repo root (one relative path or prefix per line).

---

## Threat intelligence feeds

`server/threat-intel/*.json` holds supply-chain threat feeds. Each feed has an `entries` array; each entry carries `id`, `package`, `ecosystem` (`npm` or `pypi`), `versions[]`, `severity`, and `name`.

Feeds are updated on demand via `POST /api/security/update-threat-intel`, which downloads every `.json` file from the `perplexityai/bumblebee/threat_intel` directory on GitHub using the configured GitHub token (or anonymously).

In Docker the `threat-intel` directory is mounted read-only into the container; the update endpoint writes to the host path via the volume.

---

## Deployment

### Docker Compose (production)

```
devpulse container
  port 3003 → host 3003
  ./devpulse.db → /data/devpulse.db   (read/write volume)
  ./server/threat-intel → /app/server/threat-intel  (read-only volume)
  DB_PATH=/data/devpulse.db
  THREAT_INTEL_DIR=/app/server/threat-intel
```

### Local dev

```bash
cd server && npm install && npm start      # port 3003
cd server && npm run dev                   # watch mode
```

---

## Testing

Tests use Node's built-in `node:test` + `node:assert/strict` — no Jest, no Mocha, no extra runtime dependencies.

| File | Scope |
|------|-------|
| `server/tests/security.test.js` | Unit — scanner functions, `findGitRepos`, ignore patterns |
| `server/tests/db.test.js` | Unit — schema, config, upserts, metrics queries |
| `server/tests/api.test.js` | Integration — all HTTP endpoints against a real in-memory DB |

Secrets in test files are constructed at runtime (concatenated strings) to avoid triggering the scanner on this repo. Each test cleans up its own temp directories with `rmSync`.

Run all 90 tests: `cd server && npm test`
