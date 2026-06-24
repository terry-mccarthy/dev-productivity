import express from 'express';
import cors from 'cors';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { appendFileSync, writeFileSync, mkdirSync } from 'fs';
import { getConfig, setConfig, upsertPRs, upsertIssues, getMappings, saveMappings, queryMetrics, queryTrends, insertSecurityScan, getAllLatestScans, getLatestScan, getRepoScanHistory, getScansAtTime, getSecurityScanHistory } from './db.js';
import { fetchGitHubEvents } from './github.js';
import { fetchJiraEvents }   from './jira.js';
import { findGitRepos, repoMeta, scanFileSecrets, scanGitHistory, scanDependencies, scanBumblebee, scanLocalThreatIntel, scanOsv, runFullScan } from './security.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const app  = express();
const PORT = parseInt(process.env.PORT) || 3003;
const LOG_FILE = process.env.LOG_FILE || join(__dir, 'devpulse.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { appendFileSync(LOG_FILE, line); } catch {}
  console.log(msg);
}

app.use(cors());
app.use(express.json());
app.use(express.static(join(__dir, '..')));

function buildGhResponse(cfg) {
  return { org: cfg.gh_org || '', repo: cfg.gh_repo || '' };
}

function buildJiraResponse(cfg) {
  return { email: cfg.jira_email || '', domain: cfg.jira_domain || '', project: cfg.jira_project || '' };
}

function buildConfigResponse(cfg) {
  return {
    hasConfig: !!(cfg.gh_token && cfg.gh_org),
    gh:        buildGhResponse(cfg),
    jira:      buildJiraResponse(cfg),
    lastSynced: cfg.last_synced ? parseInt(cfg.last_synced) : null,
  };
}

function countSeverities(findings) {
  const sev = { critical: 0, high: 0, medium: 0 };
  for (const f of findings) {
    if (f.severity === 'critical') sev.critical++;
    else if (f.severity === 'high') sev.high++;
    else sev.medium++;
  }
  return sev;
}

function isJiraConfigured(cfg) {
  return !!(cfg.jira_token && cfg.jira_domain && cfg.jira_project);
}

function parseDays(body) {
  return parseInt(body?.days) || 180;
}

// ── GET /api/config ─────────────────────────────────────────────────────────
// Returns stored config with tokens redacted (just confirms what's saved)
app.get('/api/config', (req, res) => {
  res.json(buildConfigResponse(getConfig()));
});

// ── POST /api/config ────────────────────────────────────────────────────────
// Save connection details (tokens stored server-side only)
app.post('/api/config', (req, res) => {
  const { gh, jira } = req.body;
  if (!gh?.token || !gh?.org) {
    return res.status(400).json({ error: 'Missing required GitHub fields' });
  }
  setConfig({
    gh_token:      gh.token,
    gh_org:        gh.org,
    gh_repo:       gh.repo,
    jira_token:    jira?.token    || '',
    jira_email:    jira?.email    || '',
    jira_domain:   jira?.domain   || '',
    jira_project:  jira?.project  || '',
  });
  res.json({ ok: true });
});

// ── POST /api/sync ──────────────────────────────────────────────────────────
// Fetch fresh data from GitHub & Jira and upsert into SQLite.
// Accepts optional `{ days: 180 }` body to control backfill depth.
let syncInProgress = false;

async function runSyncStream(cfg, days, send) {
  const cutoff = new Date(Date.now() - days * 86400000);
  send({ stage: 'github', message: 'Fetching GitHub PRs…' });
  const prRows = await fetchGitHubEvents(cfg.gh_token, cfg.gh_org, cfg.gh_repo, cutoff);
  upsertPRs(prRows);
  send({ stage: 'github', message: `Stored ${prRows.length} PR events` });

  if (isJiraConfigured(cfg)) {
    send({ stage: 'jira', message: 'Fetching Jira issues…' });
    const issueRows = await fetchJiraEvents(cfg.jira_token, cfg.jira_email, cfg.jira_domain, cfg.jira_project, cutoff);
    upsertIssues(issueRows);
    send({ stage: 'jira', message: `Stored ${issueRows.length} issue events` });
  } else {
    send({ stage: 'jira', message: 'Jira not configured — skipping' });
  }

  setConfig({ last_synced: Date.now().toString() });
  send({ stage: 'done', message: 'Sync complete' });
}

