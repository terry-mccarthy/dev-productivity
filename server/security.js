import { spawnSync } from 'child_process';
import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join, extname, relative, basename, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const HOME = homedir();

const SEARCH_ROOTS = [
  join(HOME, 'projects'),
  join(HOME, 'dev'),
  join(HOME, 'work'),
  join(HOME, 'code'),
  join(HOME, 'src'),
  join(HOME, 'repos'),
  join(HOME, 'personal'),
  join(HOME, 'Documents'),
];

// Directories to skip during file system walks
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
  'vendor', '.venv', 'venv', '.cache', 'coverage', 'tmp', 'out',
  'target', '.idea', '.vscode', 'Library', 'Applications',
  'Movies', 'Music', 'Pictures', 'Downloads', '.Trash', 'Public',
]);

export const SECRET_PATTERNS = [
  { name: 'AWS Access Key ID',  severity: 'critical', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'GitHub Token',       severity: 'critical', pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/ },
  { name: 'Private Key',        severity: 'critical', pattern: /-----BEGIN (?:RSA|EC|DSA|OPENSSH|PGP) PRIVATE KEY/ },
  { name: 'Stripe Secret Key',  severity: 'critical', pattern: /sk_live_[0-9a-zA-Z]{24,}/ },
  { name: 'Slack Token',        severity: 'high',     pattern: /xox[baprs]-[0-9A-Za-z-]{10,48}/ },
  { name: 'Google API Key',     severity: 'high',     pattern: /AIza[0-9A-Za-z\-_]{35}/ },
  { name: 'Generic Password',   severity: 'medium',   pattern: /(?:password|passwd)\s*[:=]\s*["'][^"']{8,}["']/i },
  { name: 'Generic Secret',     severity: 'medium',   pattern: /(?:secret|token)\s*[:=]\s*["'][A-Za-z0-9+/]{10,}["']/i },
  { name: 'API Key Assignment', severity: 'medium',   pattern: /api[_-]?key\s*[:=]\s*["'][A-Za-z0-9_\-]{10,}["']/i },
];

const SCAN_EXTS = new Set([
  '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.java', '.php', '.cs',
  '.yaml', '.yml', '.json', '.toml', '.ini', '.cfg', '.conf',
  '.sh', '.bash', '.zsh', '.env',
]);

function isGitRepo(dir) {
  try { return statSync(join(dir, '.git')).isDirectory(); } catch { return false; }
}

export function findGitRepos(roots = null) {
  const found = [];
  const seen = new Set();

  if (!roots && process.env.REPO_ROOTS) {
    roots = process.env.REPO_ROOTS.split(':').filter(Boolean);
  }

  function walk(dir, depth, max) {
    if (depth > max || seen.has(dir)) return;
    seen.add(dir);
    if (isGitRepo(dir)) { found.push(dir); return; }
    try {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
        walk(join(dir, e.name), depth + 1, max);
      }
    } catch {}
  }

  if (roots) {
    for (const root of roots) {
      if (existsSync(root)) walk(root, 0, 2);
    }
  } else {
    walk(HOME, 0, 2);
    for (const root of SEARCH_ROOTS) {
      if (existsSync(root)) walk(root, 0, 3);
    }
  }

  return [...new Set(found)].slice(0, 150);
}

function redact(str) {
  if (!str || str.length < 6) return '***';
  return str.slice(0, 3) + '•'.repeat(Math.min(str.length - 5, 10)) + str.slice(-2);
}

function checkLine(line, lineNum, relPath, out) {
  for (const { name, pattern, severity } of SECRET_PATTERNS) {
    const m = pattern.exec(line);
    if (m) {
      out.push({
        type: 'secret', rule: name, severity,
        file: relPath, line: lineNum,
        snippet: line.trim().slice(0, 160).replace(m[0], redact(m[0])),
      });
    }
  }
}

export function scanFileSecrets(repoPath) {
  const findings = [];

  function walk(dir) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name));
        continue;
      }
      const ext = extname(e.name).toLowerCase();
      const isEnvFile = e.name.startsWith('.env');
      if (!SCAN_EXTS.has(ext) && !isEnvFile) continue;
      const full = join(dir, e.name);
      try {
        if (statSync(full).size > 512 * 1024) continue; // skip > 512 KB
        const text = readFileSync(full, 'utf8');
        text.split('\n').forEach((ln, i) => checkLine(ln, i + 1, relative(repoPath, full), findings));
      } catch {}
    }
  }

  walk(repoPath);
  return findings;
}

