import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dir, '..', 'devpulse.db');

// Initialize WebAssembly SQL.js
const SQL = await initSqlJs();
let db;

if (existsSync(dbPath)) {
  const fileBuffer = readFileSync(dbPath);
  db = new SQL.Database(fileBuffer);
} else {
  db = new SQL.Database();
}

// Auto-save function on updates
function save() {
  const data = db.export();
  const buffer = Buffer.from(data);
  writeFileSync(dbPath, buffer);
}

// ── Migrations ─────────────────────────────────────────────────────────────
db.run(`
  CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS pr_events (
    id               TEXT PRIMARY KEY,
    org              TEXT NOT NULL,
    repo             TEXT NOT NULL,
    author           TEXT,
    created_at       INTEGER,
    merged_at        INTEGER,
    cycle_time_days  REAL,
    review_time_days REAL,
    synced_at        INTEGER
  );

  CREATE TABLE IF NOT EXISTS jira_issues (
    id               TEXT PRIMARY KEY,
    project          TEXT NOT NULL,
    assignee_id      TEXT,
    assignee_name    TEXT,
    created_at       INTEGER,
    resolved_at      INTEGER,
    cycle_time_days  REAL,
    status           TEXT,
    synced_at        INTEGER
  );

  CREATE TABLE IF NOT EXISTS user_mappings (
    jira_id      TEXT PRIMARY KEY,
    gh_login     TEXT,
    display_name TEXT
  );

  CREATE TABLE IF NOT EXISTS teams (
    id    TEXT PRIMARY KEY,
    name  TEXT NOT NULL,
    color TEXT
  );

  CREATE TABLE IF NOT EXISTS team_members (
    team_id  TEXT NOT NULL,
    jira_id  TEXT NOT NULL,
    PRIMARY KEY (team_id, jira_id)
  );
`);
save();

// Helper to convert SQL.js result array of objects to readable object arrays
function execAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function execGet(sql, params = []) {
  const rows = execAll(sql, params);
  return rows[0] || null;
}

// ── Config helpers ──────────────────────────────────────────────────────────
export function getConfig() {
  const rows = execAll('SELECT key, value FROM config');
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

export function setConfig(obj) {
  const stmt = db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(obj)) {
    stmt.run([k, v]);
  }
  stmt.free();
  save();
}

// ── PR helpers ──────────────────────────────────────────────────────────────
export function upsertPRs(rows) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO pr_events
      (id, org, repo, author, created_at, merged_at, cycle_time_days, review_time_days, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const r of rows) {
    stmt.run([r.id, r.org, r.repo, r.author, r.created_at, r.merged_at, r.cycle_time_days, r.review_time_days, r.synced_at]);
  }
  stmt.free();
  save();
}

// ── Jira helpers ────────────────────────────────────────────────────────────
export function upsertIssues(rows) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO jira_issues
      (id, project, assignee_id, assignee_name, created_at, resolved_at, cycle_time_days, status, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const r of rows) {
    stmt.run([r.id, r.project, r.assignee_id, r.assignee_name, r.created_at, r.resolved_at, r.cycle_time_days, r.status, r.synced_at]);
  }
  stmt.free();
  save();
}

// ── Mapping helpers ─────────────────────────────────────────────────────────
export function getMappings() {
  const mappings = execAll('SELECT jira_id, gh_login, display_name FROM user_mappings');
  const teams = execAll('SELECT * FROM teams').map(t => {
    const memberJiraIds = execAll('SELECT jira_id FROM team_members WHERE team_id=?', [t.id]).map(r => r.jira_id);
    return { ...t, memberJiraIds };
  });
  return { mappings, teams };
}

export function saveMappings({ mappings, teams }) {
  db.run('DELETE FROM user_mappings');
  db.run('DELETE FROM teams');
  db.run('DELETE FROM team_members');

  const insMap = db.prepare('INSERT INTO user_mappings VALUES (?, ?, ?)');
  for (const m of mappings) {
    insMap.run([m.jira_id, m.gh_login, m.display_name]);
  }
  insMap.free();

  const insTeam = db.prepare('INSERT INTO teams VALUES (?, ?, ?)');
  const insMem  = db.prepare('INSERT INTO team_members VALUES (?, ?)');
  for (const t of teams) {
    insTeam.run([t.id, t.name, t.color]);
    for (const jid of (t.memberJiraIds || [])) {
      insMem.run([t.id, jid]);
    }
  }
  insTeam.free();
  insMem.free();
  save();
}

