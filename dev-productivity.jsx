import { useState, useMemo, useEffect } from "react";

// ── Configuration ────────────────────────────────────────────────────────────
const API_BASE = typeof window !== "undefined" ? window.location.origin : "http://localhost:3002";
const TEAM_COLORS = ["#00ff88","#00c4ff","#a78bfa","#f59e0b","#f472b6","#34d399","#fb923c","#818cf8"];

// ── Utilities ─────────────────────────────────────────────────────────────────
const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
const fmt1 = (n) => Number.isFinite(n) && n > 0 ? n.toFixed(1) : "—";

// ── Shared config input style & field (module-level to avoid remount on rerender) ──
const inputStyle = { background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.12)", borderRadius:8, color:"#fff", padding:"10px 14px", fontSize:13, fontFamily:"monospace", outline:"none", width:"100%", boxSizing:"border-box" };

function ConfigField({ label, placeholder, value, onChange, type="text", full }) {
  return (
    <div style={{ gridColumn: full?"span 2":"span 1" }}>
      <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", marginBottom:5, fontFamily:"monospace" }}>{label}</div>
      <input type={type} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} style={inputStyle} />
    </div>
  );
}

// ── Shared SSE-over-POST stream helper ─────────────────────────────────────────
async function streamSync(onMessage) {
  const res = await fetch(`${API_BASE}/api/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`Sync request failed (${res.status})`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() || "";
    for (const part of parts) {
      for (const line of part.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        try { onMessage(JSON.parse(line.slice(6))); } catch {}
      }
    }
  }
}

// ── SVG Sparkline for high-end micro-animations ──────────────────────────────
function Sparkline({ data, width = 110, height = 32, color = "#00ff88" }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const points = data.map((val, idx) => {
    const x = (idx / (data.length - 1)) * width;
    const y = height - ((val - min) / range) * height;
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg width={width} height={height} style={{ overflow:"visible", marginLeft:"auto" }}>
      <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" points={points} />
    </svg>
  );
}

// ── Stat Card with Sparklines ────────────────────────────────────────────────
function StatCard({ label, value, unit, sub, color, trendData }) {
  return (
    <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:12, padding:"20px 22px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
      <div>
        <div style={{ color:"rgba(255,255,255,0.4)", fontSize:10, letterSpacing:"0.1em", textTransform:"uppercase", fontFamily:"monospace", marginBottom:8 }}>{label}</div>
        <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
          <span style={{ fontSize:28, fontWeight:700, color, fontFamily:"monospace", lineHeight:1 }}>{value}</span>
          {unit && <span style={{ fontSize:12, color:"rgba(255,255,255,0.3)", fontFamily:"monospace" }}>{unit}</span>}
        </div>
        {sub && <div style={{ fontSize:11, color:"rgba(255,255,255,0.25)", fontFamily:"monospace", marginTop:4 }}>{sub}</div>}
      </div>
      {trendData && trendData.length > 1 && (
        <div style={{ opacity:0.8, transition:"opacity 0.2s" }} onMouseEnter={e => e.currentTarget.style.opacity = 1} onMouseLeave={e => e.currentTarget.style.opacity = 0.8}>
          <Sparkline data={trendData} color={color} />
        </div>
      )}
    </div>
  );
}

// ── Mini bar chart ───────────────────────────────────────────────────────────
function MiniBar({ data, color }) {
  const max = Math.max(...data.map(d => d.count), 1);
  return (
    <div style={{ display:"flex", alignItems:"flex-end", gap:3, height:48 }}>
      {data.map((d,i) => (
        <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", height:"100%", justifyContent:"flex-end" }}>
          <div style={{ width:"100%", borderRadius:2, height:`${Math.max(4,(d.count/max)*40)}px`, background:color, opacity:0.5+0.5*(d.count/max), transition:"height 0.5s" }} title={`${d.label}: ${d.count}`} />
        </div>
      ))}
    </div>
  );
}

// ── Table ─────────────────────────────────────────────────────────────────────
function DataTable({ columns, rows }) {
  return (
    <div style={{ overflowX:"auto" }}>
      <table style={{ width:"100%", borderCollapse:"collapse", fontFamily:"monospace", fontSize:12 }}>
        <thead>
          <tr>{columns.map(c => <th key={c} style={{ textAlign:"left", padding:"6px 10px", color:"rgba(255,255,255,0.22)", borderBottom:"1px solid rgba(255,255,255,0.06)", fontSize:10, textTransform:"uppercase", letterSpacing:"0.07em" }}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row,i) => (
            <tr key={i} style={{ borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
              {row.map((cell, j) => {
                const isObj = typeof cell === "object" && cell !== null;
                return (
                  <td key={j} style={{ padding:"9px 10px", color: isObj ? (cell.color||"rgba(255,255,255,0.6)") : "rgba(255,255,255,0.5)" }}>
                    {isObj && cell.dot ? (
                      <span style={{ display:"flex", alignItems:"center", gap:7 }}>
                        <span style={{ width:7, height:7, borderRadius:"50%", background:cell.dot, flexShrink:0 }} />
                        {cell.label}
                      </span>
                    ) : isObj ? cell.label : cell}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Tab ───────────────────────────────────────────────────────────────────────
function Tab({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{ background:active?"rgba(0,255,136,0.08)":"none", border:"none", cursor:"pointer", padding:"7px 13px", borderRadius:8, fontSize:12, fontFamily:"monospace", fontWeight:active?700:400, color:active?"#00ff88":"rgba(255,255,255,0.35)", letterSpacing:"0.04em" }}>{label}</button>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// STEP 1 — CONNECT & SYNC (SQLite Backed)
// ═════════════════════════════════════════════════════════════════════════════
function ConfigScreen({ onConnect }) {
  const [gh, setGh] = useState({ token:"", org:"", repo:"" });
  const [jira, setJira] = useState({ token:"", email:"", domain:"", project:"" });
  const [loading, setLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch(`${API_BASE}/api/config`)
      .then(res => res.json())
      .then(data => {
        if (data.hasConfig) {
          setGh(p => ({ ...p, org: data.gh.org, repo: data.gh.repo }));
          setJira(p => ({ ...p, email: data.jira.email, domain: data.jira.domain, project: data.jira.project }));
        }
      }).catch(console.error);
  }, []);

  const handleConnect = async () => {
    setErr(""); setLoading(true); setSyncStatus("Saving configuration...");
    try {
      const res = await fetch(`${API_BASE}/api/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gh, jira })
      });
      if (!res.ok) throw new Error("Failed to save configuration");

      setSyncStatus("Starting sync...");
      await streamSync((msg) => {
        if (msg.stage === "done") { onConnect(); }
        else if (msg.stage === "error") { setErr(msg.message); setLoading(false); }
        else { setSyncStatus(msg.message); }
      });
    } catch(e) {
      setErr(e.message);
      setLoading(false);
    }
  };

  const allFilled = gh.token && gh.org;

  return (
    <div style={{ minHeight:"100vh", background:"#080c12", display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
      <div style={{ width:"100%", maxWidth:520 }}>
        <div style={{ marginBottom:32, textAlign:"center" }}>
          <div style={{ fontSize:11, letterSpacing:"0.22em", color:"rgba(255,255,255,0.2)", fontFamily:"monospace", marginBottom:10 }}>DEVPULSE</div>
          <h1 style={{ fontSize:24, fontWeight:700, color:"#fff", margin:0, letterSpacing:"-0.02em" }}>Connect your sources</h1>
          <p style={{ color:"rgba(255,255,255,0.28)", marginTop:6, fontSize:12, fontFamily:"monospace" }}>Stored securely on your local SQLite database.</p>
        </div>
        <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:16, padding:26 }}>
          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:10, color:"rgba(255,255,255,0.28)", letterSpacing:"0.12em", textTransform:"uppercase", fontFamily:"monospace", marginBottom:12 }}>GitHub</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              <ConfigField label="Personal Access Token" placeholder="ghp_..." type="password" value={gh.token} onChange={v => setGh(p=>({...p,token:v}))} full />
              <ConfigField label="Owner / Org" placeholder="my-org" value={gh.org} onChange={v => setGh(p=>({...p,org:v}))} />
              <ConfigField label="Repository (optional)" placeholder="leave blank for all org repos" value={gh.repo} onChange={v => setGh(p=>({...p,repo:v}))} />
            </div>
          </div>
          <div style={{ marginBottom:20 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
              <div style={{ fontSize:10, color:"rgba(255,255,255,0.28)", letterSpacing:"0.12em", textTransform:"uppercase", fontFamily:"monospace" }}>Jira</div>
              <div style={{ fontSize:10, color:"rgba(255,255,255,0.18)", fontFamily:"monospace" }}>— optional</div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              <ConfigField label="API Token" placeholder="ATATT..." type="password" value={jira.token} onChange={v => setJira(p=>({...p,token:v}))} full />
              <ConfigField label="Email" placeholder="you@company.com" value={jira.email} onChange={v => setJira(p=>({...p,email:v}))} />
              <ConfigField label="Domain" placeholder="myco.atlassian.net" value={jira.domain} onChange={v => setJira(p=>({...p,domain:v}))} />
              <ConfigField label="Project Key" placeholder="ENG" value={jira.project} onChange={v => setJira(p=>({...p,project:v}))} />
            </div>
          </div>
          {err && <div style={{ background:"rgba(255,60,60,0.1)", border:"1px solid rgba(255,60,60,0.2)", borderRadius:8, padding:"10px 14px", color:"#ff6b6b", fontSize:12, fontFamily:"monospace", marginBottom:14 }}>{err}</div>}
          {loading && <div style={{ background:"rgba(0,255,136,0.06)", border:"1px solid rgba(0,255,136,0.15)", borderRadius:8, padding:"10px 14px", color:"#00ff88", fontSize:12, fontFamily:"monospace", marginBottom:14 }}>⏳ {syncStatus}</div>}
          <button onClick={handleConnect} disabled={loading||!allFilled} style={{ width:"100%", padding:"12px", borderRadius:10, border:"none", background:loading||!allFilled?"rgba(255,255,255,0.07)":"linear-gradient(135deg,#00ff88,#00c4ff)", color:loading||!allFilled?"rgba(255,255,255,0.25)":"#080c12", fontSize:13, fontWeight:700, cursor:loading||!allFilled?"not-allowed":"pointer", fontFamily:"monospace", letterSpacing:"0.05em" }}>
            {loading ? "FETCHING & SYNCING DATABASE..." : "CONNECT & INITIAL SYNC →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// STEP 2 — USER MAPPING + TEAMS
// ═════════════════════════════════════════════════════════════════════════════
function UserMappingScreen({ onDone }) {
  const [jiraUsers, setJiraUsers] = useState([]);
  const [ghLogins, setGhLogins] = useState([]);
  const [mappings, setMappings] = useState({});       // jiraId -> ghLogin
  const [teams, setTeams] = useState([]);              // [{ id, name, color, memberJiraIds[] }]
  const [newTeamName, setNewTeamName] = useState("");
  const [openTeam, setOpenTeam] = useState(null);

  useEffect(() => {
    // Load historical metrics to discover users
    const to = Date.now();
    const from = to - 180 * 86400000;
    Promise.all([
      fetch(`${API_BASE}/api/metrics?from=${from}&to=${to}`).then(res => res.json()),
      fetch(`${API_BASE}/api/mappings`).then(res => res.json())
    ]).then(([metrics, dbMaps]) => {
      // Find all unique assignees/authors from raw SQL events
      const jUsers = Object.entries(metrics.jira.assigneeMap).map(([id, d]) => ({ id, name: d.name }));
      const gLogins = Object.keys(metrics.github.authorMap).sort();
      setJiraUsers(jUsers);
      setGhLogins(gLogins);

      // Load existing mappings
      const initialMap = {};
      dbMaps.mappings.forEach(m => { initialMap[m.jira_id] = m.gh_login; });
      setMappings(initialMap);
      setTeams(dbMaps.teams || []);
    }).catch(console.error);
  }, []);

  const setMapping = (jiraId, ghLogin) =>
    setMappings(m => ({ ...m, [jiraId]: ghLogin || undefined }));

  const addTeam = () => {
    if (!newTeamName.trim()) return;
    const t = { id: Date.now().toString(), name: newTeamName.trim(), color: TEAM_COLORS[teams.length % TEAM_COLORS.length], memberJiraIds: [] };
    setTeams(prev => [...prev, t]);
    setNewTeamName("");
    setOpenTeam(t.id);
  };

  const toggleMember = (teamId, jiraId) => {
    setTeams(prev => prev.map(t => {
      if (t.id !== teamId) return t;
      const has = t.memberJiraIds.includes(jiraId);
      return { ...t, memberJiraIds: has ? t.memberJiraIds.filter(x => x !== jiraId) : [...t.memberJiraIds, jiraId] };
    }));
  };

  const memberOf = (jiraId) => teams.find(t => t.memberJiraIds.includes(jiraId));

  const handleFinish = async () => {
    // Save to server
    const mappingPayload = Object.entries(mappings).map(([jira_id, gh_login]) => {
      const u = jiraUsers.find(ju => ju.id === jira_id);
      return { jira_id, gh_login, display_name: u ? u.name : "" };
    });
    await fetch(`${API_BASE}/api/mappings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mappings: mappingPayload, teams })
    });
    onDone();
  };

  const inp = { background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:8, color:"#fff", padding:"8px 12px", fontSize:12, fontFamily:"monospace", outline:"none" };

  return (
    <div style={{ minHeight:"100vh", background:"#080c12", color:"#fff", fontFamily:"'DM Sans', sans-serif" }}>
      {/* Header */}
      <div style={{ borderBottom:"1px solid rgba(255,255,255,0.07)", padding:"14px 28px", display:"flex", alignItems:"center", justifyBetween:"space-between" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <span style={{ fontSize:11, letterSpacing:"0.2em", color:"rgba(255,255,255,0.25)", fontFamily:"monospace" }}>DEVPULSE</span>
          <span style={{ width:1, height:14, background:"rgba(255,255,255,0.1)" }} />
          <span style={{ fontSize:12, color:"rgba(255,255,255,0.35)", fontFamily:"monospace" }}>Step 2 of 2 — Users & Teams</span>
        </div>
        <button onClick={handleFinish} style={{ background:"linear-gradient(135deg,#00ff88,#00c4ff)", border:"none", borderRadius:9, padding:"9px 22px", fontSize:13, fontWeight:700, fontFamily:"monospace", cursor:"pointer", color:"#080c12", letterSpacing:"0.05em", marginLeft:"auto" }}>
          VIEW DASHBOARD →
        </button>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", maxWidth:1080, margin:"0 auto", padding:"28px 24px", gap:0 }}>
        {/* LEFT — Link Users */}
        <div style={{ paddingRight:28, borderRight:"1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ marginBottom:18 }}>
            <h2 style={{ margin:0, fontSize:15, fontWeight:700 }}>Link Jira → GitHub users</h2>
            <p style={{ margin:"4px 0 0", fontSize:11, color:"rgba(255,255,255,0.3)", fontFamily:"monospace" }}>Match assignees to GitHub logins for unified metrics</p>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
            {jiraUsers.map(({ id, name }) => {
              const team = memberOf(id);
              return (
                <div key={id} style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 12px", background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:10 }}>
                  <span style={{ width:7, height:7, borderRadius:"50%", background:team?.color||"rgba(255,255,255,0.15)", flexShrink:0 }} />
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:12, color:"rgba(255,255,255,0.7)", fontFamily:"monospace", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{name}</div>
                    {team && <div style={{ fontSize:10, color:team.color, opacity:0.75, fontFamily:"monospace" }}>{team.name}</div>}
                  </div>
                  <select value={mappings[id]||""} onChange={e => setMapping(id, e.target.value)} style={{ ...inp, padding:"5px 9px", fontSize:11, minWidth:130 }}>
                    <option value="">— no link —</option>
                    {ghLogins.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT — Define Teams */}
        <div style={{ paddingLeft:28 }}>
          <div style={{ marginBottom:18 }}>
            <h2 style={{ margin:0, fontSize:15, fontWeight:700 }}>Define teams</h2>
            <p style={{ margin:"4px 0 0", fontSize:11, color:"rgba(255,255,255,0.3)", fontFamily:"monospace" }}>Group developers for team-level rollups</p>
          </div>

          <div style={{ display:"flex", gap:8, marginBottom:18 }}>
            <input placeholder="Team name (e.g. Platform)" value={newTeamName} onChange={e => setNewTeamName(e.target.value)} onKeyDown={e => e.key==="Enter" && addTeam()} style={{ ...inp, flex:1 }} />
            <button onClick={addTeam} style={{ background:"rgba(0,255,136,0.1)", border:"1px solid rgba(0,255,136,0.22)", borderRadius:8, padding:"8px 16px", color:"#00ff88", fontSize:12, fontFamily:"monospace", cursor:"pointer" }}>+ Add</button>
          </div>

          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {teams.map(team => (
              <div key={team.id} style={{ background:"rgba(255,255,255,0.02)", border:`1px solid ${team.color}28`, borderRadius:12, overflow:"hidden" }}>
                <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", cursor:"pointer" }} onClick={() => setOpenTeam(openTeam===team.id ? null : team.id)}>
                  <span style={{ width:9, height:9, borderRadius:"50%", background:team.color, flexShrink:0 }} />
                  <span style={{ flex:1, fontSize:13, fontWeight:600 }}>{team.name}</span>
                  <span style={{ fontSize:11, color:"rgba(255,255,255,0.28)", fontFamily:"monospace" }}>{team.memberJiraIds.length} member{team.memberJiraIds.length!==1?"s":""}</span>
                  <button onClick={e => { e.stopPropagation(); setTeams(t => t.filter(x => x.id!==team.id)); if(openTeam===team.id) setOpenTeam(null); }} style={{ background:"none", border:"none", cursor:"pointer", color:"rgba(255,80,80,0.45)", fontSize:15, padding:"0 4px" }}>×</button>
                  <span style={{ fontSize:10, color:"rgba(255,255,255,0.18)" }}>{openTeam===team.id?"▲":"▼"}</span>
                </div>
                {openTeam===team.id && (
                  <div style={{ padding:"10px 14px 14px", borderTop:"1px solid rgba(255,255,255,0.05)" }}>
                    <div style={{ fontSize:10, color:"rgba(255,255,255,0.25)", fontFamily:"monospace", marginBottom:8 }}>SELECT MEMBERS</div>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                      {jiraUsers.map(({ id, name }) => {
                        const checked = team.memberJiraIds.includes(id);
                        const other = !checked && memberOf(id);
                        return (
                          <button key={id} onClick={() => !other && toggleMember(team.id, id)} title={other?`Already in ${other.name}`:""} style={{ background:checked?`${team.color}22`:"rgba(255,255,255,0.04)", border:`1px solid ${checked?team.color+"55":"rgba(255,255,255,0.08)"}`, borderRadius:6, padding:"5px 10px", cursor:other?"not-allowed":"pointer", fontSize:11, fontFamily:"monospace", color:checked?team.color:other?"rgba(255,255,255,0.2)":"rgba(255,255,255,0.5)", opacity:other?0.5:1 }}>
                            {checked?"✓ ":""}{name.split(" ")[0]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// DASHBOARD (SQLite Dynamic Period Slicing + Sparklines)
// ═════════════════════════════════════════════════════════════════════════════
function Dashboard() {
  const [config, setConfig] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [trends, setTrends] = useState([]);
  const [mappings, setMappings] = useState({});
  const [teams, setTeams] = useState([]);

  const [tab, setTab] = useState("teams");
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [periodDays, setPeriodDays] = useState(90); // default 90D
  const [syncStatus, setSyncStatus] = useState("");

  const loadData = () => {
    const to = Date.now();
    const from = to - periodDays * 86400000;

    Promise.all([
      fetch(`${API_BASE}/api/config`).then(res => res.json()),
      fetch(`${API_BASE}/api/metrics?from=${from}&to=${to}`).then(res => res.json()),
      fetch(`${API_BASE}/api/trends?grain=week&periods=12`).then(res => res.json()),
      fetch(`${API_BASE}/api/mappings`).then(res => res.json())
    ]).then(([cfg, met, trnd, maps]) => {
      setConfig(cfg);
      setMetrics(met);
      setTrends(trnd.data || []);
      setTeams(maps.teams || []);
      
      const mappingDict = {};
      maps.mappings.forEach(m => { mappingDict[m.jira_id] = m.gh_login; });
      setMappings(mappingDict);

      if (maps.teams?.length && !selectedTeam) {
        setSelectedTeam(maps.teams[0].id);
      }
    }).catch(console.error);
  };

  useEffect(() => {
    loadData();
  }, [periodDays]);

  const handleSync = async () => {
    setSyncStatus("Syncing...");
    try {
      await streamSync((msg) => {
        if (msg.stage === "done") { setSyncStatus(""); loadData(); }
        else if (msg.stage === "error") { setSyncStatus("Sync error: " + msg.message); }
        else { setSyncStatus(msg.message); }
      });
    } catch(e) { setSyncStatus("Sync failed: " + e.message); }
  };

  // Sparkline data extraction from trends
  const trendCyclePR   = useMemo(() => trends.map(t => t.github.avgCycle || 0), [trends]);
  const trendMergeRate = useMemo(() => trends.map(t => t.github.merged || 0), [trends]);
  const trendJiraCycle = useMemo(() => trends.map(t => t.jira.avgCycle || 0), [trends]);
  const trendJiraDone  = useMemo(() => trends.map(t => t.jira.done || 0), [trends]);

  const developers = useMemo(() => {
    if (!metrics) return [];
    return Object.entries(metrics.jira.assigneeMap).map(([jiraId, ji]) => {
      const ghLogin = mappings[jiraId];
      const gh = ghLogin ? metrics.github.authorMap[ghLogin] : null;
      const team = teams.find(t => t.memberJiraIds.includes(jiraId));
      return {
        jiraId, name: ji.name, ghLogin: ghLogin||null, team: team||null,
        jiraDone: ji.done, jiraTotal: ji.total,
        jiraCycle: ji.done > 0 ? fmt1(ji.totalCycle/ji.done) : "—",
        ghPRs: gh?.prs||0,
        ghCycle: gh ? fmt1(gh.totalCycle/gh.prs) : "—",
      };
    });
  }, [metrics, mappings, teams]);

  const teamStats = useMemo(() => teams.map(team => {
    const members = developers.filter(d => d.team?.id === team.id);
    const totalPRs = members.reduce((s,d) => s+d.ghPRs, 0);
    const totalDone = members.reduce((s,d) => s+d.jiraDone, 0);
    const cycles = members.map(d => parseFloat(d.ghCycle)).filter(Number.isFinite);
    return { ...team, memberCount: members.length, totalPRs, totalDone, avgCycle: fmt1(avg(cycles)) };
  }), [teams, developers]);

  if (!metrics || !config) {
    return <div style={{ minHeight:"100vh", background:"#080c12", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontFamily:"monospace" }}>Loading DevPulse Engine...</div>;
  }

  const gh = metrics.github;
  const ji = metrics.jira;
  const activeTeam = teams.find(t => t.id === selectedTeam);
  const teamMembers = activeTeam ? developers.filter(d => d.team?.id === selectedTeam) : [];

  return (
    <div style={{ minHeight:"100vh", background:"#080c12", color:"#fff", fontFamily:"'DM Sans', sans-serif" }}>
      {/* Header */}
      <div style={{ borderBottom:"1px solid rgba(255,255,255,0.07)", padding:"13px 26px", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <span style={{ fontSize:11, letterSpacing:"0.2em", color:"rgba(255,255,255,0.22)", fontFamily:"monospace" }}>DEVPULSE</span>
          <span style={{ width:1, height:13, background:"rgba(255,255,255,0.1)" }} />
          <span style={{ fontSize:11, color:"rgba(255,255,255,0.3)", fontFamily:"monospace" }}>{config.gh.org}/{config.gh.repo} · {config.jira.project}</span>
        </div>

        {/* Dynamic Period Selector */}
        <div style={{ display:"flex", background:"rgba(255,255,255,0.03)", padding:3, borderRadius:8, border:"1px solid rgba(255,255,255,0.06)", marginRight:"auto", marginLeft:20 }}>
          {[7, 30, 90, 180, 365].map(days => (
            <button key={days} onClick={() => setPeriodDays(days)} style={{ background:periodDays===days?"#00ff88":"transparent", color:periodDays===days?"#080c12":"rgba(255,255,255,0.4)", border:"none", outline:"none", padding:"4px 10px", borderRadius:6, fontSize:10, fontWeight:700, fontFamily:"monospace", cursor:"pointer", transition:"all 0.15s" }}>
              {days === 365 ? "1Y" : days === 180 ? "6M" : `${days}D`}
            </button>
          ))}
        </div>

        <div style={{ display:"flex", alignItems:"center", gap:4, flexWrap:"wrap" }}>
          {teams.length > 0 && <Tab label="Teams" active={tab==="teams"} onClick={() => setTab("teams")} />}
          <Tab label="Developers" active={tab==="devs"} onClick={() => setTab("devs")} />
          <Tab label="GitHub" active={tab==="github"} onClick={() => setTab("github")} />
          <Tab label="Jira" active={tab==="jira"} onClick={() => setTab("jira")} />
          <Tab label="Review" active={tab==="review"} onClick={() => setTab("review")} />
          <Tab label="Security" active={tab==="security"} onClick={() => setTab("security")} />
          <Tab label="Config" active={tab==="config"} onClick={() => setTab("config")} />

          <button onClick={handleSync} disabled={!!syncStatus} style={{ background:"rgba(0,255,136,0.1)", border:"1px solid rgba(0,255,136,0.22)", borderRadius:8, padding:"6px 11px", color:"#00ff88", fontSize:11, cursor:"pointer", fontFamily:"monospace", marginLeft:4 }}>
            {syncStatus || "⚡ Sync DB"}
          </button>
        </div>
      </div>

      <div style={{ padding:"26px 26px" }}>
        {/* ── TEAMS ── */}
        {tab==="teams" && (
          <div>
            <div style={{ marginBottom:18 }}>
              <h2 style={{ margin:0, fontSize:17, fontWeight:700, letterSpacing:"-0.02em" }}>Team Overview</h2>
              <p style={{ margin:"4px 0 0", fontSize:11, color:"rgba(255,255,255,0.28)", fontFamily:"monospace" }}>{teams.length} active teams · parsed from SQLite</p>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(190px,1fr))", gap:10, marginBottom:22 }}>
              {teamStats.map(t => (
                <div key={t.id} onClick={() => setSelectedTeam(t.id)} style={{ background:selectedTeam===t.id?`${t.color}12`:"rgba(255,255,255,0.02)", border:`1px solid ${selectedTeam===t.id?t.color+"45":"rgba(255,255,255,0.07)"}`, borderRadius:12, padding:"15px 17px", cursor:"pointer", transition:"all 0.15s" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
                    <span style={{ width:9, height:9, borderRadius:"50%", background:t.color }} />
                    <span style={{ fontSize:13, fontWeight:600 }}>{t.name}</span>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                    {[["PRs",t.totalPRs],["Done",t.totalDone],["Cycle",t.avgCycle+(t.avgCycle!=="—"?"d":"")],["Devs",t.memberCount]].map(([l,v]) => (
                      <div key={l}>
                        <div style={{ fontSize:9, color:"rgba(255,255,255,0.22)", fontFamily:"monospace", textTransform:"uppercase", letterSpacing:"0.07em" }}>{l}</div>
                        <div style={{ fontSize:17, fontWeight:700, color:t.color, fontFamily:"monospace" }}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {activeTeam && (
              <div style={{ background:"rgba(255,255,255,0.02)", border:`1px solid ${activeTeam.color}28`, borderRadius:12, padding:18 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
                  <span style={{ width:9, height:9, borderRadius:"50%", background:activeTeam.color }} />
                  <span style={{ fontSize:13, fontWeight:700 }}>{activeTeam.name}</span>
                  <span style={{ fontSize:11, color:"rgba(255,255,255,0.25)", fontFamily:"monospace" }}>member breakdown</span>
                </div>
                {teamMembers.length > 0 ? (
                  <DataTable
                    columns={["Developer","GitHub","PRs","PR Cycle","Jira Done","Jira Cycle"]}
                    rows={teamMembers.map(d => [
                      { dot:activeTeam.color, label:d.name, color:"rgba(255,255,255,0.75)" },
                      d.ghLogin||{ label:"unlinked", color:"rgba(255,255,255,0.2)" },
                      d.ghPRs||"—", d.ghCycle !== "—" ? `${d.ghCycle}d` : "—", d.jiraDone, d.jiraCycle !== "—" ? `${d.jiraCycle}d` : "—"
                    ])}
                  />
                ) : (
                  <div style={{ textAlign:"center", padding:24, color:"rgba(255,255,255,0.2)", fontFamily:"monospace", fontSize:12 }}>No members assigned.</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── DEVELOPERS ── */}
        {tab==="devs" && (
          <div>
            <div style={{ marginBottom:18 }}>
              <h2 style={{ margin:0, fontSize:17, fontWeight:700, letterSpacing:"-0.02em" }}>All Developers</h2>
              <p style={{ margin:"4px 0 0", fontSize:11, color:"rgba(255,255,255,0.28)", fontFamily:"monospace" }}>Unified Jira + GitHub · {Object.values(mappings).filter(Boolean).length} linked devs</p>
            </div>
            <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:12, padding:18 }}>
              <DataTable
                columns={["Developer","Team","GitHub","PRs","PR Cycle","Jira Done","Jira Cycle"]}
                rows={developers.map(d => [
                  { dot:d.team?.color||"rgba(255,255,255,0.13)", label:d.name, color:"rgba(255,255,255,0.75)" },
                  d.team ? { label:d.team.name, color:d.team.color } : "—",
                  d.ghLogin || { label:"unlinked", color:"rgba(255,255,255,0.2)" },
                  d.ghPRs||"—", d.ghCycle !== "—" ? `${d.ghCycle}d` : "—", d.jiraDone, d.jiraCycle !== "—" ? `${d.jiraCycle}d` : "—"
                ])}
              />
            </div>
          </div>
        )}

        {/* ── GITHUB ── */}
        {tab==="github" && (
          <div>
            <div style={{ marginBottom:18 }}>
              <h2 style={{ margin:0, fontSize:17, fontWeight:700, letterSpacing:"-0.02em" }}>Pull Request Metrics</h2>
              <p style={{ margin:"4px 0 0", fontSize:11, color:"rgba(255,255,255,0.28)", fontFamily:"monospace" }}>Historical trends from SQLite cache</p>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:18 }}>
              <StatCard label="Avg Cycle Time" value={fmt1(gh.avgCycleTime)} unit="days" sub="open → merged" color="#00ff88" trendData={trendCyclePR} />
              <StatCard label="Merge Rate" value={gh.mergeRate} unit="/ week" sub={`trailing ${Math.round(periodDays/7)} weeks`} color="#00c4ff" trendData={trendMergeRate} />
              <StatCard label="PRs Merged" value={gh.totalMerged} unit="total" sub="in selected period" color="#a78bfa" trendData={trendMergeRate} />
              <StatCard label="Avg Review Time" value={fmt1(gh.avgReviewTime)} unit="days" sub="open → first review" color="#f59e0b" />
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:12, padding:18 }}>
                <div style={{ fontSize:10, color:"rgba(255,255,255,0.28)", letterSpacing:"0.1em", textTransform:"uppercase", fontFamily:"monospace", marginBottom:14 }}>Weekly Merge Rate</div>
                <MiniBar data={gh.weeks} color="#00ff88" />
                <div style={{ display:"flex", justifyContent:"space-between", marginTop:6 }}>
                  {gh.weeks.map((w,i) => <span key={i} style={{ fontSize:9, color:"rgba(255,255,255,0.15)", fontFamily:"monospace" }}>{w.label}</span>)}
                </div>
              </div>
              <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:12, padding:18 }}>
                <div style={{ fontSize:10, color:"rgba(255,255,255,0.28)", letterSpacing:"0.1em", textTransform:"uppercase", fontFamily:"monospace", marginBottom:12 }}>Contributors</div>
                <DataTable
                  columns={["Author","Team","PRs","Avg Cycle"]}
                  rows={Object.entries(gh.authorMap).sort((a,b) => b[1].prs-a[1].prs).slice(0,8).map(([login,d]) => {
                    const dev = developers.find(x => x.ghLogin===login);
                    return [
                      { dot:dev?.team?.color||"rgba(255,255,255,0.13)", label:login, color:"rgba(255,255,255,0.7)" },
                      dev?.team ? { label:dev.team.name, color:dev.team.color } : "—",
                      d.prs, fmt1(d.totalCycle/d.prs) + "d",
                    ];
                  })}
                />
              </div>
            </div>
          </div>
        )}

        {/* ── JIRA ── */}
        {tab==="jira" && (
          <div>
            <div style={{ marginBottom:18 }}>
              <h2 style={{ margin:0, fontSize:17, fontWeight:700, letterSpacing:"-0.02em" }}>Ticket Throughput & Velocity</h2>
              <p style={{ margin:"4px 0 0", fontSize:11, color:"rgba(255,255,255,0.28)", fontFamily:"monospace" }}>Historical Jira throughput</p>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:18 }}>
              <StatCard label="Throughput" value={ji.throughput} unit="/ week" sub={`closed / ${Math.round(periodDays/7)} weeks`} color="#00ff88" trendData={trendJiraDone} />
              <StatCard label="Avg Cycle Time" value={fmt1(ji.avgCycleTime)} unit="days" sub="created → resolved" color="#00c4ff" trendData={trendJiraCycle} />
              <StatCard label="Completed" value={ji.done} unit="issues" sub="resolved in period" color="#a78bfa" trendData={trendJiraDone} />
              <StatCard label="In Progress" value={ji.inProgress} unit="issues" sub="currently active" color="#f59e0b" />
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:12, padding:18 }}>
                <div style={{ fontSize:10, color:"rgba(255,255,255,0.28)", letterSpacing:"0.1em", textTransform:"uppercase", fontFamily:"monospace", marginBottom:14 }}>Weekly Velocity</div>
                <MiniBar data={ji.weeks} color="#00c4ff" />
                <div style={{ display:"flex", justifyContent:"space-between", marginTop:6 }}>
                  {ji.weeks.map((w,i) => <span key={i} style={{ fontSize:9, color:"rgba(255,255,255,0.15)", fontFamily:"monospace" }}>{w.label}</span>)}
                </div>
              </div>
              <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:12, padding:18 }}>
                <div style={{ fontSize:10, color:"rgba(255,255,255,0.28)", letterSpacing:"0.1em", textTransform:"uppercase", fontFamily:"monospace", marginBottom:12 }}>By Assignee</div>
                <DataTable
                  columns={["Assignee","Team","Done","Total","%"]}
                  rows={Object.entries(ji.assigneeMap).sort((a,b) => b[1].total-a[1].total).slice(0,10).map(([id,d]) => {
                    const dev = developers.find(x => x.jiraId===id);
                    const team = dev?.team;
                    return [
                      { dot:team?.color||"rgba(255,255,255,0.13)", label:d.name, color:"rgba(255,255,255,0.7)" },
                      team ? { label:team.name, color:team.color } : "—",
                      d.done, d.total, `${d.total > 0 ? Math.round((d.done/d.total)*100) : 0}%`,
                    ];
                  })}
                />
              </div>
            </div>
          </div>
        )}

        {/* ── SECURITY ── */}
        {tab==="security" && <SecurityTab />}

        {/* ── CONFIG ── */}
        {tab==="config" && <ConfigTab initialConfig={config} />}

        {/* ── REVIEW ── */}
        {tab==="review" && (
          <div>
            <div style={{ marginBottom:18 }}>
              <h2 style={{ margin:0, fontSize:17, fontWeight:700, letterSpacing:"-0.02em" }}>Code Review Health</h2>
              <p style={{ margin:"4px 0 0", fontSize:11, color:"rgba(255,255,255,0.28)", fontFamily:"monospace" }}>First-response and end-to-end review metrics</p>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:18 }}>
              <StatCard label="Time to First Review" value={fmt1(gh.avgReviewTime)} unit="days" sub="open → first review" color="#00ff88" />
              <StatCard label="PR Cycle Time" value={fmt1(gh.avgCycleTime)} unit="days" sub="open → merged" color="#00c4ff" trendData={trendCyclePR} />
              <StatCard label="Review Lag" value={fmt1(Math.max(0, gh.avgCycleTime - gh.avgReviewTime))} unit="days" sub="first review → merge" color="#f59e0b" />
            </div>
            <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:12, padding:20 }}>
              <div style={{ fontSize:10, color:"rgba(255,255,255,0.28)", letterSpacing:"0.1em", textTransform:"uppercase", fontFamily:"monospace", marginBottom:14 }}>Pipeline Breakdown</div>
              {[
                { label:"Open → First Review", value:gh.avgReviewTime, max:gh.avgCycleTime, color:"#00ff88" },
                { label:"First Review → Merge", value:Math.max(0,gh.avgCycleTime-gh.avgReviewTime), max:gh.avgCycleTime, color:"#f59e0b" },
              ].map(({ label, value, max, color }) => (
                <div key={label} style={{ marginBottom:14 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                    <span style={{ fontSize:12, color:"rgba(255,255,255,0.4)", fontFamily:"monospace" }}>{label}</span>
                    <span style={{ fontSize:12, color, fontFamily:"monospace", fontWeight:700 }}>{fmt1(value)}d</span>
                  </div>
                  <div style={{ height:5, borderRadius:3, background:"rgba(255,255,255,0.05)" }}>
                    <div style={{ height:"100%", borderRadius:3, background:color, width:`${Math.min(100,(value/(max||1))*100)}%`, transition:"width 0.8s" }} />
                  </div>
                </div>
              ))}
              {teams.length > 0 && (
                <div style={{ marginTop:18, paddingTop:14, borderTop:"1px solid rgba(255,255,255,0.05)" }}>
                  <div style={{ fontSize:10, color:"rgba(255,255,255,0.22)", fontFamily:"monospace", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:10 }}>By Team</div>
                  <DataTable
                    columns={["Team","Members","Total PRs","Avg Cycle"]}
                    rows={teamStats.map(t => [
                      { dot:t.color, label:t.name, color:t.color },
                      t.memberCount, t.totalPRs, t.avgCycle !== "—" ? `${t.avgCycle}d` : "—",
                    ])}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// CONFIG TAB (inline settings)
// ═════════════════════════════════════════════════════════════════════════════
function ConfigTab({ initialConfig }) {
  const [gh, setGh] = useState({ token:"", org: initialConfig?.gh?.org||"", repo: initialConfig?.gh?.repo||"" });
  const [jira, setJira] = useState({ token:"", email: initialConfig?.jira?.email||"", domain: initialConfig?.jira?.domain||"", project: initialConfig?.jira?.project||"" });
  const [loading, setLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState("");
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setErr(""); setSaved(false); setLoading(true); setSyncStatus("Saving configuration...");
    try {
      const res = await fetch(`${API_BASE}/api/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gh, jira })
      });
      if (!res.ok) throw new Error("Failed to save configuration");
      setSyncStatus("Syncing data...");
      await streamSync((msg) => {
        if (msg.stage === "done") { setSyncStatus(""); setSaved(true); setLoading(false); }
        else if (msg.stage === "error") { setErr(msg.message); setLoading(false); }
        else { setSyncStatus(msg.message); }
      });
    } catch(e) { setErr(e.message); setLoading(false); }
  };

  const allFilled = gh.token && gh.org;

  return (
    <div>
      <div style={{ marginBottom:18 }}>
        <h2 style={{ margin:0, fontSize:17, fontWeight:700, letterSpacing:"-0.02em" }}>Configuration</h2>
        <p style={{ margin:"4px 0 0", fontSize:11, color:"rgba(255,255,255,0.28)", fontFamily:"monospace" }}>GitHub and Jira credentials — stored locally in SQLite</p>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, maxWidth:820 }}>
        <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:12, padding:20 }}>
          <div style={{ fontSize:10, color:"rgba(255,255,255,0.28)", letterSpacing:"0.12em", textTransform:"uppercase", fontFamily:"monospace", marginBottom:14 }}>GitHub</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <ConfigField label="Personal Access Token" placeholder="ghp_..." type="password" value={gh.token} onChange={v => setGh(p=>({...p,token:v}))} full />
            <ConfigField label="Owner / Org" placeholder="my-org" value={gh.org} onChange={v => setGh(p=>({...p,org:v}))} />
            <ConfigField label="Repository (optional)" placeholder="leave blank for all org repos" value={gh.repo} onChange={v => setGh(p=>({...p,repo:v}))} />
          </div>
        </div>
        <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:12, padding:20 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
            <div style={{ fontSize:10, color:"rgba(255,255,255,0.28)", letterSpacing:"0.12em", textTransform:"uppercase", fontFamily:"monospace" }}>Jira</div>
            <div style={{ fontSize:10, color:"rgba(255,255,255,0.18)", fontFamily:"monospace" }}>— optional</div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <ConfigField label="API Token" placeholder="ATATT..." type="password" value={jira.token} onChange={v => setJira(p=>({...p,token:v}))} full />
            <ConfigField label="Email" placeholder="you@company.com" value={jira.email} onChange={v => setJira(p=>({...p,email:v}))} />
            <ConfigField label="Domain" placeholder="myco.atlassian.net" value={jira.domain} onChange={v => setJira(p=>({...p,domain:v}))} />
            <ConfigField label="Project Key" placeholder="ENG" value={jira.project} onChange={v => setJira(p=>({...p,project:v}))} />
          </div>
        </div>
      </div>
      <div style={{ marginTop:14, maxWidth:820 }}>
        {err && <div style={{ background:"rgba(255,60,60,0.1)", border:"1px solid rgba(255,60,60,0.2)", borderRadius:8, padding:"10px 14px", color:"#ff6b6b", fontSize:12, fontFamily:"monospace", marginBottom:12 }}>{err}</div>}
        {loading && <div style={{ background:"rgba(0,255,136,0.06)", border:"1px solid rgba(0,255,136,0.15)", borderRadius:8, padding:"10px 14px", color:"#00ff88", fontSize:12, fontFamily:"monospace", marginBottom:12 }}>⏳ {syncStatus}</div>}
        {saved && !loading && <div style={{ background:"rgba(0,255,136,0.06)", border:"1px solid rgba(0,255,136,0.15)", borderRadius:8, padding:"10px 14px", color:"#00ff88", fontSize:12, fontFamily:"monospace", marginBottom:12 }}>✓ Saved and synced</div>}
        <button onClick={handleSave} disabled={loading||!allFilled} style={{ padding:"11px 28px", borderRadius:9, border:"none", background:loading||!allFilled?"rgba(255,255,255,0.07)":"linear-gradient(135deg,#00ff88,#00c4ff)", color:loading||!allFilled?"rgba(255,255,255,0.25)":"#080c12", fontSize:12, fontWeight:700, cursor:loading||!allFilled?"not-allowed":"pointer", fontFamily:"monospace", letterSpacing:"0.05em" }}>
          {loading ? "SAVING & SYNCING..." : "SAVE & SYNC →"}
        </button>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// SECURITY TAB
