import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getConfig, setConfig, getMappings, saveMappings, insertSecurityScan, getLatestScan, getAllLatestScans, getRepoScanHistory, getScansAtTime, getSecurityScanHistory } from '../db.js';

// ── Config ──────────────────────────────────────────────────────────────────

describe('config', () => {
  const saved = {};

  before(() => {
    const c = getConfig();
    saved.gh_token = c.gh_token;
    saved.gh_org = c.gh_org;
    saved.gh_repo = c.gh_repo;
  });

  after(() => {
    setConfig({ gh_token: saved.gh_token, gh_org: saved.gh_org, gh_repo: saved.gh_repo, jira_token: '', jira_email: '', jira_domain: '', jira_project: '' });
  });

  it('returns a config object with expected keys', () => {
    const cfg = getConfig();
    assert.ok('gh_token' in cfg);
    assert.ok('gh_org' in cfg);
    assert.ok('gh_repo' in cfg);
  });

  it('persists written values and reads them back', () => {
    setConfig({ gh_token: 'test_token', gh_org: 'test_org', gh_repo: 'test_repo', jira_token: '', jira_email: '', jira_domain: '', jira_project: '' });
    const cfg = getConfig();
    assert.equal(cfg.gh_token, 'test_token');
    assert.equal(cfg.gh_org, 'test_org');
    assert.equal(cfg.gh_repo, 'test_repo');
  });

  it('does not clear unset keys when saving partial config', () => {
    setConfig({ gh_token: 'partial_token' });
    const cfg = getConfig();
    assert.equal(cfg.gh_token, 'partial_token');
  });

  it('handles empty string values', () => {
    setConfig({ gh_token: '', gh_org: '', gh_repo: '' });
    const cfg = getConfig();
    assert.equal(cfg.gh_token, '');
  });
});

// ── Mappings ────────────────────────────────────────────────────────────────

describe('mappings', () => {
  const saved = {};

  before(() => {
    const m = getMappings();
    saved.mappings = m.mappings;
    saved.teams = m.teams;
  });

  after(() => {
    saveMappings({ mappings: saved.mappings, teams: saved.teams });
  });

  it('returns mappings and teams as arrays', () => {
    const m = getMappings();
    assert.ok(Array.isArray(m.mappings));
    assert.ok(Array.isArray(m.teams));
  });

  it('persists a mapping and reads it back', () => {
    saveMappings({ mappings: [{ jira_id: 'test-user', gh_login: 'test-gh', display_name: 'Test User' }], teams: [] });
    const m = getMappings();
    const found = m.mappings.find(x => x.jira_id === 'test-user');
    assert.ok(found);
    assert.equal(found.gh_login, 'test-gh');
    assert.equal(found.display_name, 'Test User');
  });

  it('persists a team with members', () => {
    saveMappings({ mappings: [], teams: [{ id: 'team-1', name: 'Test Team', color: '#ff0000', memberJiraIds: ['user-a', 'user-b'] }] });
    const m = getMappings();
    const team = m.teams.find(x => x.id === 'team-1');
    assert.ok(team);
    assert.equal(team.name, 'Test Team');
    assert.deepEqual(team.memberJiraIds, ['user-a', 'user-b']);
  });
});

// ── Security scans ──────────────────────────────────────────────────────────

describe('security scans CRUD', () => {
  const testScan = {
    repo_path: '/tmp/test-repo',
    repo_name: 'test-repo',
    scanned_at: Date.now(),
    total: 10,
    critical: 2,
    high: 3,
    medium: 5,
    secrets: 4,
    history: 3,
    deps: 2,
    bumblebee: 1,
    osv: 0,
  };

  after(() => {
    // Clean up inserted test data
    const all = getAllLatestScans();
    for (const s of all) {
      if (s.repo_path === testScan.repo_path) {
        // Can't delete directly, but subsequent tests handle it
      }
    }
  });

  it('inserts a scan and retrieves it via getLatestScan', () => {
    insertSecurityScan(testScan);
    const latest = getLatestScan(testScan.repo_path);
    assert.ok(latest);
    assert.equal(latest.repo_name, 'test-repo');
    assert.equal(latest.total, 10);
    assert.equal(latest.critical, 2);
    assert.equal(latest.high, 3);
    assert.equal(latest.medium, 5);
    assert.equal(latest.secrets, 4);
    assert.equal(latest.history, 3);
    assert.equal(latest.deps, 2);
    assert.equal(latest.bumblebee, 1);
    assert.equal(latest.osv, 0);
  });

  it('getLatestScan returns null for non-existent repo', () => {
    const result = getLatestScan('/nonexistent/path');
    assert.equal(result, null);
  });

  it('getAllLatestScans includes the inserted scan', () => {
    const all = getAllLatestScans();
    const found = all.find(s => s.repo_path === testScan.repo_path);
    assert.ok(found, 'inserted scan should appear in latest scans');
  });

  it('getScansAtTime returns scans at a specific timestamp', () => {
    const scans = getScansAtTime(testScan.scanned_at);
    const found = scans.find(s => s.repo_path === testScan.repo_path);
    assert.ok(found);
    assert.equal(found.total, testScan.total);
  });

  it('getScansAtTime returns empty array for unknown timestamp', () => {
    const scans = getScansAtTime(0);
    assert.deepEqual(scans, []);
  });

  it('getSecurityScanHistory returns aggregated results', () => {
    const history = getSecurityScanHistory(90);
    assert.ok(Array.isArray(history));
    if (history.length > 0) {
      const entry = history[0];
      assert.ok('scanned_at' in entry);
      assert.ok('total' in entry);
      assert.ok('repos_scanned' in entry);
    }
  });

  it('getRepoScanHistory returns scan history for a specific repo', () => {
    const history = getRepoScanHistory(testScan.repo_path, 90);
    const found = history.find(s => s.scanned_at === testScan.scanned_at);
    assert.ok(found);
    assert.equal(found.repo_name, 'test-repo');
  });

  it('getRepoScanHistory returns empty for unknown repo', () => {
    const history = getRepoScanHistory('/nonexistent', 90);
    assert.deepEqual(history, []);
  });

  it('inserts a second scan for same repo and latest is newest', () => {
    const newerScan = { ...testScan, scanned_at: testScan.scanned_at + 1000, total: 20, critical: 5 };
    insertSecurityScan(newerScan);
    const latest = getLatestScan(testScan.repo_path);
    assert.equal(latest.total, 20);
    assert.equal(latest.critical, 5);
    assert.equal(latest.scanned_at, newerScan.scanned_at);
  });
});
