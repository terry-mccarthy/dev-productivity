// GitHub API fetcher — returns raw PR events for upsert into SQLite

const daysBetween = (a, b) => Math.max(0, (new Date(b) - new Date(a)) / 86400000);

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Fetch all merged PRs since `cutoffDate` for a given repo.
 * Paginates until it reaches the cutoff or runs out of pages.
 */
async function fetchAllMergedPRs(token, org, repo, cutoffDate) {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
  const base = 'https://api.github.com';
  let page = 1;
  const allPRs = [];

  while (true) {
    const res = await fetch(
      `${base}/repos/${org}/${repo}/pulls?state=closed&per_page=100&page=${page}&sort=updated&direction=desc`,
      { headers }
    );

    if (res.status === 403) {
      const reset = res.headers.get('x-ratelimit-reset');
      const wait  = reset ? (parseInt(reset) * 1000 - Date.now() + 2000) : 60000;
      console.log(`[github] Rate limited — waiting ${Math.round(wait / 1000)}s`);
      await sleep(wait);
      continue;
    }

    if (!res.ok) throw new Error(`GitHub ${res.status}: ${res.statusText}`);

    const prs = await res.json();
    if (!prs.length) break;

    const merged = prs.filter(p => p.merged_at && new Date(p.merged_at) > cutoffDate);
    allPRs.push(...merged);

    // Stop if last PR in page is older than cutoff
    const oldestMergedAt = prs[prs.length - 1].merged_at;
    if (!oldestMergedAt || new Date(oldestMergedAt) < cutoffDate) break;

    page++;
    await sleep(200); // gentle rate limiting
  }

  return allPRs;
}

/**
 * Fetch first-review time for each PR in batches of 10.
 */
async function enrichWithReviewTimes(token, org, repo, prs) {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
  const base = 'https://api.github.com';
  const BATCH = 10;
  const result = new Map();

  for (let i = 0; i < prs.length; i += BATCH) {
    const batch = prs.slice(i, i + BATCH);
    const times = await Promise.all(batch.map(async pr => {
      try {
        const r = await fetch(`${base}/repos/${org}/${repo}/pulls/${pr.number}/reviews`, { headers });
        if (!r.ok) return null;
        const reviews = await r.json();
        const first = reviews.find(rv => rv.submitted_at);
        return first ? daysBetween(pr.created_at, first.submitted_at) : null;
      } catch { return null; }
    }));
    batch.forEach((pr, j) => result.set(pr.number, times[j]));
    await sleep(300);
  }

  return result;
}

async function listOrgRepos(token, org) {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
  // Try org endpoint first, fall back to user endpoint
  for (const url of [
    `https://api.github.com/orgs/${org}/repos?per_page=100&sort=pushed&direction=desc`,
    `https://api.github.com/users/${org}/repos?per_page=100&sort=pushed&direction=desc`,
  ]) {
    const res = await fetch(url, { headers });
    if (res.ok) {
      const data = await res.json();
      return data.map(r => r.name);
    }
  }
  throw new Error(`Could not list repos for ${org}`);
}

/**
 * Main export: fetch and transform all PRs into DB-ready rows.
 * If repo is empty, discovers all repos in the org automatically.
 */
export async function fetchGitHubEvents(token, org, repo, cutoffDate) {
  const repos = repo ? [repo] : await listOrgRepos(token, org);
  console.log(`[github] Syncing ${repos.length} repo(s) for ${org} since ${cutoffDate.toISOString()}`);

  const allRows = [];
  for (const r of repos) {
    const prs = await fetchAllMergedPRs(token, org, r, cutoffDate);
    if (!prs.length) continue;
    console.log(`[github] ${r}: ${prs.length} merged PRs`);
    const reviewMap = await enrichWithReviewTimes(token, org, r, prs);
    const now = Date.now();
    for (const pr of prs) {
      allRows.push({
        id:               `${org}/${r}#${pr.number}`,
        org,
        repo:             r,
        author:           pr.user?.login || 'unknown',
        created_at:       new Date(pr.created_at).getTime(),
        merged_at:        new Date(pr.merged_at).getTime(),
        cycle_time_days:  daysBetween(pr.created_at, pr.merged_at),
        review_time_days: reviewMap.get(pr.number) ?? null,
        synced_at:        now,
      });
    }
  }
  return allRows;
}
