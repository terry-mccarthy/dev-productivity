import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'http';

let baseUrl;
let server;

before(async () => {
  const mod = await import('../index.js');
  const app = mod.default;
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      baseUrl = `http://localhost:${addr.port}`;
      resolve();
    });
  });
});

after(() => {
  if (server) server.close();
});

// ── Config ──────────────────────────────────────────────────────────────────

describe('GET /api/config', () => {
  it('returns 200 with config object', async () => {
    const res = await fetch(`${baseUrl}/api/config`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok('hasConfig' in body);
    assert.ok('gh' in body);
    assert.ok('jira' in body);
  });

  it('returns hasConfig as boolean', async () => {
    const res = await fetch(`${baseUrl}/api/config`);
    const body = await res.json();
    assert.equal(typeof body.hasConfig, 'boolean');
  });
});

// ── Security workspaces ─────────────────────────────────────────────────────

describe('GET /api/security/workspaces', () => {
  it('returns 200 with repos array', async () => {
    const res = await fetch(`${baseUrl}/api/security/workspaces`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.repos));
    if (body.repos.length > 0) {
      const repo = body.repos[0];
      assert.ok('path' in repo);
      assert.ok('name' in repo);
    }
  });
});

// ── Security history ────────────────────────────────────────────────────────

describe('GET /api/security/history', () => {
  it('returns 200 with latest, trends, and summary', async () => {
    const res = await fetch(`${baseUrl}/api/security/history`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.latest));
    assert.ok(Array.isArray(body.trends));
    assert.ok('summary' in body);
    assert.ok('total' in body.summary);
    assert.ok('repos' in body.summary);
  });

  it('summary has severity counts', async () => {
    const res = await fetch(`${baseUrl}/api/security/history`);
    const body = await res.json();
    assert.ok('critical' in body.summary);
    assert.ok('high' in body.summary);
    assert.ok('medium' in body.summary);
  });
});

// ── Security repo detail ────────────────────────────────────────────────────

describe('GET /api/security/repo/*', () => {
  it('returns 200 with latest and history for an existing repo', async () => {
    const res = await fetch(`${baseUrl}/api/security/repo/${encodeURIComponent('/tmp/test-repo')}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok('repoPath' in body);
    assert.ok('latest' in body);
    assert.ok('history' in body);
    assert.ok(Array.isArray(body.history));
  });

  it('returns null latest for unknown repo', async () => {
    const res = await fetch(`${baseUrl}/api/security/repo/${encodeURIComponent('/nonexistent/path')}`);
    const body = await res.json();
    assert.equal(body.latest, null);
  });
});

// ── Security scans-at ───────────────────────────────────────────────────────

describe('GET /api/security/scans-at', () => {
  it('returns 400 when scanned_at is missing', async () => {
    const res = await fetch(`${baseUrl}/api/security/scans-at`);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok('error' in body);
  });

  it('returns 400 when scanned_at is invalid', async () => {
    const res = await fetch(`${baseUrl}/api/security/scans-at?scanned_at=invalid`);
    assert.equal(res.status, 400);
  });

  it('returns empty scans array for unknown timestamp', async () => {
    const res = await fetch(`${baseUrl}/api/security/scans-at?scanned_at=0`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.scans));
    assert.equal(body.scans.length, 0);
  });

  it('returns scans for a known timestamp', async () => {
    const historyRes = await fetch(`${baseUrl}/api/security/history`);
    const history = await historyRes.json();
    if (history.trends.length > 0) {
      const ts = history.trends[0].scanned_at;
      const res = await fetch(`${baseUrl}/api/security/scans-at?scanned_at=${ts}`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(Array.isArray(body.scans));
    }
  });
});

// ── Sync status ─────────────────────────────────────────────────────────────

describe('GET /api/sync/status', () => {
  it('returns 200 with inProgress and lastSynced', async () => {
    const res = await fetch(`${baseUrl}/api/sync/status`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok('inProgress' in body);
    assert.equal(typeof body.inProgress, 'boolean');
  });
});

// ── Sync (POST) ─────────────────────────────────────────────────────────────

describe('POST /api/sync', () => {
  it('returns 400 when not configured', async () => {
    const res = await fetch(`${baseUrl}/api/config`);
    const cfg = await res.json();
    if (!cfg.hasConfig) {
      const syncRes = await fetch(`${baseUrl}/api/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      assert.equal(syncRes.status, 400);
      const body = await syncRes.json();
      assert.equal(body.error, 'Not configured — POST /api/config first');
    }
  });
});

// ── Security scan input validation ──────────────────────────────────────────

describe('POST /api/security/scan (validation)', () => {
  it('returns 400 when path is missing', async () => {
    const res = await fetch(`${baseUrl}/api/security/scan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok('error' in body);
  });
});

// ── Static files ────────────────────────────────────────────────────────────

describe('Static file serving', () => {
  it('serves index.html', async () => {
    const res = await fetch(`${baseUrl}/index.html`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('DevPulse'));
  });

  it('returns 404 for unknown files', async () => {
    const res = await fetch(`${baseUrl}/nonexistent-file.xyz`);
    assert.equal(res.status, 404);
  });
});

// ── Security scan-all ───────────────────────────────────────────────────────

describe('POST /api/security/scan-all', () => {
  it('returns SSE stream headers and first progress event', { timeout: 30000 }, async () => {
    const res = await fetch(`${baseUrl}/api/security/scan-all`, { method: 'POST' });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/event-stream');

    // Read first chunk to verify progress event
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    const { value } = await reader.read();
    const chunk = dec.decode(value, { stream: true });

    assert.ok(chunk.includes('data: '), 'Should receive SSE data');
    const msg = JSON.parse(chunk.split('\n').find(l => l.startsWith('data: ')).slice(6));
    assert.equal(msg.stage, 'progress');
    assert.ok(msg.total > 0);
    assert.equal(msg.current, 1);

    reader.cancel();
  });
});
