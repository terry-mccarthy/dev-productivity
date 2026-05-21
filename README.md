# DevPulse

Developer flow productivity metrics dashboard. Connects GitHub and Jira to surface cycle times, throughput, review health, and team velocity — all stored locally in SQLite.

> **Status:** In progress

## What it does

- Pulls PR events from GitHub and ticket events from Jira into a local SQLite database
- Maps Jira users to GitHub logins for unified per-developer metrics
- Groups developers into teams for team-level rollups
- Dashboard with five views: Teams, Developers, GitHub, Jira, Review
- Adjustable time window: 7D / 30D / 90D / 6M / 1Y
- Sparklines and mini bar charts for trend visibility
- Incremental re-sync at any time via SSE streaming

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

## Required credentials

| Source | What you need |
|--------|--------------|
| GitHub | Personal Access Token with `repo` scope |
| Jira | API token, account email, Atlassian domain, project key |
