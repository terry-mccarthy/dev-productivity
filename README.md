# DevPulse

Developer flow productivity metrics dashboard. Connects GitHub and Jira to surface cycle times, throughput, review health, and team velocity — all stored locally in SQLite.

> **Status:** In progress

## What it does

- Pulls PR events from GitHub and ticket events from Jira into a local SQLite database
- Maps Jira users to GitHub logins for unified per-developer metrics
- Groups developers into teams for team-level rollups
- Dashboard with six views: Teams, Developers, GitHub, Jira, Review, Security
- Adjustable time window: 7D / 30D / 90D / 6M / 1Y
- Sparklines and mini bar charts for trend visibility
- Incremental re-sync at any time via SSE streaming
- Security scanner for local workspaces — secrets, git history, and dependency audits

## Stack

- **Frontend:** React (JSX, no build step), dark monospace UI
- **Backend:** Node.js + Express on port 3002
- **Database:** SQLite via `sql.js` (WebAssembly, file-persisted as `devpulse.db`)
- **Data sources:** GitHub REST API, Jira Cloud REST API

## Setup

```bash
cd server
npm install
npm start        # or: npm run dev  (watch mode)
```

Then open `http://localhost:3002` in your browser.

## First-run flow

1. **Connect** — Enter GitHub (PAT + org + repo) and Jira (API token + email + domain + project key) credentials. Credentials are stored server-side only in SQLite and never sent to the browser.
2. **Initial sync** — Backfills up to 180 days of PR and ticket history. Progress streams via SSE.
3. **Map users** — Link Jira assignees to GitHub logins, then define teams.
4. **Dashboard** — Explore metrics across the five tabs.

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/config` | Returns saved config (tokens redacted) |
| `POST` | `/api/config` | Save GitHub + Jira credentials |
| `POST` | `/api/sync` | Fetch fresh data; streams progress as SSE |
| `GET` | `/api/sync/status` | Check if sync is in progress |
| `GET` | `/api/metrics` | Aggregate metrics (`?from=<ms>&to=<ms>`) |
| `GET` | `/api/trends` | Trend buckets (`?grain=week\|day&periods=26`) |
| `GET/POST` | `/api/mappings` | User↔team mappings |
| `GET` | `/api/security/workspaces` | Auto-detect git repos from common disk locations |
| `POST` | `/api/security/scan` | Scan a workspace; streams findings as SSE |

## Metrics tracked

**GitHub**
- PR cycle time (open → merged)
- Time to first review (open → first review)
- Review lag (first review → merge)
- Merge rate (PRs/week)
- Per-author breakdown

**Jira**
- Ticket throughput (issues/week)
- Cycle time (created → resolved)
- In-progress count
- Per-assignee breakdown

## Security tab

The Security tab scans local git repositories without making any network calls.

**Auto-detects repos** from `~`, `~/projects`, `~/dev`, `~/work`, `~/code`, `~/src`, `~/repos`, and `~/Documents` (up to 3 levels deep, capped at 150 repos).

**Three scan types per repo:**

| Scan | What it checks |
|------|---------------|
| Source file secrets | Walks all `.js/.ts/.py/.go/.env/` etc. files; matches 9 secret patterns |
| Git history | `git log -p` over the last 300 commits; catches secrets committed then removed |
| Dependency audit | `npm audit` (if `package.json` present), `pip-audit` (if `requirements.txt` present); skips `low` severity |

**Detected secret types:** AWS Access Key IDs, GitHub tokens, RSA/EC/OPENSSH private keys, Stripe secret keys, Slack tokens, Google API keys, generic passwords/secrets/API key assignments.

All matched values are **redacted** in the UI — only the first 3 and last 2 characters are shown.

## Tests

```bash
cd server
npm test          # runs security.test.js with node:test (no extra deps)
```

44 unit tests cover:
- Pattern true-positive and false-positive cases for all 9 secret rules
- `scanFileSecrets`: clean dirs, per-rule detection, `.env` variants, `node_modules` skip, redaction, line numbers, nested dirs
- `scanGitHistory`: empty repo, secret committed-then-removed, current commit, delete-only commits, redaction
- `scanDependencies`: no manifest, empty package.json, finding shape contract
- `findGitRepos`: custom roots, `node_modules` exclusion, nested repos, stop-at-repo behaviour

## Required credentials

| Source | What you need |
|--------|--------------|
| GitHub | Personal Access Token with `repo` scope |
| Jira | API token, account email, Atlassian domain, project key |