export function scanGitHistory(repoPath) {
  const findings = [];
  const r = spawnSync(
    'git', ['log', '--all', '-p', '-n', '300', '--pretty=format:%H', '--no-merges'],
    { cwd: repoPath, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, timeout: 45000 },
  );
  const log = r.stdout || '';
  let commit = '';
  let file = '';
  for (const line of log.split('\n')) {
    if (/^[0-9a-f]{40}$/.test(line.trim())) { commit = line.trim().slice(0, 8); continue; }
    if (line.startsWith('+++ b/')) { file = line.slice(6); continue; }
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    const content = line.slice(1);
    for (const { name, pattern, severity } of SECRET_PATTERNS) {
      const m = pattern.exec(content);
      if (m) {
        findings.push({
          type: 'git_history', rule: name, severity, commit, file,
          snippet: content.trim().slice(0, 160).replace(m[0], redact(m[0])),
        });
      }
    }
  }
  return findings;
}

export function scanDependencies(repoPath) {
  const findings = [];

  if (existsSync(join(repoPath, 'package.json'))) {
    const r = spawnSync('npm', ['audit', '--json'], {
      cwd: repoPath, encoding: 'utf8', timeout: 60000,
    });
    try {
      const audit = JSON.parse(r.stdout || '{}');
      for (const [pkg, info] of Object.entries(audit.vulnerabilities || {})) {
        if (info.severity === 'low') continue;
        const via = Array.isArray(info.via) ? info.via.find(v => typeof v === 'object') : null;
        findings.push({
          type: 'dependency', severity: info.severity,
          rule: pkg, file: 'package.json',
          snippet: via?.title || (info.fixAvailable ? 'Fix available' : 'No known fix'),
        });
      }
    } catch {}
  }

  if (existsSync(join(repoPath, 'requirements.txt'))) {
    const r = spawnSync('pip-audit', ['--format', 'json', '-r', join(repoPath, 'requirements.txt')], {
      encoding: 'utf8', timeout: 60000,
    });
    if (r.stdout) {
      try {
        const rows = JSON.parse(r.stdout);
        for (const dep of (rows.dependencies || rows || [])) {
          for (const v of (dep.vulns || [])) {
            findings.push({
              type: 'dependency', severity: 'high',
              rule: `${dep.name}@${dep.version}`, file: 'requirements.txt',
              snippet: (v.description || v.id || '').slice(0, 120),
            });
          }
        }
      } catch {}
    }
  }

  return findings;
}

const THREAT_INTEL = process.env.BUMBLEBEE_THREAT_INTEL_PATH || '';
const LOCAL_THREAT_INTEL = process.env.THREAT_INTEL_DIR || join(__dirname, 'threat-intel');

function loadLocalThreatIntel() {
  const intel = {};
  try {
    if (existsSync(LOCAL_THREAT_INTEL)) {
      for (const file of readdirSync(LOCAL_THREAT_INTEL)) {
        if (!file.endsWith('.json')) continue;
        const content = readFileSync(join(LOCAL_THREAT_INTEL, file), 'utf8');
        const data = JSON.parse(content);
        if (data.entries) {
          for (const entry of data.entries) {
            intel[entry.id] = entry;
          }
        }
      }
    }
  } catch {}
  return intel;
}

export function scanLocalThreatIntel(repoPath) {
  const findings = [];
  const entries = Object.values(loadLocalThreatIntel());
  if (entries.length === 0) return findings;

  const npmEntries = entries.filter(e => e.ecosystem === 'npm');
  const pypiEntries = entries.filter(e => e.ecosystem === 'pypi');

  if (npmEntries.length > 0) {
    const npmRoot = existsSync(join(repoPath, 'node_modules'))
      ? join(repoPath, 'node_modules')
      : existsSync(join(repoPath, 'server', 'node_modules'))
      ? join(repoPath, 'server', 'node_modules')
      : null;

    if (npmRoot) {
      for (const entry of npmEntries) {
        const pkgDir = join(npmRoot, entry.package);
        if (!existsSync(pkgDir)) continue;
        try {
          const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
          if (entry.versions?.includes(pkg.version)) {
            findings.push({
              type: 'local_threat_intel',
              severity: entry.severity || 'critical',
              rule: `${entry.package}@${pkg.version}`,
              file: `node_modules/${entry.package}/package.json`,
              snippet: entry.name,
            });
          }
        } catch {}
      }
    }
  }

  if (pypiEntries.length > 0) {
    const pythonDirs = [
      join(repoPath, '.venv', 'lib'),
      join(repoPath, 'venv', 'lib'),
    ];

    for (const dir of pythonDirs) {
      if (!existsSync(dir)) continue;
      try {
        for (const pyVer of readdirSync(dir)) {
          const sitePackages = join(dir, pyVer, 'site-packages');
          for (const entry of pypiEntries) {
            const metaPath = join(sitePackages, entry.package, 'metadata.json');
            if (!existsSync(metaPath)) continue;
            try {
              const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
              if (entry.versions?.includes(meta.version)) {
                findings.push({
                  type: 'local_threat_intel',
                  severity: entry.severity || 'critical',
                  rule: `${entry.package}==${meta.version}`,
                  file: `site-packages/${entry.package}/metadata.json`,
                  snippet: entry.name,
                });
              }
            } catch {}
          }
        }
      } catch {}
    }
  }

  return findings;
}

