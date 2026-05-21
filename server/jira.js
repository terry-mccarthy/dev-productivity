// Jira API fetcher — returns raw issue events for upsert into SQLite

const daysBetween = (a, b) => Math.max(0, (new Date(b) - new Date(a)) / 86400000);

const DONE_STATUSES = new Set(['Done', 'Closed', 'Resolved']);

/**
 * Fetch all issues updated since cutoffDate via paginated JQL search.
 */
export async function fetchJiraEvents(token, email, domain, project, cutoffDate) {
  const base = `https://${domain}/rest/api/3`;
  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  const headers = { Authorization: `Basic ${auth}`, Accept: 'application/json' };

  const daysBack = Math.ceil((Date.now() - cutoffDate.getTime()) / 86400000);
  const jql = encodeURIComponent(
    `project = ${project} AND updated >= -${daysBack}d ORDER BY updated DESC`
  );

  let startAt = 0;
  const PAGE = 100;
  const all = [];

  console.log(`[jira] Fetching issues for ${project} since ${cutoffDate.toISOString()}`);

  while (true) {
    const res = await fetch(
      `${base}/search?jql=${jql}&maxResults=${PAGE}&startAt=${startAt}&fields=status,created,resolutiondate,assignee,priority,issuetype`,
      { headers }
    );

    if (!res.ok) throw new Error(`Jira ${res.status}: ${res.statusText}`);

    const data = await res.json();
    const issues = data.issues || [];
    all.push(...issues);

    if (startAt + issues.length >= data.total || issues.length < PAGE) break;
    startAt += PAGE;
  }

  console.log(`[jira] Found ${all.length} issues`);

  const now = Date.now();
  return all.map(i => {
    const status = i.fields.status?.name || 'Unknown';
    const resolvedAt = DONE_STATUSES.has(status) && i.fields.resolutiondate
      ? new Date(i.fields.resolutiondate).getTime()
      : null;
    const createdAt = i.fields.created ? new Date(i.fields.created).getTime() : null;

    return {
      id:              i.key,
      project,
      assignee_id:     i.fields.assignee?.accountId  || 'unassigned',
      assignee_name:   i.fields.assignee?.displayName || 'Unassigned',
      created_at:      createdAt,
      resolved_at:     resolvedAt,
      cycle_time_days: createdAt && resolvedAt ? daysBetween(i.fields.created, i.fields.resolutiondate) : null,
      status,
      synced_at:       now,
    };
  });
}
