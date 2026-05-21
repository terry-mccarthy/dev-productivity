import express from 'express';
import cors from 'cors';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getConfig, setConfig, upsertPRs, upsertIssues, getMappings, saveMappings, queryMetrics, queryTrends } from './db.js';
import { fetchGitHubEvents } from './github.js';
import { fetchJiraEvents }   from './jira.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const app  = express();
const PORT = 3002;

app.use(cors());
app.use(express.json());
app.use(express.static(join(__dir, '..')));

// ── GET /api/config ─────────────────────────────────────────────────────────
// Returns stored config with tokens redacted (just confirms what's saved)
app.get('/api/config', (req, res) => {
  const cfg = getConfig();
  const hasConfig = !!(cfg.gh_token && cfg.jira_token);
  res.json({
    hasConfig,
    gh:   { org: cfg.gh_org   || '', repo: cfg.gh_repo   || '' },
    jira: { email: cfg.jira_email || '', domain: cfg.jira_domain || '', project: cfg.jira_project || '' },
    lastSynced: cfg.last_synced ? parseInt(cfg.last_synced) : null,
  });
});

// ── POST /api/config ────────────────────────────────────────────────────────
// Save connection details (tokens stored server-side only)
app.post('/api/config', (req, res) => {
  const { gh, jira } = req.body;
  if (!gh?.token || !gh?.org || !gh?.repo || !jira?.token || !jira?.email || !jira?.domain || !jira?.project) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  setConfig({
    gh_token:      gh.token,
    gh_org:        gh.org,
    gh_repo:       gh.repo,
    jira_token:    jira.token,
    jira_email:    jira.email,
    jira_domain:   jira.domain,
    jira_project:  jira.project,
  });
  res.json({ ok: true });
});

// ── POST /api/sync ──────────────────────────────────────────────────────────
// Fetch fresh data from GitHub & Jira and upsert into SQLite.
// Accepts optional `{ days: 180 }` body to control backfill depth.
let syncInProgress = false;

app.post('/api/sync', async (req, res) => {
  if (syncInProgress) return res.status(409).json({ error: 'Sync already in progress' });

  const cfg = getConfig();
  if (!cfg.gh_token || !cfg.jira_token) {
    return res.status(400).json({ error: 'Not configured — POST /api/config first' });
  }

  const days = parseInt(req.body?.days) || 180;
  const cutoff = new Date(Date.now() - days * 86400000);
  syncInProgress = true;

  // Stream progress via SSE if client wants it, else just respond when done
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  const send = (msg) => res.write(`data: ${JSON.stringify(msg)}\n\n`);

  try {
    send({ stage: 'github', message: 'Fetching GitHub PRs…' });
    const prRows = await fetchGitHubEvents(cfg.gh_token, cfg.gh_org, cfg.gh_repo, cutoff);
    upsertPRs(prRows);
    send({ stage: 'github', message: `Stored ${prRows.length} PR events` });

    send({ stage: 'jira', message: 'Fetching Jira issues…' });
    const issueRows = await fetchJiraEvents(cfg.jira_token, cfg.jira_email, cfg.jira_domain, cfg.jira_project, cutoff);
    upsertIssues(issueRows);
    send({ stage: 'jira', message: `Stored ${issueRows.length} issue events` });

    setConfig({ last_synced: Date.now().toString() });
    send({ stage: 'done', message: 'Sync complete' });
    res.end();
  } catch (err) {
    console.error('[sync] Error:', err);
    send({ stage: 'error', message: err.message });
    res.end();
  } finally {
    syncInProgress = false;
  }
});

// ── GET /api/sync/status ────────────────────────────────────────────────────
app.get('/api/sync/status', (req, res) => {
  const cfg = getConfig();
  res.json({ inProgress: syncInProgress, lastSynced: cfg.last_synced ? parseInt(cfg.last_synced) : null });
});

// ── GET /api/metrics ────────────────────────────────────────────────────────
// ?from=<ms>&to=<ms>
app.get('/api/metrics', (req, res) => {
  const cfg    = getConfig();
  if (!cfg.gh_org) return res.status(400).json({ error: 'Not configured' });

  const to   = parseInt(req.query.to)   || Date.now();
  const from = parseInt(req.query.from) || to - 90 * 86400000;

  try {
    const result = queryMetrics(cfg.gh_org, cfg.gh_repo, cfg.jira_project, from, to);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/trends ─────────────────────────────────────────────────────────
// ?grain=week|day&periods=26
app.get('/api/trends', (req, res) => {
  const cfg = getConfig();
  if (!cfg.gh_org) return res.status(400).json({ error: 'Not configured' });

  const grain   = req.query.grain   || 'week';
  const periods = Math.min(parseInt(req.query.periods) || 26, 104);

  try {
    const data = queryTrends(cfg.gh_org, cfg.gh_repo, cfg.jira_project, grain, periods);
    res.json({ grain, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/mappings ───────────────────────────────────────────────────────
app.get('/api/mappings', (req, res) => {
  res.json(getMappings());
});

// ── POST /api/mappings ──────────────────────────────────────────────────────
app.post('/api/mappings', (req, res) => {
  try {
    saveMappings(req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/users ──────────────────────────────────────────────────────────
// Returns distinct GitHub authors and Jira assignees from stored events
app.get('/api/users', async (req, res) => {
  const cfg = getConfig();
  if (!cfg.gh_org) return res.status(400).json({ error: 'Not configured' });

  const { default: db } = await import('./db.js').catch(() => ({ default: null }));
  res.json({ error: 'Use /api/mappings to retrieve user data' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 DevPulse server running at http://localhost:${PORT}`);
  console.log(`   Database: devpulse.db`);
  const cfg = getConfig();
  if (cfg.gh_org) {
    console.log(`   Connected: ${cfg.gh_org}/${cfg.gh_repo} · ${cfg.jira_project}`);
    console.log(`   Last synced: ${cfg.last_synced ? new Date(parseInt(cfg.last_synced)).toLocaleString() : 'never'}`);
  } else {
    console.log(`   Not configured yet — open the app to connect\n`);
  }
});
