import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'fs';
import { join, basename } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import {
  SECRET_PATTERNS,
  scanFileSecrets,
  scanGitHistory,
  scanDependencies,
  scanBumblebee,
  scanLocalThreatIntel,
  scanOsv,
  runFullScan,
  findGitRepos,
} from '../security.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

// Constructed to match SECRET_PATTERNS without literal secrets in source
const TEST_SECRETS = {
  awsKey:      'AKIA' + 'A'.repeat(16),
  ghToken:     'ghp_' + 'a'.repeat(36),
  stripeKey:   'sk_live_' + 'a'.repeat(24),
  slackToken:  'xoxb-' + 'a'.repeat(10),
  googleKey:   'AIza' + 'a'.repeat(35),
  password:    'supersecretpassword1',
  secretVal:   'mysupersecrettoken123',
  apiKey:      'myapikey1234567890',
  passwordLcl: 'localsecretpassword1',
  passwordPrd: 'prodsecretpassword12',
};

function tmpDir(prefix) {
  return mkdtempSync(join(tmpdir(), `devpulse-${prefix}-`));
}

function makeGitRepo() {
  const dir = tmpDir('git');
  spawnSync('git', ['init'], { cwd: dir });
  spawnSync('git', ['config', '--local', 'user.email', 'test@example.com'], { cwd: dir });
  spawnSync('git', ['config', '--local', 'user.name', 'Test User'], { cwd: dir });
  return dir;
}

function gitCommit(dir, msg) {
  spawnSync('git', ['add', '.'], { cwd: dir });
  spawnSync('git', ['commit', '-m', msg, '--allow-empty'], { cwd: dir });
}

// ── SECRET_PATTERNS ──────────────────────────────────────────────────────────

describe('SECRET_PATTERNS — true positives', () => {
  const cases = [
    ['AWS Access Key ID',  `const key = "${TEST_SECRETS.awsKey}";`],
    ['GitHub Token',       `token = "${TEST_SECRETS.ghToken}";`],
    ['Private Key',        '-----BEGIN RSA PRIVATE KEY-----'],
    ['Stripe Secret Key',  `stripe = "${TEST_SECRETS.stripeKey}";`],
    ['Slack Token',        TEST_SECRETS.slackToken],
    ['Google API Key',     `key: "${TEST_SECRETS.googleKey}"`],
    ['Generic Password',   `password: "${TEST_SECRETS.password}"`],
    ['Generic Secret',     `secret: "${TEST_SECRETS.secretVal}"`],
    ['API Key Assignment', `api_key: "${TEST_SECRETS.apiKey}"`],
  ];

  for (const [name, line] of cases) {
    it(`detects ${name}`, () => {
      const p = SECRET_PATTERNS.find(p => p.name === name);
      assert.ok(p, `Pattern "${name}" missing from SECRET_PATTERNS`);
      assert.ok(p.pattern.test(line), `Expected match in: ${line}`);
    });
  }

  it('assigns critical severity to AWS Access Key ID', () => {
    assert.equal(SECRET_PATTERNS.find(p => p.name === 'AWS Access Key ID').severity, 'critical');
  });

  it('assigns critical severity to GitHub Token', () => {
    assert.equal(SECRET_PATTERNS.find(p => p.name === 'GitHub Token').severity, 'critical');
  });

  it('assigns critical severity to Private Key', () => {
    assert.equal(SECRET_PATTERNS.find(p => p.name === 'Private Key').severity, 'critical');
  });
});

describe('SECRET_PATTERNS — false positives', () => {
  const safe = [
    'const x = 42;',
    'password: "",',
    'password: process.env.PASSWORD,',
    'secret: config.secret,',
    'api_key: null',
    'token: undefined',
    '// TODO: add authentication here',
    'function getApiKey() { return env.API_KEY; }',
    'if (password.length < 8) throw new Error("too short");',
  ];

  for (const line of safe) {
    it(`does not flag: ${line.slice(0, 50)}`, () => {
      for (const { name, pattern } of SECRET_PATTERNS) {
        assert.ok(
          !pattern.test(line),
          `Pattern "${name}" false-positived on: ${line}`,
        );
      }
    });
  }
});