// ═════════════════════════════════════════════════════════════════════════════
const SEV_COLOR = { critical: "#ff4444", high: "#f59e0b", medium: "#fbbf24", low: "#94a3b8" };
const SUB_STAGE_LABELS = {
  secrets: 'scanning source files for secrets…',
  git_history: 'scanning git history…',
  dependencies: 'auditing dependencies…',
  supply_chain: 'scanning for supply chain threats…',
  cve_lockfile: 'scanning lockfile for CVEs…',
};

function FindingsSection({ title, icon, items }) {
  const [open, setOpen] = useState(true);
  if (!items.length) return null;
  return (
    <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:10, marginBottom:10, overflow:"hidden" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 14px", cursor:"pointer", borderBottom: open ? "1px solid rgba(255,255,255,0.05)" : "none" }} onClick={() => setOpen(o => !o)}>
        <span style={{ fontSize:13 }}>{icon}</span>
        <span style={{ flex:1, fontSize:12, fontWeight:600 }}>{title}</span>
        <span style={{ fontSize:11, color:"rgba(255,255,255,0.3)", fontFamily:"monospace" }}>{items.length} finding{items.length !== 1 ? "s" : ""}</span>
        <span style={{ fontSize:10, color:"rgba(255,255,255,0.2)" }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{ maxHeight:340, overflowY:"auto" }}>
          {items.map((f, i) => {
            const c = SEV_COLOR[f.severity] || "#fff";
            return (
              <div key={i} style={{ padding:"8px 14px", borderBottom:"1px solid rgba(255,255,255,0.03)", display:"flex", gap:10, alignItems:"flex-start" }}>
                <span style={{ fontSize:9, fontFamily:"monospace", fontWeight:700, color:c, background:`${c}18`, border:`1px solid ${c}35`, borderRadius:4, padding:"2px 6px", flexShrink:0, marginTop:2 }}>
                  {(f.severity||"info").toUpperCase()}
                </span>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:2 }}>
                    <span style={{ fontSize:11, color:"rgba(255,255,255,0.65)", fontFamily:"monospace", fontWeight:600 }}>{f.rule}</span>
                    <span style={{ fontSize:10, color:"rgba(255,255,255,0.25)", fontFamily:"monospace" }}>
                      {f.file}{f.line ? `:${f.line}` : ""}{f.commit ? ` @${f.commit}` : ""}
                    </span>
                  </div>
                  {f.snippet && (
                    <div style={{ fontSize:10, color:"rgba(255,255,255,0.28)", fontFamily:"monospace", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {f.snippet}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SecurityTab() {
  const [workspaces, setWorkspaces] = useState([]);
  const [wsLoading, setWsLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [scanState, setScanState] = useState(null);
  const [scanMsg, setScanMsg] = useState("");
  const [findings, setFindings] = useState({ secrets:[], history:[], deps:[], bumblebee:[], local_threat_intel:[], osv:[] });
  const abortRef = { current: null };

  // Summary / history state
  const [summary, setSummary] = useState(null);
  const [trends, setTrends] = useState([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [scanAllState, setScanAllState] = useState(null);
  const [scanAllProgress, setScanAllProgress] = useState(null);
  const [threatIntelState, setThreatIntelState] = useState(null); // null | "updating" | "done" | "error"
  const [threatIntelResult, setThreatIntelResult] = useState(null);

  // Navigation state — right panel shows timeline, repo detail, or day detail
  const [detailView, setDetailView] = useState(null); // null (timeline) | { type: 'repo', data } | { type: 'day', data }
  const [detailLoading, setDetailLoading] = useState(false);

  const loadWorkspaces = () => {
    fetch(`${API_BASE}/api/security/workspaces`)
      .then(r => r.json())
      .then(d => { setWorkspaces(d.repos || []); setWsLoading(false); })
      .catch(() => setWsLoading(false));
  };

  useEffect(() => {
    loadWorkspaces();
    loadSummary();
  }, []);

  const loadSummary = async () => {
    setSummaryLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/security/history`);
      if (res.ok) {
        const d = await res.json();
        setSummary(d.summary);
        setTrends(d.trends || []);
      }
    } catch {} finally {
      setSummaryLoading(false);
    }
  };

  const fetchRepoDetail = async (repoPath) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/security/repo/${encodeURIComponent(repoPath)}`);
      if (res.ok) {
        const data = await res.json();
        setDetailView({ type: 'repo', data });
      }
    } catch {} finally {
      setDetailLoading(false);
    }
  };

  const fetchDayDetail = async (scannedAt) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/security/scans-at?scanned_at=${scannedAt}`);
      if (res.ok) {
        const data = await res.json();
        setDetailView({ type: 'day', data });
      }
    } catch {} finally {
      setDetailLoading(false);
    }
  };

  const startScanAll = async () => {
    setScanAllState("scanning");
    setDetailView(null);
    setSelected(null);

    try {
      const res = await fetch(`${API_BASE}/api/security/scan-all`, { method: "POST" });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() || "";
        for (const part of parts) {
          for (const line of part.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            try {
              const msg = JSON.parse(line.slice(6));
              if (msg.stage === "progress") {
                setScanAllProgress(msg);
              } else if (msg.stage === "done") {
                setScanAllState("done");
                setScanAllProgress(null);
                loadSummary();
                loadWorkspaces();
              } else if (msg.stage === "error") {
                setScanAllState("error");
              }
            } catch {}
          }
        }
      }
    } catch {
      setScanAllState("error");
    }
  };

  const updateThreatIntel = async () => {
    setThreatIntelState("updating");
    setThreatIntelResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/security/update-threat-intel`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setThreatIntelResult(data);
      setThreatIntelState("done");
      setTimeout(() => setThreatIntelState(null), 4000);
    } catch (e) {
      setThreatIntelResult({ error: e.message });
      setThreatIntelState("error");
      setTimeout(() => setThreatIntelState(null), 5000);
    }
  };

  const startScan = async (path) => {
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setSelected(path);
    setDetailView(null);
    setScanState("scanning");
    setScanMsg("Initializing…");
    setFindings({ secrets:[], history:[], deps:[], bumblebee:[], local_threat_intel:[], osv:[] });

    try {
      const res = await fetch(`${API_BASE}/api/security/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
        signal: ctrl.signal,
      });

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() || "";
        for (const part of parts) {
          for (const line of part.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            try {
              const msg = JSON.parse(line.slice(6));
              if (msg.stage === "secrets_done") {
                setFindings(f => ({ ...f, secrets: msg.findings }));
                setScanMsg(`${msg.count} secret finding(s) — scanning git history…`);
              } else if (msg.stage === "history_done") {
                setFindings(f => ({ ...f, history: msg.findings }));
                setScanMsg(`${msg.count} history finding(s) — auditing dependencies…`);
              } else if (msg.stage === "deps_done") {
                setFindings(f => ({ ...f, deps: msg.findings }));
                setScanMsg("Scanning installed packages for supply chain threats…");
              } else if (msg.stage === "bumblebee_done") {
                setFindings(f => ({ ...f, bumblebee: msg.findings }));
                setScanMsg("Checking packages against local threat intelligence…");
              } else if (msg.stage === "local_threat_intel_done") {
                setFindings(f => ({ ...f, local_threat_intel: msg.findings }));
                setScanMsg("Supply chain scan complete — scanning lockfile for CVEs…");
              } else if (msg.stage === "osv_done") {
                setFindings(f => ({ ...f, osv: msg.findings }));
                setScanMsg("Finalizing…");
              } else if (msg.stage === "done") {
                setScanState("done");
                setScanMsg("");
                loadSummary();
              } else if (msg.stage === "error") {
                setScanState("error");
                setScanMsg(msg.message);
              } else {
                setScanMsg(msg.message);
              }
            } catch {}
          }
        }
      }
    } catch (e) {
      if (e.name !== "AbortError") { setScanState("error"); setScanMsg(e.message); }
    }
  };

  const allFindings = [...findings.secrets, ...findings.history, ...findings.deps, ...findings.bumblebee, ...findings.local_threat_intel, ...findings.osv];
  const counts = { critical:0, high:0, medium:0 };
  allFindings.forEach(f => { if (counts[f.severity] !== undefined) counts[f.severity]++; });
  const hasResults = scanState === "done" || (scanState === "scanning" && allFindings.length > 0);

  const backBtn = {
    background:"none", border:"1px solid rgba(255,255,255,0.1)", borderRadius:6,
    padding:"6px 12px", color:"rgba(255,255,255,0.5)", fontSize:11,
    fontFamily:"monospace", cursor:"pointer", marginBottom:12,
  };

  return (
    <div>
      <div style={{ marginBottom:16, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div>
          <h2 style={{ margin:0, fontSize:17, fontWeight:700, letterSpacing:"-0.02em" }}>Security Scanner</h2>
          <p style={{ margin:"4px 0 0", fontSize:11, color:"rgba(255,255,255,0.28)", fontFamily:"monospace" }}>
            Secret detection · git history · dependency audit · supply chain · CVE lockfile — local workspaces only
          </p>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          {scanAllState === "scanning" && scanAllProgress && (
            <span style={{ fontSize:11, color:"#00ff88", fontFamily:"monospace" }}>
              {scanAllProgress.repo} ({scanAllProgress.current}/{scanAllProgress.total})
              {scanAllProgress.subStage && ` · ${SUB_STAGE_LABELS[scanAllProgress.subStage] || scanAllProgress.subStage}`}
            </span>
          )}
          {threatIntelState === "done" && threatIntelResult && (
            <span style={{ fontSize:11, color:"#a78bfa", fontFamily:"monospace" }}>
              ✓ {threatIntelResult.updated} feed{threatIntelResult.updated !== 1 ? "s" : ""} updated
            </span>
          )}
          {threatIntelState === "error" && threatIntelResult && (
            <span style={{ fontSize:11, color:"#ff4444", fontFamily:"monospace" }}>
              ✗ {threatIntelResult.error}
            </span>
          )}
          <button
            onClick={updateThreatIntel}
            disabled={threatIntelState === "updating"}
            title="Download latest threat intel feeds from perplexityai/bumblebee"
            style={{ background:"rgba(167,139,250,0.09)", border:"1px solid rgba(167,139,250,0.22)", borderRadius:6, padding:"7px 14px", color:"#a78bfa", fontSize:11, fontFamily:"monospace", cursor:"pointer", fontWeight:700, letterSpacing:"0.04em" }}
          >
            {threatIntelState === "updating" ? "⏳ UPDATING…" : "⬇ UPDATE THREAT INTEL"}
          </button>
          <button
            onClick={startScanAll}
            disabled={scanAllState === "scanning"}
            style={{ background:"rgba(0,255,136,0.09)", border:"1px solid rgba(0,255,136,0.22)", borderRadius:6, padding:"7px 14px", color:"#00ff88", fontSize:11, fontFamily:"monospace", cursor:"pointer", fontWeight:700, letterSpacing:"0.04em" }}
          >
            {scanAllState === "scanning" ? "⏳ SCANNING ALL…" : "⚡ SCAN ALL"}
          </button>
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"260px 1fr", gap:14, alignItems:"start" }}>
        {/* ── Left: workspace list ── */}
        <div>
          <div style={{ fontSize:10, color:"rgba(255,255,255,0.22)", fontFamily:"monospace", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:8 }}>
            {wsLoading ? "Detecting repos…" : `${workspaces.length} repos detected`}
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:5, maxHeight:"calc(100vh - 240px)", overflowY:"auto" }}>
            {workspaces.map(ws => {
              const isSelected = selected === ws.path;
              const sec = ws.security;
              const dotColor = !sec ? "rgba(255,255,255,0.08)" : sec.critical > 0 ? "#ff4444" : sec.high > 0 ? "#f59e0b" : sec.medium > 0 ? "#fbbf24" : sec.total === 0 ? "#00ff88" : "rgba(255,255,255,0.08)";
              return (
                <div key={ws.path} style={{ background:isSelected?"rgba(0,255,136,0.06)":"rgba(255,255,255,0.02)", border:`1px solid ${isSelected?"rgba(0,255,136,0.25)":"rgba(255,255,255,0.06)"}`, borderRadius:9, padding:"9px 12px", cursor:"pointer", transition:"all 0.12s" }} onClick={() => { setSelected(ws.path); setScanState(null); setScanMsg(""); fetchRepoDetail(ws.path); }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:2 }}>
                    <div style={{ width:8, height:8, borderRadius:"50%", background:dotColor, flexShrink:0 }} title={!sec ? "not scanned" : `${sec.critical} critical · ${sec.high} high · ${sec.medium} medium`} />
                    <div style={{ fontSize:12, color:"rgba(255,255,255,0.72)", fontFamily:"monospace", fontWeight:600 }}>{ws.name}</div>
                  </div>
                  {ws.lastCommit && <div style={{ fontSize:10, color:"rgba(255,255,255,0.2)", fontFamily:"monospace", marginBottom:6 }}>{ws.lastCommit}</div>}
                  <button
                    onClick={e => { e.stopPropagation(); startScan(ws.path); }}
                    disabled={scanState === "scanning" && selected === ws.path}
                    style={{ width:"100%", background:"rgba(0,255,136,0.09)", border:"1px solid rgba(0,255,136,0.22)", borderRadius:5, padding:"4px 0", color:"#00ff88", fontSize:10, fontFamily:"monospace", cursor:"pointer", fontWeight:700, letterSpacing:"0.06em" }}
                  >
                    {scanState === "scanning" && isSelected ? "⏳ SCANNING…" : "⚡ SCAN"}
                  </button>
                </div>
              );
            })}
            {!wsLoading && !workspaces.length && (
              <div style={{ color:"rgba(255,255,255,0.2)", fontFamily:"monospace", fontSize:11, padding:"12px 0" }}>
                No git repos found in common locations.
              </div>
            )}
          </div>
        </div>

        {/* ── Right: results / detail / timeline ── */}
        <div>
          {detailView && !hasResults && (
            <button onClick={() => setDetailView(null)} style={backBtn}>← Back to timeline</button>
          )}
          {hasResults ? (
            <div>
              <button onClick={() => { setDetailView(null); setScanState(null); setFindings({ secrets:[], history:[], deps:[], bumblebee:[], local_threat_intel:[], osv:[] }); }} style={backBtn}>← Back to timeline</button>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:14 }}>
                {[["Critical", counts.critical, "#ff4444"], ["High", counts.high, "#f59e0b"], ["Medium", counts.medium, "#fbbf24"]].map(([label, count, color]) => (
                  <div key={label} style={{ background:"rgba(255,255,255,0.02)", border:`1px solid ${color}22`, borderRadius:8, padding:"12px 16px" }}>
                    <div style={{ fontSize:9, color:"rgba(255,255,255,0.28)", fontFamily:"monospace", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:4 }}>{label}</div>
                    <div style={{ fontSize:26, fontWeight:700, color, fontFamily:"monospace", lineHeight:1 }}>{count}</div>
                  </div>
                ))}
              </div>
              {scanState === "scanning" && (
                <div style={{ fontSize:11, color:"rgba(0,255,136,0.7)", fontFamily:"monospace", marginBottom:12 }}>⏳ {scanMsg}</div>
              )}
              <FindingsSection title="Source File Secrets"           icon="🔑" items={findings.secrets} />
              <FindingsSection title="Git History Secrets"           icon="📜" items={findings.history} />
              <FindingsSection title="Dependency Vulnerabilities"    icon="📦" items={findings.deps} />
              <FindingsSection title="Supply Chain (bumblebee)"      icon="🐝" items={findings.bumblebee} />
              <FindingsSection title="Threat Intelligence"           icon="⚠️" items={findings.local_threat_intel} />
              <FindingsSection title="CVE Lockfile (osv-scanner)"    icon="🛡️" items={findings.osv} />
              {scanState === "done" && !allFindings.length && (
                <div style={{ background:"rgba(0,255,136,0.05)", border:"1px solid rgba(0,255,136,0.2)", borderRadius:10, padding:22, textAlign:"center", color:"#00ff88", fontFamily:"monospace", fontSize:13 }}>
                  ✓ No significant security issues found
                </div>
              )}
            </div>
          ) : detailView?.type === 'repo' ? (
            <SecurityRepoDetail
              data={detailView.data}
              loading={detailLoading}
              onScan={() => startScan(detailView.data.repoPath)}
            />
          ) : detailView?.type === 'day' ? (
            <SecurityDayDetail
              data={detailView.data}
              loading={detailLoading}
              onRepoClick={(path) => fetchRepoDetail(path)}
            />
          ) : selected && scanState === "scanning" && !hasResults ? (
            <div style={{ background:"rgba(0,255,136,0.04)", border:"1px solid rgba(0,255,136,0.15)", borderRadius:10, padding:"18px 20px" }}>
              <div style={{ color:"#00ff88", fontFamily:"monospace", fontSize:12 }}>⏳ {scanMsg}</div>
            </div>
          ) : selected && scanState === "error" ? (
            <div style={{ background:"rgba(255,60,60,0.06)", border:"1px solid rgba(255,60,60,0.2)", borderRadius:10, padding:"18px 20px" }}>
              <div style={{ color:"#ff6b6b", fontFamily:"monospace", fontSize:12 }}>⚠ {scanMsg}</div>
            </div>
          ) : (
            <SecuritySummary
              summary={summary}
              trends={trends}
              loading={summaryLoading}
              scanAllState={scanAllState}
              onScanAll={startScanAll}
              onBarClick={fetchDayDetail}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function SecuritySummary({ summary, trends, loading, scanAllState, onScanAll, onBarClick }) {
  if (loading) {
    return (
      <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:260, color:"rgba(255,255,255,0.15)", fontFamily:"monospace", fontSize:12, border:"1px dashed rgba(255,255,255,0.08)", borderRadius:10 }}>
        Loading summary…
      </div>
    );
  }

  if (!summary || summary.repos === 0) {
    return (
      <div>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:160, color:"rgba(255,255,255,0.15)", fontFamily:"monospace", fontSize:12, border:"1px dashed rgba(255,255,255,0.08)", borderRadius:10, marginBottom:12 }}>
          No scan data yet — click "Scan All" to run the first scan
        </div>
      </div>
    );
  }

  const maxTrendVal = Math.max(...trends.map(t => Number(t.total) || 0), 1);
  const maxH = 60;

  return (
    <div>
      {/* Severity cards */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:14 }}>
        <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:8, padding:"12px 16px" }}>
          <div style={{ fontSize:9, color:"rgba(255,255,255,0.28)", fontFamily:"monospace", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:4 }}>Repos</div>
          <div style={{ fontSize:26, fontWeight:700, color:"rgba(255,255,255,0.6)", fontFamily:"monospace", lineHeight:1 }}>{summary.repos}</div>
        </div>
        {[["Critical", summary.critical, "#ff4444"], ["High", summary.high, "#f59e0b"], ["Medium", summary.medium, "#fbbf24"]].map(([label, count, color]) => (
          <div key={label} style={{ background:"rgba(255,255,255,0.02)", border:`1px solid ${color}22`, borderRadius:8, padding:"12px 16px" }}>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.28)", fontFamily:"monospace", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:4 }}>{label}</div>
            <div style={{ fontSize:26, fontWeight:700, color, fontFamily:"monospace", lineHeight:1 }}>{count}</div>
          </div>
        ))}
      </div>

      {/* Trend chart */}
      {trends.length > 0 && (
        <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:8, padding:"14px 16px", marginBottom:14 }}>
          <div style={{ fontSize:10, color:"rgba(255,255,255,0.28)", fontFamily:"monospace", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>Findings Over Time</div>
          <div style={{ display:"flex", alignItems:"flex-end", gap:4, height:maxH + 20, paddingBottom:8 }}>
              {trends.map((t, i) => {
              const h = maxTrendVal > 0 ? (Number(t.total) / maxTrendVal) * maxH : 0;
              const date = new Date(Number(t.scanned_at));
              const label = `${date.getMonth() + 1}/${date.getDate()}`;
              return (
                <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:3, cursor:onBarClick?"pointer":"default" }} onClick={() => onBarClick && onBarClick(t.scanned_at)}>
                  <span style={{ fontSize:9, color:"rgba(255,255,255,0.2)", fontFamily:"monospace" }}>{t.total}</span>
                  <div style={{ width:"100%", height:Math.max(h, 2), background:Number(t.critical) > 0 ? "#ff4444" : Number(t.high) > 0 ? "#f59e0b" : "rgba(0,255,136,0.4)", borderRadius:"3px 3px 0 0", minHeight:2, transition:"height 0.3s" }} title={`${label}: ${t.total} findings (${t.critical} critical, ${t.high} high, ${t.medium} medium)`} />
                  <span style={{ fontSize:8, color:"rgba(255,255,255,0.15)", fontFamily:"monospace" }}>{label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ fontSize:10, color:"rgba(255,255,255,0.18)", fontFamily:"monospace", textAlign:"center", padding:"4px 0" }}>
        {summary.total} total findings across {summary.repos} repos · last scan: {new Date(trends[trends.length - 1]?.scanned_at || Date.now()).toLocaleDateString()}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// REPO DETAIL VIEW
// ═════════════════════════════════════════════════════════════════════════════
function SecurityRepoDetail({ data, loading, onScan, onBack }) {
  const [selectedSeverity, setSelectedSeverity] = React.useState(null);
  const [findings, setFindings] = React.useState([]);
  const [findingsLoading, setFindingsLoading] = React.useState(false);

  if (loading) {
    return <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:260, color:"rgba(255,255,255,0.15)", fontFamily:"monospace", fontSize:12, border:"1px dashed rgba(255,255,255,0.08)", borderRadius:10 }}>Loading repo details…</div>;
  }

  const { latest, history } = data;
  const maxVal = Math.max(...(history || []).map(h => Number(h.total) || 0), 1);
  const maxH = 50;

  const handleSeverityClick = (severity) => {
    if (!latest || severity === 'Total' || Number(latest[severity.toLowerCase()]) === 0) return;
    const sev = severity.toLowerCase();
    if (selectedSeverity === sev) {
      setSelectedSeverity(null);
      setFindings([]);
      return;
    }
    setSelectedSeverity(sev);
    setFindingsLoading(true);
    fetch(`/api/security/findings?repoPath=${encodeURIComponent(data.repoPath)}&severity=${sev}`)
      .then(r => r.json())
      .then(d => { setFindings(d.findings); setFindingsLoading(false); })
      .catch(() => { setFindings([]); setFindingsLoading(false); });
  };

  return (
    <div>
      <div style={{ marginBottom:16 }}>
        <div style={{ fontSize:16, fontWeight:700, fontFamily:"monospace", marginBottom:2 }}>{latest?.repo_name || data.repoPath?.split('/').pop()}</div>
        <div style={{ fontSize:10, color:"rgba(255,255,255,0.25)", fontFamily:"monospace", wordBreak:"break-all" }}>{data.repoPath}</div>
      </div>

      {latest ? (
        <div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:14 }}>
            {[["Total", latest.total, "rgba(255,255,255,0.5)"], ["Critical", latest.critical, "#ff4444"], ["High", latest.high, "#f59e0b"], ["Medium", latest.medium, "#fbbf24"]].map(([label, count, color]) => {
              const sev = label.toLowerCase();
              const isActive = selectedSeverity === sev;
              return (
                <div key={label}
                  onClick={() => handleSeverityClick(label)}
                  style={{ cursor: label !== 'Total' && count > 0 ? 'pointer' : 'default', background: isActive ? `${color}22` : "rgba(255,255,255,0.02)", border:`1px solid ${isActive ? color : color + '22'}`, borderRadius:8, padding:"12px 16px", transition:"background 0.2s, border-color 0.2s" }}>
                  <div style={{ fontSize:9, color:"rgba(255,255,255,0.28)", fontFamily:"monospace", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:4 }}>{label}</div>
                  <div style={{ fontSize:26, fontWeight:700, color, fontFamily:"monospace", lineHeight:1 }}>{count}</div>
                </div>
              );
            })}
          </div>

          {selectedSeverity && (
            <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:8, padding:"12px 16px", marginBottom:14 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                <span style={{ fontSize:10, color:"rgba(255,255,255,0.28)", fontFamily:"monospace", textTransform:"uppercase", letterSpacing:"0.1em" }}>{selectedSeverity} findings ({findings.length})</span>
                <span onClick={() => { setSelectedSeverity(null); setFindings([]); }} style={{ fontSize:10, color:"rgba(255,255,255,0.2)", cursor:"pointer", fontFamily:"monospace" }}>✕</span>
              </div>
              {findingsLoading ? (
                <div style={{ fontSize:11, color:"rgba(255,255,255,0.15)", fontFamily:"monospace", padding:"8px 0" }}>Loading findings…</div>
              ) : findings.length === 0 ? (
                <div style={{ fontSize:11, color:"rgba(255,255,255,0.15)", fontFamily:"monospace", padding:"8px 0" }}>No {selectedSeverity} findings in latest scan.</div>
              ) : (
                <div style={{ maxHeight:260, overflowY:"auto", display:"flex", flexDirection:"column", gap:6 }}>
                  {findings.map((f, i) => (
                    <div key={i} style={{ borderLeft:`3px solid ${selectedSeverity === 'critical' ? '#ff4444' : selectedSeverity === 'high' ? '#f59e0b' : '#fbbf24'}`, paddingLeft:10, fontSize:11, fontFamily:"monospace", lineHeight:1.5 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        <span style={{ color:"rgba(255,255,255,0.5)", fontWeight:600 }}>{f.rule}</span>
                        {f.commit && (
                          <span
                            onClick={() => navigator.clipboard.writeText(`git show ${f.commit}`)}
                            title="Copy git show command"
                            style={{ fontSize:9, color:"rgba(255,255,255,0.15)", cursor:"pointer", background:"rgba(255,255,255,0.04)", borderRadius:4, padding:"1px 6px", fontFamily:"monospace" }}
                          >{f.commit} ⎘</span>
                        )}
                      </div>
                      <div style={{ color:"rgba(255,255,255,0.2)", fontSize:10 }}>{f.file}{f.line ? `:${f.line}` : ''} · {f.type}</div>
                      <div style={{ color:"rgba(255,255,255,0.3)", fontSize:10, wordBreak:"break-all" }}>{f.snippet}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:6, marginBottom:16 }}>
            {[["Secrets", latest.secrets], ["Git History", latest.history], ["Deps", latest.deps], ["Bumblebee", latest.bumblebee], ["Threat Intel", latest.local_threat_intel], ["OSV", latest.osv]].map(([label, count]) => (
              <div key={label} style={{ textAlign:"center", background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:6, padding:"8px 6px" }}>
                <div style={{ fontSize:15, fontWeight:700, color:"rgba(255,255,255,0.6)", fontFamily:"monospace" }}>{count}</div>
                <div style={{ fontSize:8, color:"rgba(255,255,255,0.2)", fontFamily:"monospace", marginTop:2 }}>{label}</div>
              </div>
            ))}
          </div>

          {history && history.length > 1 && (
            <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:8, padding:"14px 16px", marginBottom:14 }}>
              <div style={{ fontSize:10, color:"rgba(255,255,255,0.28)", fontFamily:"monospace", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10 }}>Scan History</div>
              <div style={{ display:"flex", alignItems:"flex-end", gap:4, height:maxH + 20, paddingBottom:8 }}>
                {history.map((h, i) => {
                  const barH = maxVal > 0 ? (Number(h.total) / maxVal) * maxH : 0;
                  const d = new Date(Number(h.scanned_at));
                  return (
                    <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
                      <span style={{ fontSize:8, color:"rgba(255,255,255,0.2)", fontFamily:"monospace" }}>{h.total}</span>
                      <div style={{ width:"100%", height:Math.max(barH, 2), background:Number(h.critical) > 0 ? "#ff4444" : Number(h.high) > 0 ? "#f59e0b" : "rgba(0,255,136,0.4)", borderRadius:"3px 3px 0 0", minHeight:2 }} title={`${d.toLocaleDateString()}: ${h.total} findings`} />
                      <span style={{ fontSize:7, color:"rgba(255,255,255,0.12)", fontFamily:"monospace" }}>{`${d.getMonth() + 1}/${d.getDate()}`}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ fontSize:10, color:"rgba(255,255,255,0.18)", fontFamily:"monospace", textAlign:"center", marginBottom:14 }}>
            Last scanned: {new Date(Number(latest.scanned_at)).toLocaleString()} · {history?.length || 0} total scans
          </div>
        </div>
      ) : (
        <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:120, color:"rgba(255,255,255,0.15)", fontFamily:"monospace", fontSize:12, border:"1px dashed rgba(255,255,255,0.08)", borderRadius:10, marginBottom:14 }}>
          No scan data yet
        </div>
      )}

      <button onClick={onScan} style={{ width:"100%", background:"rgba(0,255,136,0.09)", border:"1px solid rgba(0,255,136,0.22)", borderRadius:6, padding:"8px 0", color:"#00ff88", fontSize:11, fontFamily:"monospace", cursor:"pointer", fontWeight:700, letterSpacing:"0.04em" }}>
        ⚡ SCAN THIS REPO
      </button>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// DAY DETAIL VIEW
// ═════════════════════════════════════════════════════════════════════════════
function SecurityDayDetail({ data, loading, onRepoClick, onBack }) {
  if (loading) {
    return <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:260, color:"rgba(255,255,255,0.15)", fontFamily:"monospace", fontSize:12, border:"1px dashed rgba(255,255,255,0.08)", borderRadius:10 }}>Loading day details…</div>;
  }

  const { scannedAt, scans } = data;
  const date = new Date(Number(scannedAt));
  const total = scans.reduce((s, r) => s + Number(r.total), 0);
  const critical = scans.reduce((s, r) => s + Number(r.critical), 0);
  const high = scans.reduce((s, r) => s + Number(r.high), 0);
  const medium = scans.reduce((s, r) => s + Number(r.medium), 0);

  return (
    <div>
      <div style={{ marginBottom:16 }}>
        <div style={{ fontSize:16, fontWeight:700, fontFamily:"monospace", marginBottom:2 }}>{date.toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric', year:'numeric' })}</div>
        <div style={{ fontSize:10, color:"rgba(255,255,255,0.25)", fontFamily:"monospace" }}>{scans.length} repo{scans.length !== 1 ? 's' : ''} scanned</div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:16 }}>
        {[["Total", total, "rgba(255,255,255,0.5)"], ["Critical", critical, "#ff4444"], ["High", high, "#f59e0b"], ["Medium", medium, "#fbbf24"]].map(([label, count, color]) => (
          <div key={label} style={{ background:"rgba(255,255,255,0.02)", border:`1px solid ${color}22`, borderRadius:8, padding:"12px 16px" }}>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.28)", fontFamily:"monospace", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:4 }}>{label}</div>
            <div style={{ fontSize:26, fontWeight:700, color, fontFamily:"monospace", lineHeight:1 }}>{count}</div>
          </div>
        ))}
      </div>

      <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
        {scans.map((s, i) => (
          <div key={i} style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:8, padding:"12px 14px", cursor:onRepoClick?"pointer":"default" }} onClick={() => onRepoClick && onRepoClick(s.repo_path)}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
              <span style={{ fontSize:13, fontWeight:600, fontFamily:"monospace", color:"rgba(255,255,255,0.7)" }}>{s.repo_name}</span>
              <span style={{ fontSize:11, color:"rgba(255,255,255,0.3)", fontFamily:"monospace" }}>{s.total} total</span>
            </div>
            <div style={{ display:"flex", gap:10 }}>
              {s.critical > 0 && <span style={{ fontSize:10, color:"#ff4444", fontFamily:"monospace" }}>{s.critical} critical</span>}
              {s.high > 0 && <span style={{ fontSize:10, color:"#f59e0b", fontFamily:"monospace" }}>{s.high} high</span>}
              {s.medium > 0 && <span style={{ fontSize:10, color:"#fbbf24", fontFamily:"monospace" }}>{s.medium} medium</span>}
              {s.critical == 0 && s.high == 0 && s.medium == 0 && <span style={{ fontSize:10, color:"rgba(0,255,136,0.5)", fontFamily:"monospace" }}>clean</span>}
            </div>
          </div>
        ))}
      </div>

      {scans.length === 0 && (
        <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:80, color:"rgba(255,255,255,0.15)", fontFamily:"monospace", fontSize:12, border:"1px dashed rgba(255,255,255,0.08)", borderRadius:10 }}>
          No scans recorded at this time
        </div>
      )}
    </div>
  );
}

// ── Root component ───────────────────────────────────────────────────────────
export default function App() {
  const [step, setStep] = useState("loading");

  useEffect(() => {
    // Check if configuration exists
    fetch(`${API_BASE}/api/config`)
      .then(res => res.json())
      .then(data => {
        if (data.hasConfig) {
          setStep("dashboard");
        } else {
          setStep("connect");
        }
      })
      .catch((err) => {
        console.error("Config check failed, default to connect:", err);
        setStep("connect");
      });
  }, []);

  if (step === "loading") {
    return (
      <div style={{ minHeight:"100vh", background:"#080c12", display:"flex", alignItems:"center", justifyContent:"center", color:"rgba(255,255,255,0.4)", fontFamily:"monospace", letterSpacing:"0.15em" }}>
        ⌛ SECURING CONNECTION...
      </div>
    );
  }

  if (step === "connect")
    return <ConfigScreen onConnect={() => setStep("map")} />;

  if (step === "map")
    return <UserMappingScreen onDone={() => setStep("dashboard")} />;

  return <Dashboard />;
}

if (typeof window !== "undefined") {
  window.DevPulseApp = App;
}