app.post('/api/sync', async (req, res) => {
  if (syncInProgress) return res.status(409).json({ error: 'Sync already in progress' });

  const cfg = getConfig();
  if (!cfg.gh_token) return res.status(400).json({ error: 'Not configured — POST /api/config first' });

  syncInProgress = true;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  const send = (msg) => res.write(`data: ${JSON.stringify(msg)}\n\n`);

  try {
    await runSyncStream(cfg, parseDays(req.body), send);
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

app.get('/favicon.ico', (req, res) => res.status(204).end());

// ── GET /api/security/workspaces ────────────────────────────────────────────
// Auto-detect git repos from common locations on disk
app.get('/api/security/workspaces', (req, res) => {
  try {
    const paths = findGitRepos();
    const repos = paths.map(p => {
      const meta = repoMeta(p);
      const scan = getLatestScan(p);
      return { ...meta, security: scan ? { total: scan.total, critical: scan.critical, high: scan.high, medium: scan.medium } : null };
    });
    res.json({ repos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/security/scan ──────────────────────────────────────────────────
// Body: { path }  —  streams SSE findings for secrets, git history, and deps
app.post('/api/security/scan', (req, res) => {
  const { path: scanPath } = req.body;
  if (!scanPath) return res.status(400).json({ error: 'path required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  const send = (msg) => res.write(`data: ${JSON.stringify(msg)}\n\n`);

  try {
    send({ stage: 'secrets', message: 'Scanning source files for secrets…' });
    const secrets = scanFileSecrets(scanPath);
    send({ stage: 'secrets_done', count: secrets.length, findings: secrets });

    send({ stage: 'history', message: 'Scanning git history…' });
    const history = scanGitHistory(scanPath);
    send({ stage: 'history_done', count: history.length, findings: history });

    send({ stage: 'deps', message: 'Auditing dependencies…' });
    const deps = scanDependencies(scanPath);
    send({ stage: 'deps_done', count: deps.length, findings: deps });

    send({ stage: 'bumblebee', message: 'Scanning installed packages for supply chain threats…' });
    const { findings: bumblebeeFindings, pkgCount } = scanBumblebee(scanPath);
    send({ stage: 'bumblebee_done', count: bumblebeeFindings.length, pkgCount, findings: bumblebeeFindings });

    send({ stage: 'local_threat_intel', message: 'Checking packages against local threat intelligence…' });
    const localThreatFindings = scanLocalThreatIntel(scanPath);
    send({ stage: 'local_threat_intel_done', count: localThreatFindings.length, findings: localThreatFindings });

    send({ stage: 'osv', message: 'Scanning lockfile for CVEs…' });
    const { findings: osvFindings, scanned } = scanOsv(scanPath);
    send({ stage: 'osv_done', count: osvFindings.length, scanned, findings: osvFindings });

    const allFindings = [...secrets, ...history, ...deps, ...bumblebeeFindings, ...localThreatFindings, ...osvFindings];
    const sev = countSeverities(allFindings);
    insertSecurityScan({
      repo_path: scanPath,
      repo_name: basename(scanPath),
      scanned_at: Date.now(),
      total: allFindings.length,
      critical: sev.critical,
      high: sev.high,
      medium: sev.medium,
      secrets: secrets.length,
      history: history.length,
      deps: deps.length,
      bumblebee: bumblebeeFindings.length,
      local_threat_intel: localThreatFindings.length,
      osv: osvFindings.length,
      findings: allFindings,
    });

    send({ stage: 'done', message: 'Scan complete' });
    res.end();
  } catch (err) {
    send({ stage: 'error', message: err.message });
    res.end();
  }
});

// ── POST /api/security/scan-all ──────────────────────────────────────────────
// Scans all detected repos, stores results in DB, returns summary
async function runScanAllStream(send) {
  const paths = findGitRepos();
  const results = [];
  log(`Scan-all: found ${paths.length} repos`);
  const batchScannedAt = Date.now();
  for (let i = 0; i < paths.length; i++) {
    const name = basename(paths[i]);
    log(`Scan-all [${i + 1}/${paths.length}]: ${name} — secrets`);
    send({ stage: 'progress', current: i + 1, total: paths.length, repo: name, subStage: 'secrets' });
    const result = runFullScan(paths[i], (subStage) => {
      log(`Scan-all [${i + 1}/${paths.length}]: ${name} — ${subStage}`);
      send({ stage: 'progress', current: i + 1, total: paths.length, repo: name, subStage });
    });
    result.scanned_at = batchScannedAt;
    insertSecurityScan(result);
    results.push(result);
    log(`Scan-all [${i + 1}/${paths.length}]: ${name} — done (${result.total} findings, ${result.critical} critical, ${result.high} high)`);
  }
  send({ stage: 'done', count: results.length, results });
  log(`Scan-all: all ${paths.length} repos complete — ${results.reduce((s, r) => s + r.total, 0)} total findings`);
}

app.post('/api/security/scan-all', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  const send = (msg) => res.write(`data: ${JSON.stringify(msg)}\n\n`);
  try {
    await runScanAllStream(send);
    res.end();
  } catch (err) {
    log(`Scan-all ERROR: ${err.message}`);
    send({ stage: 'error', message: err.message });
    res.end();
  }
});

// ── GET /api/security/history ────────────────────────────────────────────────
// Returns latest per-repo summaries + trend data
app.get('/api/security/history', (req, res) => {
  try {
    const latest = getAllLatestScans();
    const trends = getSecurityScanHistory(30);
    const total = latest.reduce((a, r) => a + r.total, 0);
    const critical = latest.reduce((a, r) => a + r.critical, 0);
    const high = latest.reduce((a, r) => a + r.high, 0);
    const medium = latest.reduce((a, r) => a + r.medium, 0);
    res.json({ latest, trends, summary: { total, critical, high, medium, repos: latest.length } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/security/findings?repoPath=<path>[&severity=medium] ───────────
// Returns findings for the latest scan of a repo, optionally filtered by severity
app.get('/api/security/findings', (req, res) => {
  try {
    const repoPath = req.query.repoPath;
    if (!repoPath) return res.status(400).json({ error: 'repoPath query param required' });
    const severity = req.query.severity || null;
    const latest = getLatestScan(repoPath);
    if (!latest) return res.json({ findings: [] });
    const findings = Array.isArray(latest.findings) ? latest.findings : [];
    const filtered = severity ? findings.filter(f => f.severity === severity) : findings;
    res.json({ repoPath, findings: filtered });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/security/repo/:repoPath* ──────────────────────────────────────
// Returns latest scan + scan history for a specific repo
app.get('/api/security/repo/*', (req, res) => {
  try {
    const repoPath = decodeURIComponent(req.params[0]);
    const latest = getLatestScan(repoPath);
    const history = getRepoScanHistory(repoPath);
    res.json({ repoPath, latest, history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/security/update-threat-intel ───────────────────────────────────
// Downloads all JSON feeds from perplexityai/bumblebee/threat_intel and writes
// them to the local threat-intel directory so they're picked up on the next scan.
async function downloadThreatIntelFeeds(headers) {
  const GITHUB_API = 'https://api.github.com/repos/perplexityai/bumblebee/contents/threat_intel';
  const listRes = await fetch(GITHUB_API, { headers });
  if (!listRes.ok) throw Object.assign(new Error(`GitHub API ${listRes.status}: ${listRes.statusText}`), { status: 502 });

  const entries = await listRes.json();
  const jsonFiles = entries.filter(e => e.type === 'file' && e.name.endsWith('.json'));
  const threatIntelDir = process.env.THREAT_INTEL_DIR || join(__dir, 'threat-intel');
  mkdirSync(threatIntelDir, { recursive: true });

  const downloaded = [];
  for (const file of jsonFiles) {
    const contentRes = await fetch(file.download_url);
    if (!contentRes.ok) continue;
    writeFileSync(join(threatIntelDir, file.name), await contentRes.text(), 'utf8');
    downloaded.push(file.name);
  }
  return downloaded;
}

app.post('/api/security/update-threat-intel', async (req, res) => {
  const cfg = getConfig();
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'devpulse' };
  if (cfg.gh_token) headers['Authorization'] = `Bearer ${cfg.gh_token}`;

  try {
    const downloaded = await downloadThreatIntelFeeds(headers);
    log(`Threat intel updated: ${downloaded.length} feeds from perplexityai/bumblebee`);
    res.json({ updated: downloaded.length, files: downloaded });
  } catch (err) {
    log(`Threat intel update failed: ${err.message}`);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── GET /api/security/scans-at?scanned_at=<ms> ────────────────────────────
// Returns all repos scanned at a given timestamp
app.get('/api/security/scans-at', (req, res) => {
  try {
    const scannedAt = parseInt(req.query.scanned_at);
    if (isNaN(scannedAt)) return res.status(400).json({ error: 'scanned_at query param required' });
    const scans = getScansAtTime(scannedAt);
    res.json({ scannedAt, scans });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  app.listen(PORT, () => {
    log(`DevPulse server running at http://localhost:${PORT}`);
    log(`Database: devpulse.db`);
    log(`Log file: ${LOG_FILE}`);
    const cfg = getConfig();
    if (cfg.gh_org) {
      log(`Connected: ${cfg.gh_org}/${cfg.gh_repo} · ${cfg.jira_project}`);
      log(`Last synced: ${cfg.last_synced ? new Date(parseInt(cfg.last_synced)).toLocaleString() : 'never'}`);
    } else {
      log(`Not configured yet — open the app to connect`);
    }
  });
}

export default app;
