import { useState, useMemo, useEffect } from "react";

// ── Configuration ────────────────────────────────────────────────────────────
const API_BASE = "http://localhost:3002";
const TEAM_COLORS = ["#00ff88","#00c4ff","#a78bfa","#f59e0b","#f472b6","#34d399","#fb923c","#818cf8"];

// ── Utilities ─────────────────────────────────────────────────────────────────
const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
const fmt1 = (n) => Number.isFinite(n) && n > 0 ? n.toFixed(1) : "—";

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
    // Try to load existing config
    fetch(`${API_BASE}/api/config`)
      .then(res => res.json())
      .then(data => {
        if (data.hasConfig) {
          setGh(p => ({ ...p, org: data.gh.org, repo: data.gh.repo }));
          setJira(p => ({ ...p, email: data.jira.email, domain: data.jira.domain, project: data.jira.project }));
        }
      }).catch(console.error);
  }, []);

  const baseInp = { background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.12)", borderRadius:8, color:"#fff", padding:"10px 14px", fontSize:13, fontFamily:"monospace", outline:"none", width:"100%", boxSizing:"border-box" };

  const handleConnect = async () => {
    setErr(""); setLoading(true); setSyncStatus("Saving configuration...");
    try {
      // 1. Save config to local backend
      const res = await fetch(`${API_BASE}/api/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gh, jira })
      });
      if (!res.ok) throw new Error("Failed to save configuration");

      // 2. Stream historical sync events from local SQLite backend
      setSyncStatus("Initiating sync database backfill...");
      const eventSource = new EventSource(`${API_BASE}/api/sync`);
      eventSource.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.stage === "github" || msg.stage === "jira") {
          setSyncStatus(msg.message);
        } else if (msg.stage === "done") {
          setSyncStatus("Historical backfill completed!");
          eventSource.close();
          onConnect();
        } else if (msg.stage === "error") {
          setErr(msg.message);
          eventSource.close();
          setLoading(false);
        }
      };
      eventSource.onerror = () => {
        setErr("Lost connection to DevPulse backend server during sync.");
        eventSource.close();
        setLoading(false);
      };
    } catch(e) { 
      setErr(e.message); 
      setLoading(false);
    }
  };

  const Field = ({ label, placeholder, value, onChange, type="text", full }) => (
    <div style={{ gridColumn: full?"span 2":"span 1" }}>
      <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", marginBottom:5, fontFamily:"monospace" }}>{label}</div>
      <input type={type} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} style={baseInp} />
    </div>
  );

  const allFilled = gh.token && gh.org && gh.repo && jira.token && jira.email && jira.domain && jira.project;

  return (
    <div style={{ minHeight:"100vh", background:"#080c12", display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
      <div style={{ width:"100%", maxWidth:520 }}>
        <div style={{ marginBottom:32, textAlign:"center" }}>
          <div style={{ fontSize:11, letterSpacing:"0.22em", color:"rgba(255,255,255,0.2)", fontFamily:"monospace", marginBottom:10 }}>DEVPULSE</div>
          <h1 style={{ fontSize:24, fontWeight:700, color:"#fff", margin:0, letterSpacing:"-0.02em" }}>Connect your sources</h1>
          <p style={{ color:"rgba(255,255,255,0.28)", marginTop:6, fontSize:12, fontFamily:"monospace" }}>Step 1 of 2 — Stored securely on your local SQLite database.</p>
        </div>
        <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:16, padding:26 }}>
          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:10, color:"rgba(255,255,255,0.28)", letterSpacing:"0.12em", textTransform:"uppercase", fontFamily:"monospace", marginBottom:12 }}>GitHub</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              <Field label="Personal Access Token" placeholder="ghp_..." type="password" value={gh.token} onChange={v => setGh(p=>({...p,token:v}))} full />
              <Field label="Owner / Org" placeholder="my-org" value={gh.org} onChange={v => setGh(p=>({...p,org:v}))} />
              <Field label="Repository" placeholder="my-repo" value={gh.repo} onChange={v => setGh(p=>({...p,repo:v}))} />
            </div>
          </div>
          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:10, color:"rgba(255,255,255,0.28)", letterSpacing:"0.12em", textTransform:"uppercase", fontFamily:"monospace", marginBottom:12 }}>Jira</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              <Field label="API Token" placeholder="ATATT..." type="password" value={jira.token} onChange={v => setJira(p=>({...p,token:v}))} full />
              <Field label="Email" placeholder="you@company.com" value={jira.email} onChange={v => setJira(p=>({...p,email:v}))} />
              <Field label="Domain" placeholder="myco.atlassian.net" value={jira.domain} onChange={v => setJira(p=>({...p,domain:v}))} />
              <Field label="Project Key" placeholder="ENG" value={jira.project} onChange={v => setJira(p=>({...p,project:v}))} />
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
function Dashboard({ onReset }) {
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
    const eventSource = new EventSource(`${API_BASE}/api/sync`);
    eventSource.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.stage === "done") {
        setSyncStatus("");
        eventSource.close();
        loadData();
      } else {
        setSyncStatus(msg.message);
      }
    };
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
          
          <button onClick={handleSync} disabled={!!syncStatus} style={{ background:"rgba(0,255,136,0.1)", border:"1px solid rgba(0,255,136,0.22)", borderRadius:8, padding:"6px 11px", color:"#00ff88", fontSize:11, cursor:"pointer", fontFamily:"monospace", marginLeft:4 }}>
            {syncStatus || "⚡ Sync DB"}
          </button>
          <button onClick={onReset} style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:8, padding:"6px 11px", color:"rgba(255,255,255,0.22)", fontSize:11, cursor:"pointer", fontFamily:"monospace" }}>↺ Config</button>
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

  return <Dashboard onReset={() => setStep("connect")} />;
}

if (typeof window !== "undefined") {
  window.DevPulseApp = App;
}