// ── Metrics query ───────────────────────────────────────────────────────────
export function queryMetrics(org, repo, project, fromMs, toMs) {
  const daysInPeriod = (toMs - fromMs) / 86400000;

  // GitHub aggregate
  const ghAgg = execGet(`
    SELECT COUNT(*) as total, AVG(cycle_time_days) as avgCycle, AVG(review_time_days) as avgReview
    FROM pr_events WHERE org=? AND repo=? AND merged_at BETWEEN ? AND ?
  `, [org, repo, fromMs, toMs]);

  // GitHub by author
  const ghAuthors = execAll(`
    SELECT author, COUNT(*) as prs, SUM(cycle_time_days) as totalCycle
    FROM pr_events WHERE org=? AND repo=? AND merged_at BETWEEN ? AND ?
    GROUP BY author ORDER BY prs DESC
  `, [org, repo, fromMs, toMs]);

  // GitHub weekly buckets (up to 8)
  const numWeeks = Math.min(8, Math.ceil(daysInPeriod / 7));
  const ghWeeks = Array.from({ length: numWeeks }, (_, i) => {
    const end   = toMs - i * 7 * 86400000;
    const start = end - 7 * 86400000;
    const n = execGet(`SELECT COUNT(*) as n FROM pr_events WHERE org=? AND repo=? AND merged_at BETWEEN ? AND ?`, [org, repo, start, end]).n;
    return { label: `W-${i + 1}`, count: n };
  }).reverse();

  // Jira aggregate
  const DONE_STATUSES = ['Done', 'Closed', 'Resolved'];
  const placeholders = DONE_STATUSES.map(() => '?').join(',');
  
  const jiAgg = execGet(`
    SELECT COUNT(*) as done, AVG(cycle_time_days) as avgCycle
    FROM jira_issues WHERE project=? AND status IN (${placeholders}) AND resolved_at BETWEEN ? AND ?
  `, [project, ...DONE_STATUSES, fromMs, toMs]);

  const jiInProgress = execGet(`
    SELECT COUNT(*) as n FROM jira_issues WHERE project=? AND status IN ('In Progress','In Review')
  `, [project]).n;

  const jiTotal = execGet(`SELECT COUNT(*) as n FROM jira_issues WHERE project=?`, [project]).n;

  // Jira by assignee
  const jiAssignees = execAll(`
    SELECT assignee_id, assignee_name,
           COUNT(*) as done,
           SUM(cycle_time_days) as totalCycle
    FROM jira_issues WHERE project=? AND status IN (${placeholders}) AND resolved_at BETWEEN ? AND ?
    GROUP BY assignee_id ORDER BY done DESC
  `, [project, ...DONE_STATUSES, fromMs, toMs]);

  // All jira assignees (for totals)
  const jiAllAssignees = execAll(`
    SELECT assignee_id, assignee_name, COUNT(*) as total
    FROM jira_issues WHERE project=? GROUP BY assignee_id
  `, [project]);

  const assigneeMap = {};
  jiAllAssignees.forEach(a => {
    assigneeMap[a.assignee_id] = { name: a.assignee_name, total: a.total, done: 0, totalCycle: 0 };
  });
  jiAssignees.forEach(a => {
    if (assigneeMap[a.assignee_id]) {
      assigneeMap[a.assignee_id].done = a.done;
      assigneeMap[a.assignee_id].totalCycle = a.totalCycle || 0;
    }
  });

  const jiWeeks = Array.from({ length: numWeeks }, (_, i) => {
    const end   = toMs - i * 7 * 86400000;
    const start = end - 7 * 86400000;
    const n = execGet(`SELECT COUNT(*) as n FROM jira_issues WHERE project=? AND status IN (${placeholders}) AND resolved_at BETWEEN ? AND ?`, [project, ...DONE_STATUSES, start, end]).n;
    return { label: `W-${i + 1}`, count: n };
  }).reverse();

  const authorMap = {};
  ghAuthors.forEach(a => {
    authorMap[a.author] = { prs: a.prs, totalCycle: a.totalCycle || 0 };
  });

  return {
    github: {
      totalMerged: ghAgg.total || 0,
      avgCycleTime: ghAgg.avgCycle || 0,
      avgReviewTime: ghAgg.avgReview || 0,
      mergeRate: ( (ghAgg.total || 0) / (daysInPeriod / 7) ).toFixed(1),
      authorMap,
      weeks: ghWeeks,
    },
    jira: {
      total: jiTotal || 0,
      done: jiAgg.done || 0,
      inProgress: jiInProgress || 0,
      throughput: ( (jiAgg.done || 0) / (daysInPeriod / 7) ).toFixed(1),
      avgCycleTime: jiAgg.avgCycle || 0,
      assigneeMap,
      weeks: jiWeeks,
    }
  };
}

// ── Trends query ────────────────────────────────────────────────────────────
export function queryTrends(org, repo, project, grain, periods) {
  const periodMs = grain === 'day' ? 86400000 : 7 * 86400000;
  const now = Date.now();
  const DONE = ['Done', 'Closed', 'Resolved'];
  const ph   = DONE.map(() => '?').join(',');

  return Array.from({ length: periods }, (_, i) => {
    const end   = now - i * periodMs;
    const start = end - periodMs;

    const gh = execGet(`
      SELECT COUNT(*) as merged, AVG(cycle_time_days) as avgCycle, AVG(review_time_days) as avgReview
      FROM pr_events WHERE org=? AND repo=? AND merged_at BETWEEN ? AND ?
    `, [org, repo, start, end]);

    const ji = execGet(`
      SELECT COUNT(*) as done, AVG(cycle_time_days) as avgCycle
      FROM jira_issues WHERE project=? AND status IN (${ph}) AND resolved_at BETWEEN ? AND ?
    `, [project, ...DONE, start, end]);

    const d = new Date(start);
    const label = grain === 'day'
      ? `${d.getMonth() + 1}/${d.getDate()}`
      : `${d.toLocaleString('default', { month: 'short' })} ${d.getDate()}`;

    return { label, start, end, github: gh, jira: ji };
  }).reverse();
}

export default db;