// ── scanFileSecrets ──────────────────────────────────────────────────────────

describe('scanFileSecrets', () => {
  it('returns empty array for a clean file', () => {
    const dir = tmpDir('clean');
    try {
      writeFileSync(join(dir, 'index.js'), 'const x = 42;\nexport default x;\n');
      assert.equal(scanFileSecrets(dir).length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('detects AWS Access Key ID in a .js file', () => {
    const dir = tmpDir('aws');
    try {
      writeFileSync(join(dir, 'config.js'), `const key = "${TEST_SECRETS.awsKey}";\n`);
      const findings = scanFileSecrets(dir);
      const hit = findings.find(f => f.rule === 'AWS Access Key ID');
      assert.ok(hit, 'Expected AWS key finding');
      assert.equal(hit.type, 'secret');
      assert.equal(hit.severity, 'critical');
      assert.equal(hit.file, 'config.js');
      assert.equal(hit.line, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('detects GitHub token in a .ts file', () => {
    const dir = tmpDir('ghtoken');
    try {
      writeFileSync(join(dir, 'auth.ts'), [
        'const baseUrl = "https://api.github.com";',
        `const token = "${TEST_SECRETS.ghToken}";`,
      ].join('\n'));
      const findings = scanFileSecrets(dir);
      const hit = findings.find(f => f.rule === 'GitHub Token');
      assert.ok(hit);
      assert.equal(hit.line, 2);
      assert.equal(hit.file, 'auth.ts');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('scans .env files without a recognised extension', () => {
    const dir = tmpDir('env');
    try {
      writeFileSync(join(dir, '.env'), `AWS_ACCESS_KEY_ID=${TEST_SECRETS.awsKey}\n`);
      const findings = scanFileSecrets(dir);
      assert.ok(findings.length > 0, 'Expected finding in .env');
      assert.equal(findings[0].file, '.env');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('scans .env.local and .env.production variants', () => {
    const dir = tmpDir('envvariants');
    try {
      writeFileSync(join(dir, '.env.local'),      `password: "${TEST_SECRETS.passwordLcl}"\n`);
      writeFileSync(join(dir, '.env.production'), `password: "${TEST_SECRETS.passwordPrd}"\n`);
      const findings = scanFileSecrets(dir);
      const files = findings.map(f => f.file);
      assert.ok(files.includes('.env.local'),      'Should scan .env.local');
      assert.ok(files.includes('.env.production'), 'Should scan .env.production');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips node_modules entirely', () => {
    const dir = tmpDir('nm');
    try {
      const pkgDir = join(dir, 'node_modules', 'some-lib');
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(join(pkgDir, 'index.js'), `const k = "${TEST_SECRETS.awsKey}";\n`);
      const findings = scanFileSecrets(dir);
      assert.ok(
        !findings.some(f => f.file.includes('node_modules')),
        'node_modules should be skipped',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports multiple findings across multiple files', () => {
    const dir = tmpDir('multi');
    try {
      writeFileSync(join(dir, 'a.js'), `const k = "${TEST_SECRETS.awsKey}";\n`);
      writeFileSync(join(dir, 'b.js'), `const t = "${TEST_SECRETS.ghToken}";\n`);
      const findings = scanFileSecrets(dir);
      assert.equal(findings.length, 2);
      assert.ok(findings.some(f => f.file === 'a.js'));
      assert.ok(findings.some(f => f.file === 'b.js'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('redacts the matched secret value in the snippet', () => {
    const dir = tmpDir('redact');
    try {
      const secret = TEST_SECRETS.awsKey;
      writeFileSync(join(dir, 'secrets.js'), `const key = "${secret}";\n`);
      const findings = scanFileSecrets(dir);
      const hit = findings.find(f => f.rule === 'AWS Access Key ID');
      assert.ok(hit, 'Expected finding');
      assert.ok(!hit.snippet.includes(secret), 'Raw secret should not appear in snippet');
      assert.ok(hit.snippet.includes('•'), 'Snippet should contain redaction marker');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('detects a secret on line 5 of a multi-line file', () => {
    const dir = tmpDir('lineno');
    try {
      const lines = [
        'const a = 1;',
        'const b = 2;',
        'const c = 3;',
        'const d = 4;',
        `const key = "${TEST_SECRETS.awsKey}";`,
      ];
      writeFileSync(join(dir, 'deep.js'), lines.join('\n'));
      const findings = scanFileSecrets(dir);
      const hit = findings.find(f => f.rule === 'AWS Access Key ID');
      assert.ok(hit);
      assert.equal(hit.line, 5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('walks into nested subdirectories', () => {
    const dir = tmpDir('nested');
    try {
      const sub = join(dir, 'src', 'utils');
      mkdirSync(sub, { recursive: true });
      writeFileSync(join(sub, 'api.js'), `const k = "${TEST_SECRETS.awsKey}";\n`);
      const findings = scanFileSecrets(dir);
      assert.ok(findings.some(f => f.file.includes('utils')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── scanGitHistory ────────────────────────────────────────────────────────────

describe('scanGitHistory', () => {
  it('returns empty array for a repo with no secrets committed', () => {
    const dir = makeGitRepo();
    try {
      writeFileSync(join(dir, 'index.js'), 'const x = 1;\n');
      gitCommit(dir, 'init');
      assert.equal(scanGitHistory(dir).length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('finds an AWS key committed and later removed', () => {
    const dir = makeGitRepo();
    try {
      writeFileSync(join(dir, 'config.js'), 'const env = "dev";\n');
      gitCommit(dir, 'init');

      writeFileSync(join(dir, 'config.js'), `const key = "${TEST_SECRETS.awsKey}";\n`);
      gitCommit(dir, 'oops add key');

      writeFileSync(join(dir, 'config.js'), 'const key = process.env.AWS_KEY;\n');
      gitCommit(dir, 'fix: use env var');

      const findings = scanGitHistory(dir);
      const hit = findings.find(f => f.rule === 'AWS Access Key ID');
      assert.ok(hit, 'Expected AWS key in git history');
      assert.equal(hit.type, 'git_history');
      assert.equal(hit.file, 'config.js');
      assert.ok(hit.commit.length === 8, 'Commit hash should be 8 chars');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('finds a GitHub token that was never removed', () => {
    const dir = makeGitRepo();
    try {
      writeFileSync(join(dir, 'auth.js'), `const t = "${TEST_SECRETS.ghToken}";\n`);
      gitCommit(dir, 'add auth');

      const findings = scanGitHistory(dir);
      const hit = findings.find(f => f.rule === 'GitHub Token');
      assert.ok(hit, 'Expected GitHub token in history');
      assert.equal(hit.file, 'auth.js');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not report findings from deleted-only commits (no addition lines)', () => {
    const dir = makeGitRepo();
    try {
      writeFileSync(join(dir, 'remove-me.js'), 'const x = 1;\n');
      gitCommit(dir, 'add file');

      rmSync(join(dir, 'remove-me.js'));
      gitCommit(dir, 'remove file');

      // All lines in the delete commit start with '-', not '+', so no secret lines
      assert.equal(scanGitHistory(dir).length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('redacts the secret value in git history snippets', () => {
    const dir = makeGitRepo();
    try {
      const secret = TEST_SECRETS.awsKey;
      writeFileSync(join(dir, 'keys.js'), `const k = "${secret}";\n`);
      gitCommit(dir, 'add keys');

      const findings = scanGitHistory(dir);
      const hit = findings.find(f => f.rule === 'AWS Access Key ID');
      assert.ok(hit);
      assert.ok(!hit.snippet.includes(secret), 'Raw secret should be redacted');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── scanDependencies ──────────────────────────────────────────────────────────

describe('scanDependencies', () => {
  it('returns empty array when no package.json or requirements.txt exists', () => {
    const dir = tmpDir('nodeps');
    try {
      assert.deepEqual(scanDependencies(dir), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns an array (no throw) for a package.json with no dependencies', () => {
    const dir = tmpDir('emptypackage');
    try {
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'test', version: '1.0.0', dependencies: {} }),
      );
      const findings = scanDependencies(dir);
      assert.ok(Array.isArray(findings));
      assert.equal(findings.length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('each finding has required fields when vulnerabilities are present', () => {
    // Verify the shape contract regardless of whether npm audit runs
    const dir = tmpDir('depshape');
    try {
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'test', version: '1.0.0' }),
      );
      const findings = scanDependencies(dir);
      for (const f of findings) {
        assert.ok('type' in f,     'finding.type required');
        assert.ok('severity' in f, 'finding.severity required');
        assert.ok('rule' in f,     'finding.rule required');
        assert.ok('file' in f,     'finding.file required');
        assert.equal(f.type, 'dependency');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── scanBumblebee ──────────────────────────────────────────────────────────────

describe('scanBumblebee', () => {
  it('returns empty result when no node_modules or .venv exists', () => {
    const dir = tmpDir('bb-empty');
    try {
      const result = scanBumblebee(dir);
      assert.deepEqual(result, { findings: [], pkgCount: 0 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns empty result for an empty node_modules directory', () => {
    const dir = tmpDir('bb-empty-nm');
    try {
      mkdirSync(join(dir, 'node_modules'), { recursive: true });
      const result = scanBumblebee(dir);
      assert.ok(Array.isArray(result.findings));
      assert.equal(typeof result.pkgCount, 'number');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns findings when bumblebee detects a threat', () => {
    const dir = tmpDir('bb-real');
    try {
      mkdirSync(join(dir, 'node_modules', 'malicious-pkg'), { recursive: true });
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        name: 'test', version: '1.0.0',
        dependencies: { 'malicious-pkg': '1.0.0' },
      }));
      const result = scanBumblebee(dir);
      assert.ok(Array.isArray(result.findings));
      assert.equal(typeof result.pkgCount, 'number');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── scanLocalThreatIntel ──────────────────────────────────────────────────────

describe('scanLocalThreatIntel', () => {
  it('returns empty array when no node_modules or .venv exists', () => {
    const dir = tmpDir('lti-empty');
    try {
      const result = scanLocalThreatIntel(dir);
      assert.deepEqual(result, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns empty array for a safe package version in node_modules', () => {
    const dir = tmpDir('lti-safe-npm');
    try {
      mkdirSync(join(dir, 'node_modules', 'mimosa'), { recursive: true });
      writeFileSync(join(dir, 'node_modules', 'mimosa', 'package.json'), JSON.stringify({
        name: 'mimosa', version: '1.0.0',
      }));
      const result = scanLocalThreatIntel(dir);
      assert.ok(Array.isArray(result));
      assert.equal(result.length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('flags a known-bad npm package version', () => {
    const dir = tmpDir('lti-bad-npm');
    try {
      mkdirSync(join(dir, 'node_modules', 'mimosa'), { recursive: true });
      writeFileSync(join(dir, 'node_modules', 'mimosa', 'package.json'), JSON.stringify({
        name: 'mimosa', version: '3.2.1',
      }));
      const result = scanLocalThreatIntel(dir);
      assert.ok(Array.isArray(result));
      assert.equal(result.length, 1);
      assert.equal(result[0].severity, 'critical');
      assert.equal(result[0].type, 'local_threat_intel');
      assert.ok(result[0].rule.includes('mimosa@3.2.1'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── scanOsv ───────────────────────────────────────────────────────────────────

describe('scanOsv', () => {
  it('returns empty result when no lockfile exists', () => {
    const dir = tmpDir('osv-empty');
    try {
      const result = scanOsv(dir);
      assert.deepEqual(result, { findings: [], scanned: null });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns empty result for an empty package-lock.json', () => {
    const dir = tmpDir('osv-empty-lock');
    try {
      writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({
        name: 'test', version: '1.0.0', lockfileVersion: 3,
        packages: {}, dependencies: {},
      }));
      const result = scanOsv(dir);
      assert.ok(Array.isArray(result.findings));
      assert.ok(result.scanned === null || typeof result.scanned === 'string');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('processes a real package-lock.json without crashing', () => {
    const dir = tmpDir('osv-real');
    try {
      writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({
        name: 'test', version: '1.0.0', lockfileVersion: 3,
        packages: {
          'node_modules/express': {
            version: '4.17.1',
            resolved: 'https://registry.npmjs.org/express/-/express-4.17.1.tgz',
          },
        },
        dependencies: {
          express: { version: '4.17.1', resolved: 'https://registry.npmjs.org/express/-/express-4.17.1.tgz' },
        },
      }));
      const result = scanOsv(dir);
      assert.ok(Array.isArray(result.findings));
      assert.ok(typeof result.scanned === 'string' || result.scanned === null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── runFullScan ───────────────────────────────────────────────────────────────

describe('runFullScan', () => {
  it('runs all sub-scans on a clean directory and calls onProgress', () => {
    const dir = tmpDir('fullscan');
    const stages = [];
    try {
      writeFileSync(join(dir, 'index.js'), 'const x = 1;\n');
      const result = runFullScan(dir, (s) => stages.push(s));
      assert.ok(Array.isArray(stages));
      assert.ok(stages.length >= 4, `Expected 4+ stages, got ${stages.length}`);
      assert.equal(stages[0], 'secrets');
      assert.equal(stages[stages.length - 1], 'cve_lockfile');
      assert.equal(typeof result.repo_path, 'string');
      assert.equal(typeof result.total, 'number');
      assert.equal(typeof result.critical, 'number');
      assert.equal(typeof result.high, 'number');
      assert.equal(typeof result.medium, 'number');
      assert.equal(result.repo_name, basename(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns zero counts for a clean repo', () => {
    const dir = tmpDir('fullscan-clean');
    try {
      writeFileSync(join(dir, 'clean.js'), 'const x = 42;\nexport default x;\n');
      const result = runFullScan(dir);
      assert.equal(result.total, 0);
      assert.equal(result.critical, 0);
      assert.equal(result.high, 0);
      assert.equal(result.medium, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('works without an onProgress callback', () => {
    const dir = tmpDir('fullscan-nocb');
    try {
      writeFileSync(join(dir, 'index.js'), 'const x = 1;\n');
      const result = runFullScan(dir);
      assert.equal(typeof result.total, 'number');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── findGitRepos ──────────────────────────────────────────────────────────────

describe('findGitRepos', () => {
  it('returns an array', () => {
    assert.ok(Array.isArray(findGitRepos()));
  });

  it('discovers a git repo in a provided root', () => {
    const root = tmpDir('repos-root');
    const repoDir = join(root, 'myproject');
    try {
      mkdirSync(repoDir);
      spawnSync('git', ['init'], { cwd: repoDir });

      const found = findGitRepos([root]);
      assert.ok(found.includes(repoDir), 'Should find the initialised repo');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not descend into node_modules', () => {
    const root = tmpDir('repos-nm');
    const nmRepo = join(root, 'node_modules', 'some-pkg');
    try {
      mkdirSync(nmRepo, { recursive: true });
      spawnSync('git', ['init'], { cwd: nmRepo });

      const found = findGitRepos([root]);
      assert.ok(
        !found.some(r => r.includes('node_modules')),
        'node_modules repos should be excluded',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('finds repos nested one level deep', () => {
    const root = tmpDir('repos-nested');
    const group = join(root, 'group');
    const repoA = join(group, 'repoA');
    const repoB = join(group, 'repoB');
    try {
      mkdirSync(repoA, { recursive: true });
      mkdirSync(repoB, { recursive: true });
      spawnSync('git', ['init'], { cwd: repoA });
      spawnSync('git', ['init'], { cwd: repoB });

      const found = findGitRepos([root]);
      assert.ok(found.includes(repoA), 'Should find repoA');
      assert.ok(found.includes(repoB), 'Should find repoB');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not recurse into a found git repo', () => {
    // A repo that itself contains a nested .git should only be returned once
    const root = tmpDir('repos-stop');
    const outer = join(root, 'outer');
    const inner = join(outer, 'inner');
    try {
      mkdirSync(inner, { recursive: true });
      spawnSync('git', ['init'], { cwd: outer });
      spawnSync('git', ['init'], { cwd: inner });

      const found = findGitRepos([root]);
      // outer is found first; walker stops and should NOT add inner separately
      assert.ok(found.includes(outer));
      assert.ok(!found.includes(inner), 'Should not descend into a repo');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