export function scanBumblebee(repoPath) {
  const findings = [];

  let root, ecosystem;

  if (existsSync(join(repoPath, '.venv'))) {
    root = join(repoPath, '.venv');
    ecosystem = 'pypi';
  } else if (existsSync(join(repoPath, 'server', 'node_modules'))) {
    root = join(repoPath, 'server', 'node_modules');
    ecosystem = 'npm';
  } else if (existsSync(join(repoPath, 'node_modules'))) {
    root = join(repoPath, 'node_modules');
    ecosystem = 'npm';
  }

  if (!root || !THREAT_INTEL) return { findings, pkgCount: 0 };

  const r = spawnSync('bumblebee', ['scan', '--root', root, '--exposure-catalog', THREAT_INTEL, '--ecosystem', ecosystem], {
    encoding: 'utf8', timeout: 60000,
  });

  const output = r.stdout || '';
  let pkgCount = 0;

  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.record_type === 'finding') {
        findings.push({
          type: 'bumblebee',
          severity: 'high',
          rule: parsed.package_name || parsed.id || 'unknown',
          file: `${parsed.package_name || ''}@${parsed.version || ''}`,
          snippet: parsed.name || parsed.id || '',
        });
      } else if (parsed.record_type === 'scan_summary') {
        pkgCount = parsed.counts?.package || 0;
      }
    } catch {}
  }

  return { findings, pkgCount };
}

export function scanOsv(repoPath) {
  let lockfile;

  if (existsSync(join(repoPath, 'uv.lock'))) {
    lockfile = join(repoPath, 'uv.lock');
  } else if (existsSync(join(repoPath, 'server', 'package-lock.json'))) {
    lockfile = join(repoPath, 'server', 'package-lock.json');
  } else if (existsSync(join(repoPath, 'package-lock.json'))) {
    lockfile = join(repoPath, 'package-lock.json');
  }

  if (!lockfile) return { findings: [], scanned: null };

  const r = spawnSync('osv-scanner', ['--lockfile', lockfile], {
    encoding: 'utf8', timeout: 60000,
  });

  const output = r.stdout || '';
  const findings = [];
  let scanned = null;

  const pkgMatch = output.match(/^Scanned\s+(.+)$/m);
  if (pkgMatch) scanned = pkgMatch[1].trim();

  if (r.status !== 0) {
    for (const line of output.split('\n')) {
      if (/^Starting|^Scanned|^End status/.test(line)) continue;
      if (!line.trim()) continue;
      findings.push({
        type: 'osv',
        severity: 'high',
        rule: 'CVE',
        file: basename(lockfile),
        snippet: line.trim().slice(0, 160),
      });
    }
  }

  return { findings, scanned };
}

function severityCounts(findings) {
  return findings.reduce((acc, f) => {
    const s = f.severity === 'critical' ? 'critical' : f.severity === 'high' ? 'high' : 'medium';
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, { critical: 0, high: 0, medium: 0 });
}

export function runFullScan(repoPath, onProgress) {
  if (onProgress) onProgress('secrets');
  const secrets = scanFileSecrets(repoPath);
  if (onProgress) onProgress('git_history');
  const history = scanGitHistory(repoPath);
  if (onProgress) onProgress('dependencies');
  const deps = scanDependencies(repoPath);
  if (onProgress) onProgress('supply_chain');
  const { findings: bumblebee } = scanBumblebee(repoPath);
  if (onProgress) onProgress('local_threat_intel');
  const localThreats = scanLocalThreatIntel(repoPath);
  if (onProgress) onProgress('cve_lockfile');
  const { findings: osv } = scanOsv(repoPath);

  const all = [...secrets, ...history, ...deps, ...bumblebee, ...localThreats, ...osv];
  const sev = severityCounts(all);

  return {
    repo_path: repoPath,
    repo_name: basename(repoPath),
    scanned_at: Date.now(),
    total: all.length,
    critical: sev.critical,
    high: sev.high,
    medium: sev.medium,
    secrets: secrets.length,
    history: history.length,
    deps: deps.length,
    bumblebee: bumblebee.length,
    local_threat_intel: localThreats.length,
    osv: osv.length,
    findings: all,
  };
}

export function repoMeta(repoPath) {
  const r = spawnSync('git', ['log', '-1', '--format=%cr'], {
    cwd: repoPath, encoding: 'utf8', timeout: 5000,
  });
  return {
    path: repoPath,
    name: basename(repoPath),
    lastCommit: (r.stdout || '').trim() || null,
  };
}
