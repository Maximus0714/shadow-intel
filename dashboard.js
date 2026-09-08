/* =====================================================================
CNIS Dashboard v2 — data layer + graph + panels (no dependencies)
Modes: MOCK (fictional Copper Ledger) | LIVE (FastAPI backend) | UPLOAD (own CSV/JSON/TXT)
All parsing for UPLOAD happens locally in the browser. Nothing is sent anywhere.
===================================================================== */
"use strict";

/* ================= UTIL ================= */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
  ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const NS = "http://www.w3.org/2000/svg";
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
let toastT = null;
function toast(m) {
  const t = $("toast"); t.textContent = m; t.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2600);
}
function initials(n) {
  return String(n || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}
function trunc(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
window.addEventListener("error", (e) => toast("Error: " + (e.message || "script failure")));

/* ================= MOCK DATA (fictional) ================= */
const MOCK_ENTITIES = [
 {id:"P01",name:"Mohan Yadav",role:"leader",inf:.92,com:0,phones:["+91 98765 43210"],veh:["MH12AB1234"],alias:["M. Yadav","Bhai"],cases:["FIR-102/2024","FIR-088/2024"],tl:[["12 Mar 2024","Threatened complainant near Gateway of India",1],["15 Mar 2024","Spotted with Anil Verma, Andheri",0],["02 Apr 2024","Received Rs 4.6L via hawala courier",1]]},
 {id:"P02",name:"Ravi Sharma",role:"bridge",inf:.71,com:0,phones:["+91 98200 11223"],veh:[],alias:[],cases:["FIR-102/2024"],tl:[["12 Mar 2024","Filed complaint at Andheri PS",0],["14 Mar 2024","Called Yadav to negotiate",0]]},
 {id:"P03",name:"Anil Verma",role:"bridge",inf:.68,com:0,phones:["+91 99301 77884"],veh:["MH02CD5566"],alias:["Anil Bhai"],cases:["FIR-102/2024"],tl:[["15 Mar 2024","Seen with Yadav in Andheri",0],["21 Mar 2024","SIM swap: new handset IMEI",1]]},
 {id:"P04",name:"Sharma Enterprises",role:"member",inf:.44,com:0,phones:[],veh:[],alias:[],cases:["FIR-102/2024"],tl:[["12 Mar 2024","Named as beneficiary of Rs 50,000 demand",0]],org:true},
 {id:"P05",name:"Farhan Qureshi",role:"leader",inf:.83,com:1,phones:["+91 98111 90876"],veh:["MH04EF9012"],alias:["FQ"],cases:["FIR-102/2024","FIR-088/2024"],tl:[["18 Mar 2024","Coordinated courier handoff, Kurla",1],["02 Apr 2024","Split Rs 9.4L into two transfers",1]]},
 {id:"P06",name:"Deepak Nair",role:"member",inf:.39,com:1,phones:["+91 97680 33445"],veh:[],alias:[],cases:["FIR-088/2024"],tl:[["19 Mar 2024","Rented godown used for meet",0]]},
 {id:"P07",name:"Sana Sheikh",role:"bridge",inf:.62,com:1,phones:["+91 98901 22334"],veh:[],alias:["S. Sheikh"],cases:["FIR-102/2024"],tl:[["20 Mar 2024","Relayed messages between crews",1],["25 Mar 2024","Call spike: 14 calls in 2 days",1]]},
 {id:"P08",name:"Iqbal Khan",role:"member",inf:.35,com:1,phones:["+91 97020 55667"],veh:["MH03GH7788"],alias:[],cases:["FIR-088/2024"],tl:[["22 Mar 2024","Drove courier vehicle",0]]},
 {id:"P09",name:"Prakash Rao",role:"member",inf:.28,com:2,phones:["+91 96543 21098"],veh:[],alias:[],cases:["FIR-091/2023"],tl:[["09 Jan 2024","Sold 40 pre-activated SIMs",1]]},
 {id:"P10",name:"Kavita Menon",role:"member",inf:.31,com:2,phones:["+91 98450 66778"],veh:[],alias:[],cases:["FIR-091/2023"],tl:[["11 Jan 2024","KYC documents reused across SIMs",0]]},
 {id:"P11",name:"Arjun Patel",role:"unknown",inf:.18,com:2,phones:["+91 97222 44556"],veh:[],alias:[],cases:["FIR-102/2024"],tl:[["28 Mar 2024","Single call to Verma — unidentified link",0]]},
 {id:"P12",name:"Sunil Gavaskar Traders",role:"member",inf:.26,com:1,phones:[],veh:[],alias:[],cases:["FIR-088/2024"],tl:[["30 Mar 2024","Shell invoices match courier dates",1]],org:true},
 {id:"P13",name:"Rehman Ali",role:"member",inf:.22,com:0,phones:["+91 96190 11223"],veh:[],alias:[],cases:["FIR-102/2024"],tl:[["01 Apr 2024","Present at warehouse meet",0]]}
];
const MOCK_EDGES = [
 {a:"P01",b:"P02",t:"call",s:4},{a:"P01",b:"P03",t:"colocated",s:3},{a:"P01",b:"P05",t:"financial",s:5},
 {a:"P01",b:"P04",t:"financial",s:2},{a:"P02",b:"P03",t:"call",s:2},{a:"P03",b:"P07",t:"call",s:4},
 {a:"P05",b:"P06",t:"colocated",s:3},{a:"P05",b:"P07",t:"financial",s:4},{a:"P05",b:"P08",t:"kin",s:2},
 {a:"P07",b:"P08",t:"call",s:3},{a:"P05",b:"P12",t:"financial",s:3},{a:"P06",b:"P12",t:"colocated",s:2},
 {a:"P03",b:"P11",t:"call",s:1},{a:"P09",b:"P10",t:"financial",s:3},{a:"P09",b:"P03",t:"call",s:2},
 {a:"P01",b:"P13",t:"colocated",s:2},{a:"P07",b:"P02",t:"call",s:3},{a:"P08",b:"P06",t:"kin",s:1}
];
const MOCK_ALERTS = [
 {id:"A1",sev:"high",why:"Rs 9.4L split into two transfers within 7 days — just under the Rs 10L reporting limit (structuring).",ents:["P05","P12"],when:"02 Apr 2024"},
 {id:"A2",sev:"high",why:"14 calls in 2 days between Sana Sheikh and Ravi Sharma — 4.6× their baseline rate, right after the FIR was filed.",ents:["P07","P02"],when:"25 Mar 2024"},
 {id:"A3",sev:"med",why:"Arjun Patel has no prior record but sits on the only link between the SIM crew and the extortion crew.",ents:["P11"],when:"28 Mar 2024"},
 {id:"A4",sev:"med",why:"Money loops Qureshi → Shell invoices → courier → Qureshi across 3 accounts (possible layering).",ents:["P05","P12","P08"],when:"30 Mar 2024"},
 {id:"A5",sev:"med",why:"SIM swap + new handset for Anil Verma 6 days after the FIR — possible counter-surveillance.",ents:["P03"],when:"21 Mar 2024"},
 {id:"A6",sev:"low",why:"Rehman Ali attended one warehouse meet; low volume, keep on watchlist for now.",ents:["P13"],when:"01 Apr 2024"}
];
const MOCK_DOC = [
 {t:" FIR No. "},{t:"102/2024",e:"CASE"},{t:" was registered at "},{t:"Andheri Police Station",e:"LOC"},
 {t:" on the complaint of "},{t:"Ravi Sharma",e:"P02"},{t:". The complainant stated that on "},
 {t:"12 March 2024",e:"DATE"},{t:", accused "},{t:"Mohan Yadav",e:"P01"},{t:" met "},
 {t:"Ravi Sharma",e:"P02"},{t:" near "},{t:"Gateway of India, Mumbai",e:"LOC"},
 {t:" and threatened him with a pistol. "},{t:"Mohan Yadav",e:"P01"},
 {t:" demanded "},{t:"Rs. 50,000",e:"MONEY"},{t:" on behalf of "},
 {t:"Sharma Enterprises",e:"P04"},{t:". Later, "},{t:"Ravi Sharma",e:"P02"},
 {t:" called "},{t:"Mohan Yadav",e:"P01"},{t:" at "},{t:"+91 98765 43210",e:"PHONE"},
 {t:" to negotiate. The accused was later spotted with "},{t:"Anil Verma",e:"P03"},
 {t:" in "},{t:"Andheri",e:"LOC"},{t:" on "},{t:"15 March 2024",e:"DATE"},{t:"."}
];
const ENT_CLS = {PERSON:"t-PERSON",PHONE:"t-PHONE",VEHICLE:"t-VEHICLE",LOC:"t-LOC",ORG:"t-ORG",MONEY:"t-MONEY",DATE:"t-PHONE",CASE:"t-LOC"};
/* ---- link language (single source of truth) ----
   Node roles keep warm hues (red/amber/slate). Edges use a SEPARATE cool
   family + distinct stroke grammar, so a line can never read as a role:
   financial = solid emerald, arrowhead, travelling light-dots (money moves)
   call      = solid cool blue (conversation)
   colocated = dashed violet (meets — intermittent by nature)
   kin       = dotted rose (family — soft, personal)
   unknown   = dotted grey (unverified — handle with care)                 */
const EDGE = {
  financial: {label: "Money flow",    color: "var(--e-fin)",   dash: null,    width: (s) => 1.5 + s * 0.6, marker: "url(#arrF)", desc: "directed money movement"},
  call:      {label: "Call/contact",  color: "var(--e-call)",  dash: null,    width: (s) => 0.9 + s * 0.35, marker: null,       desc: "voice or message contact"},
  colocated: {label: "Seen together", color: "var(--e-coloc)", dash: "7 5",   width: (s) => 1.0 + s * 0.4, marker: null,        desc: "same place, same time"},
  kin:       {label: "Kin tie",       color: "var(--e-kin)",   dash: "0.1 5", width: () => 2.2,            marker: null,        desc: "family or household tie"},
  unknown:   {label: "Unverified",    color: "var(--e-unk)",   dash: "2 4",   width: () => 1.3,            marker: null,        desc: "source unclear — verify"},
};
const TYPES = [["financial","Money flow"],["call","Call/contact"],["colocated","Seen together"],["kin","Kin tie"],["unknown","Unverified"]];
const NODE_CAP = 250;

/* ================= NORMALIZED STORE =================
nodes: [{id,label,role,influence,community,phones[],vehicles[],aliases[],cases[],timeline[[date,text,hot]],degree}]
edges: [{src,dst,type,strength}]  type ∈ financial|call|colocated|kin|unknown          */
const store = {
  mode: "mock", badge: "MOCK — fictional case", note: "",
  nodes: [], edges: [], alerts: [],
  doc: null,            // {title, meta, segments:[{t, e?, pid?}]}
  stats: {nodes: 0, edges: 0},
};
let byId = {};
let HAY = [];
const activeTypes = new Set(["financial", "call", "colocated", "kin", "unknown"]);
const collapsed = new Set();   // community ids collapsed into combo nodes
let egoCenter = null, showFull = false, isolated = null, layoutName = "crew";

function normRole(r) {
  r = String(r || "").toLowerCase();
  return ["leader", "bridge", "member"].includes(r) ? r : "unknown";
}
function normType(t) {
  t = String(t || "").toUpperCase();
  if (t.includes("FINANC") || t === "financial") return "financial";
  if (t === "CALLED" || t === "call") return "call";
  if (t.includes("CO_LOC") || t === "colocated") return "colocated";
  if (t === "kin") return "kin";
  if (t.includes("ASSOCIATE") || t === "EMAILED" || t === "CONTACTED") return "call";
  if (t.includes("VEHICLE")) return "kin";
  return "unknown";
}
function rebuildIndex() {
  byId = Object.fromEntries(store.nodes.map((n) => [n.id, n]));
  HAY = store.nodes.map((n) =>
    [n.label, n.id, (n.phones || []).join(" "), (n.vehicles || []).join(" "),
     (n.aliases || []).join(" "), (n.cases || []).join(" ")].join(" ").toLowerCase());
}
function loadMock() {
  store.mode = "mock"; store.badge = "MOCK — fictional case"; store.note = "";
  store.nodes = MOCK_ENTITIES.map((e) => ({
    id: e.id, label: e.name, role: e.role,
    influence: e.inf, community: e.com,
    phones: e.phones || [], vehicles: e.veh || [], aliases: e.alias || [],
    cases: e.cases || [], timeline: e.tl || [],
  }));
  store.edges = MOCK_EDGES.map((e) => ({src: e.a, dst: e.b, type: e.t, strength: e.s}));
  store.alerts = MOCK_ALERTS.map((a) => ({...a}));
  store.doc = {title: "FIR-102/2024", meta: "Andheri PS · filed 12 Mar 2024 · Extortion / criminal intimidation", segments: MOCK_DOC};
  store.stats = {nodes: store.nodes.length, edges: store.edges.length};
  rebuildIndex();
}

/* ================= LIVE API CLIENT ================= */
const Live = {
  base: "http://127.0.0.1:8000", key: "",
  remember: false,
  load() {
    try {
      const s = JSON.parse(localStorage.getItem("cnis-live") || "null") ||
                JSON.parse(sessionStorage.getItem("cnis-live") || "null");
      if (s) { this.base = s.base || this.base; this.key = s.key || ""; this.remember = !!s.remember; }
    } catch (e) { /* fresh start */ }
  },
  save() {
    const s = JSON.stringify({base: this.base, key: this.key, remember: this.remember});
    try {
      if (this.remember) { localStorage.setItem("cnis-live", s); sessionStorage.removeItem("cnis-live"); }
      else { sessionStorage.setItem("cnis-live", s); localStorage.removeItem("cnis-live"); }
    } catch (e) { /* storage unavailable */ }
  },
  forget() {
    try { localStorage.removeItem("cnis-live"); sessionStorage.removeItem("cnis-live"); } catch (e) {}
    this.key = "";
  },
  async req(path, opts) {
    opts = opts || {};
    let r;
    try {
      r = await fetch(this.base.replace(/\/$/, "") + path, {
        method: opts.method || "GET",
        headers: {"X-API-Key": this.key, "Content-Type": "application/json"},
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
    } catch (e) {
      throw new Error("Cannot reach " + this.base + ". Is api.py running? If this tab was opened via file://, serve the folder instead: python -m http.server 8080, then open http://localhost:8080/dashboard.html");
    }
    if (r.status === 401) throw new Error("401 — API key rejected. Check the key in Live settings.");
    if (!r.ok) throw new Error("HTTP " + r.status + " on " + path);
    return r.json();
  },
};
function sevFromScore(s) { s = Number(s); return s >= 0.7 ? "high" : s >= 0.4 ? "med" : "low"; }

async function loadLiveSeed() {
  const stats = await Live.req("/stats");
  const kp = await Live.req("/analytics/key-players?limit=60");
  let comm = {communities: []}, al = {flags: []};
  try { comm = await Live.req("/analytics/communities"); } catch (e) { /* optional panel */ }
  try { al = await Live.req("/analytics/alerts"); } catch (e) { /* optional panel */ }
  store.mode = "live";
  store.badge = "LIVE — " + Live.base.replace(/^https?:\/\//, "");
  store.note = "showing top-" + kp.players.length + " by influence of " + (stats.nodes || "?") + " nodes";
  store.nodes = kp.players.map((p) => ({
    id: p.person_id, label: p.name || p.person_id, role: normRole(p.role),
    influence: p.influence_score, community: p.community_id,
    phones: [], vehicles: [], aliases: [], cases: [], timeline: [],
    breakdown: p.centrality_breakdown || null,
  }));
  // merge community members (adds names/roles the top-60 may miss)
  for (const c of (comm.communities || [])) {
    for (const m of (c.members || [])) {
      if (!store.nodes.find((n) => n.id === m.person_id)) {
        store.nodes.push({
          id: m.person_id, label: m.name || m.person_id, role: normRole(m.role),
          influence: m.influence_score, community: c.community_id,
          phones: [], vehicles: [], aliases: [], cases: [], timeline: [],
        });
      }
    }
  }
  store.edges = [];
  store.alerts = (al.flags || []).slice(0, 60).map((f, i) => ({
    id: "L" + (i + 1), sev: sevFromScore(f.severity_score),
    why: f.plain_language_explanation || (f.pattern_type || "Flagged pattern") + ".",
    ents: (f.entities_involved || []).slice(0, 6),
    when: (f.evidence && (f.evidence.date || f.evidence.event_date)) || f.source_dataset || f.pattern_type || "",
    pattern: f.pattern_type || "", score: f.severity_score,
  }));
  store.doc = null;
  store.stats = {nodes: stats.nodes || 0, edges: stats.edges || 0};
  rebuildIndex();
  // seed edges: ego network of the top influencer (depth 1)
  if (store.nodes.length) await expandLive(store.nodes[0].id, true);
}
function mergeEgo(net) {
  let added = 0;
  for (const n of (net.nodes || [])) {
    if (!byId[n.id]) {
      store.nodes.push({
        id: n.id, label: n.name || n.id, role: normRole(n.role),
        influence: n.influence_score != null ? n.influence_score : null,
        community: n.community_id != null ? n.community_id : null,
        phones: [], vehicles: [], aliases: [], cases: [], timeline: [],
      });
      added++;
    }
  }
  const have = new Set(store.edges.map((e) => e.src + ">" + e.dst + ">" + e.type));
  for (const e of (net.edges || [])) {
    const t = normType(e.rel);
    const k = e.src + ">" + e.dst + ">" + t;
    if (!have.has(k)) { have.add(k); store.edges.push({src: e.src, dst: e.dst, type: t, strength: Math.min(5, Math.max(1, Math.round(e.frequency || 1)))}); }
  }
  rebuildIndex();
  trimToCap();
  return added;
}
function trimToCap() {
  if (store.nodes.length <= NODE_CAP) return;
  const keep = new Set([selected, egoCenter, isolated].filter(Boolean));
  const ranked = [...store.nodes].sort((a, b) => (b.influence || 0) - (a.influence || 0));
  const allowed = new Set(ranked.slice(0, NODE_CAP).map((n) => n.id));
  keep.forEach((id) => allowed.add(id));
  store.nodes = store.nodes.filter((n) => allowed.has(n.id));
  store.edges = store.edges.filter((e) => allowed.has(e.src) && allowed.has(e.dst));
  rebuildIndex();
  toast("Node cap (" + NODE_CAP + ") — showing top by influence.");
}
async function expandLive(id, silent) {
  try {
    const net = await Live.req("/entities/" + encodeURIComponent(id) + "/network?depth=1");
    const added = mergeEgo(net);
    computeLayout(); draw();
    if (!silent) toast("Expanded " + id + " (+" + added + " nodes).");
  } catch (e) { if (!silent) toast(String(e.message || e)); }
}

/* ================= UPLOAD (local parse, validation-first) ================= */
function parseCSV(text) {
  const rows = []; let cur = [""], q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur[cur.length - 1] += '"'; i++; } else q = false; }
      else cur[cur.length - 1] += c;
    } else if (c === '"') q = true;
    else if (c === ",") cur.push("");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      rows.push(cur); cur = [""];
    } else cur[cur.length - 1] += c;
  }
  if (cur.length > 1 || cur[0] !== "") rows.push(cur);
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}
function validateUpload(nodesText, edgesText, jsonText) {
  const rep = {nodes: [], edges: [], errors: [], ok: false};
  try {
    if (jsonText && jsonText.trim()) {
      const g = JSON.parse(jsonText);
      const nl = g.nodes || g.vertices || [], el = g.edges || g.links || [];
      if (!nl.length) rep.errors.push("JSON: no nodes[] array found.");
      nl.forEach((n, i) => {
        const id = n.id || n.person_id || n.email;
        if (!id) { rep.errors.push("JSON node #" + (i + 1) + ": missing id."); return; }
        rep.nodes.push({
          id: String(id), label: n.label || n.name || n.person_id || String(id),
          role: normRole(n.role), influence: n.influence_score != null ? n.influence_score : (n.inf != null ? n.inf : null),
          community: n.community_id != null ? n.community_id : (n.com != null ? n.com : null),
          phones: n.phones || (n.phone ? [n.phone] : []), vehicles: n.vehicles || (n.vehicle ? [n.vehicle] : []),
          aliases: n.aliases || n.alias || [], cases: n.cases || (n.case ? [n.case] : []), timeline: n.timeline || n.tl || [],
        });
      });
      el.forEach((e, i) => {
        const s = e.src || e.a || e.source || e.from, d = e.dst || e.b || e.target || e.to;
        if (!s || !d) { rep.errors.push("JSON edge #" + (i + 1) + ": missing endpoints."); return; }
        rep.edges.push({src: String(s), dst: String(d), type: normType(e.rel || e.t || e.type), strength: Math.min(5, Math.max(1, Math.round(e.frequency || e.s || e.weight || 1)))});
      });
    } else {
      if (!nodesText || !edgesText) { rep.errors.push("Provide nodes CSV + edges CSV, or a single JSON graph."); return rep; }
      const nr = parseCSV(nodesText), er = parseCSV(edgesText);
      const nh = nr[0].map((h) => h.trim()), eh = er[0].map((h) => h.trim());
      const nid = nh.findIndex((h) => /person_id|email|account_id|^id$/i.test(h));
      if (nid < 0) rep.errors.push("nodes CSV: need a person_id / email / id column (saw: " + nh.join(", ") + ").");
      const lb = nh.findIndex((h) => /^(person_id|label|name)$/i.test(h));
      const si = eh.findIndex((h) => /START_ID|person_a|sender|source|from/i.test(h));
      const di = eh.findIndex((h) => /END_ID|person_b|recipient|target|to/i.test(h));
      if (si < 0 || di < 0) rep.errors.push("edges CSV: need source + target columns (saw: " + eh.join(", ") + ").");
      if (rep.errors.length) return rep;
      const ti = eh.findIndex((h) => /:TYPE|^rel$|type/i.test(h));
      const fi = eh.findIndex((h) => /frequency|weight/i.test(h));
      for (let i = 1; i < nr.length; i++) {
        const id = (nr[i][nid] || "").trim();
        if (!id) { rep.errors.push("nodes row " + (i + 1) + ": empty id, skipped."); continue; }
        rep.nodes.push({
          id, label: lb >= 0 && nr[i][lb] ? nr[i][lb] : id, role: "unknown",
          influence: null, community: null, phones: [], vehicles: [], aliases: [], cases: [], timeline: [],
        });
      }
      const ids = new Set(rep.nodes.map((n) => n.id));
      for (let i = 1; i < er.length; i++) {
        let s = (er[i][si] || "").trim(), d = (er[i][di] || "").trim();
        if (!s || !d) { rep.errors.push("edges row " + (i + 1) + ": empty endpoint, skipped."); continue; }
        // tolerate unprefixed caviar-style ids by matching suffix
        if (!ids.has(s)) { const m = [...ids].find((x) => x === s || x.endsWith(":" + s)); if (m) s = m; }
        if (!ids.has(d)) { const m = [...ids].find((x) => x === d || x.endsWith(":" + d)); if (m) d = m; }
        if (!ids.has(s) || !ids.has(d)) { rep.errors.push("edges row " + (i + 1) + ": unknown endpoint(s), skipped."); continue; }
        rep.edges.push({src: s, dst: d, type: normType(ti >= 0 ? er[i][ti] : ""), strength: Math.min(5, Math.max(1, Math.round(parseFloat(fi >= 0 ? er[i][fi] : "1") || 1)))});
      }
    }
  } catch (e) { rep.errors.push("Parse error: " + e.message); return rep; }
  rep.ok = rep.nodes.length > 0;
  if (!rep.nodes.length) rep.errors.push("No usable nodes found.");
  return rep;
}
/* client-side entity highlight for an uploaded .txt report */
function highlightText(text) {
  const segs = []; let rest = text;
  const pat = new RegExp([
    "(\\+?91[\\s\\-]?[6-9]\\d{4}[\\s\\-]?\\d{5})",          // phone
    "(\\b[A-Z]{2}[\\s\\-]?[0-9]{1,2}[\\s\\-]?[A-Z]{1,3}[\\s\\-]?[0-9]{4}\\b)", // plate
    "((?:Rs\\.?|INR|USD|\\$)\\s?[\\d,]+(?:\\.\\d+)?\\s?(?:lakh|crore|million|thousand)?)", // money
    "(\\b\\d{1,2}\\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\s\\d{4}\\b)", // date
    "(\\b[A-Z][a-z]+\\s[A-Z][a-z]+(?:\\s[A-Z][a-z]+)?\\b)",  // person-ish name
  ].join("|"), "g");
  let m, last = 0;
  const push = (t, e, pid) => { if (t) segs.push({t, e, pid}); };
  while ((m = pat.exec(text)) !== null) {
    push(text.slice(last, m.index));
    const hit = m[0];
    let cls = "LOC", pid = null;
    if (/^[+0-9][\d\s\-+]{7,}$/.test(hit) && /\d{7,}/.test(hit.replace(/\D/g, ""))) cls = "PHONE";
    else if (/^[A-Z]{2}[\s\-0-9A-Z]+$/.test(hit) && /\d/.test(hit)) cls = "VEHICLE";
    else if (/Rs|INR|USD|\$/i.test(hit)) cls = "MONEY";
    else if (/\d{4}$/.test(hit)) cls = "DATE";
    else {
      const found = store.nodes.find((n) => n.label && hit.includes(n.label.split(" ")[0]) && hit.length <= n.label.length + 6);
      if (found) { cls = "PERSON"; pid = found.id; } else cls = "ORG";
    }
    push(hit, cls, pid);
    last = m.index + hit.length;
    if (segs.length > 800) break; // cap work on huge pastes
  }
  push(text.slice(last));
  return segs;
}

/* ================= GRAPH (Cambridge-informed, static layouts) ============ */
const svg = $("graph");
const vp = document.createElementNS(NS, "g");
const gHull = document.createElementNS(NS, "g");
const gE = document.createElementNS(NS, "g");
const gN = document.createElementNS(NS, "g");
vp.append(gHull, gE, gN); svg.appendChild(vp);
(function defs() {
  const d = document.createElementNS(NS, "defs");
  d.innerHTML =
    '<marker id="arrF" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" style="fill:var(--e-fin)"></path></marker>';
  svg.appendChild(d);
})();
/* trim a link so it starts/ends at the node edges (not under the squares);
   financial links stop a touch earlier to leave room for the arrowhead */
function edgeGeom(a, b, ra, rb, isFin) {
  // square-aware trim: distance from center to square edge along (ux,uy)
  const sq = (h, ux, uy) => {
    const ax = Math.abs(ux), ay = Math.abs(uy);
    if (ax < 1e-6 && ay < 1e-6) return h;
    return h / Math.max(ax, ay);
  };
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const tail = Math.min(sq(ra, ux, uy) + 1, len / 2);
  const head = Math.min(sq(rb, ux, uy) + (isFin ? 7 : 1), len / 2);
  return {x1: a.x + ux * tail, y1: a.y + uy * tail,
          x2: b.x - ux * head, y2: b.y - uy * head};
}
const edgePoint = (g, t) => ({x: +g.x1 + (+g.x2 - +g.x1) * t, y: +g.y1 + (+g.y2 - +g.y1) * t});
let W = 800, H = 600, selected = null, hovered = null;
let nodeEls = new Map(), edgeEls = [], edgeIdx = new Map(), rowEls = new Map();
const nodePos = new Map();
const byIdNode = (id) => nodePos.get(id);

function neighbors(id) {
  const out = new Set();
  for (const e of store.edges) {
    if (!activeTypes.has(e.type)) continue;
    if (e.src === id) out.add(e.dst);
    if (e.dst === id) out.add(e.src);
  }
  return out;
}
function visibleSet() {
  let ids;
  if (isolated) ids = new Set([isolated, ...neighbors(isolated)]);
  else if (!showFull && egoCenter && byId[egoCenter]) ids = new Set([egoCenter, ...neighbors(egoCenter)]);
  else ids = new Set(store.nodes.map((n) => n.id));
  // collapsed crews: members hidden, combo shown
  for (const c of collapsed) {
    for (const n of store.nodes) if (String(n.community) === String(c) && ids.has(n.id)) ids.delete(n.id);
  }
  return ids;
}
/* deterministic static layouts — no physics, first paint in ~2 frames */
function computeLayout() {
  const ids = visibleSet();
  const list = store.nodes.filter((n) => ids.has(n.id));
  nodePos.clear();
  const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.36;
  if (layoutName === "radial" || !list.some((n) => n.community != null)) {
    const rank = [...list].sort((a, b) => (b.influence || 0) - (a.influence || 0));
    rank.forEach((n, i) => {
      if (i === 0) { n.x = cx; n.y = cy; }
      else { const a = ((i - 1) / Math.max(1, rank.length - 1)) * Math.PI * 2 - Math.PI / 2; n.x = cx + Math.cos(a) * R; n.y = cy + Math.sin(a) * R * 0.82; }
      nodePos.set(n.id, n);
    });
  } else {
    const groups = {};
    list.forEach((n) => { const k = n.community == null ? "ungrouped" : String(n.community); (groups[k] = groups[k] || []).push(n); });
    const keys = Object.keys(groups).sort();
    keys.forEach((k, gi) => {
      const a = (gi / keys.length) * Math.PI * 2 - Math.PI / 2;
      const gx = cx + Math.cos(a) * R * 0.72, gy = cy + Math.sin(a) * R * 0.62;
      const ms = groups[k].sort((x, y) => (y.influence || 0) - (x.influence || 0));
      ms.forEach((n, i) => {
        if (ms.length === 1) { n.x = gx; n.y = gy; }
        else { const b = (i / ms.length) * Math.PI * 2; const rr = 34 + Math.min(90, ms.length * 9); n.x = gx + Math.cos(b) * rr; n.y = gy + Math.sin(b) * rr * 0.8; }
        nodePos.set(n.id, n);
      });
    });
  }
  // combo nodes for collapsed crews sit at the crew centroid
  for (const c of collapsed) {
    const ms = store.nodes.filter((n) => String(n.community) === String(c));
    if (!ms.length) continue;
    const outsiders = new Set();
    store.edges.forEach((e) => {
      if (ms.some((m) => m.id === e.src) && !ms.some((m) => m.id === e.dst)) outsiders.add(e.dst);
      if (ms.some((m) => m.id === e.dst) && !ms.some((m) => m.id === e.src)) outsiders.add(e.src);
    });
    const anchors = [...outsiders].map((id) => nodePos.get(id)).filter(Boolean);
    const px = anchors.length ? anchors.reduce((s, n) => s + n.x, 0) / anchors.length : cx;
    const py = anchors.length ? anchors.reduce((s, n) => s + n.y, 0) / anchors.length : cy;
    nodePos.set("combo:" + c, {id: "combo:" + c, x: px, y: py, combo: c, count: ms.length});
  }
}
const rOf = (inf) => halfOf(inf) * 1.08;
/* half-side of the square node: compact professional range (~8-18px) */
const halfOf = (inf) => 7.5 + (inf == null ? 2.5 : Math.max(0, Math.min(1, Number(inf) || 0)) * 10.5);
const NODE_RX = 3;
const roleFill = (r) => r === "leader" ? "var(--red)" : r === "bridge" ? "var(--amber)" : r === "member" ? "var(--slate)" : "var(--well)";
/* flat professional fills: solid body, no gradients, no gloss */
const roleStroke = (r) => r === "leader" ? "#7E150D" : r === "bridge" ? "#7A5205" : r === "member" ? "#3C444D" : "var(--faint)";
function edgeColor(t) { return (EDGE[t] || EDGE.unknown).color; }
/* convex hull (Andrew monotone chain) for crew outlines */
function hullPath(pts) {
  if (pts.length < 3) return "";
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  lo.pop(); hi.pop();
  const h = lo.concat(hi);
  return "M" + h.map((q) => q[0].toFixed(1) + "," + q[1].toFixed(1)).join(" L") + " Z";
}
function draw() {
  const ids = visibleSet();
  const visE = store.edges.filter((e) =>
    ids.has(e.src) && ids.has(e.dst) && (activeTypes.has(e.type) || e.type === "unknown"));
  gHull.innerHTML = ""; gE.innerHTML = ""; gN.innerHTML = "";
  nodeEls = new Map(); edgeEls = []; edgeIdx = new Map();
  $("statNodes").textContent = ids.size + " / " + store.nodes.length + " nodes";
  $("statEdges").textContent = visE.length + " edges";
  const fragH = document.createDocumentFragment(), fragE = document.createDocumentFragment(), fragN = document.createDocumentFragment();
  // crew hulls (flat 1px outline, click = collapse to combo)
  const groups = {};
  store.nodes.forEach((n) => {
    if (!ids.has(n.id) || n.community == null || collapsed.has(String(n.community))) return;
    const k = String(n.community); (groups[k] = groups[k] || []).push(n);
  });
  for (const k of Object.keys(groups)) {
    if (groups[k].length < 2) continue;
    const pts = [];
    groups[k].forEach((n) => { const p = nodePos.get(n.id); if (p) { const r = rOf(n.influence) + 16; pts.push([p.x - r, p.y - r], [p.x + r, p.y - r], [p.x + r, p.y + r], [p.x - r, p.y + r]); } });
    const d = hullPath(pts);
    if (!d) continue;
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", d); path.setAttribute("class", "hull");
    path.dataset.crew = k;
    const title = document.createElementNS(NS, "title");
    title.textContent = "Crew " + k + " (" + groups[k].length + " members) — click to collapse";
    path.appendChild(title);
    path.addEventListener("click", (ev) => { ev.stopPropagation(); toggleCrew(k); });
    fragH.appendChild(path);
  }
  // edges: flat single-stroke lines, no casing / dots / animation
  for (const e of visE) {
    const a = nodePos.get(e.src), b = nodePos.get(e.dst);
    if (!a || !b) continue;
    const st = EDGE[e.type] || EDGE.unknown;
    const g = edgeGeom(a, b, halfOf((byId[e.src] || {}).influence), halfOf((byId[e.dst] || {}).influence), e.type === "financial");
    const w = st.width(e.strength || 1);
    const l = document.createElementNS(NS, "line");           // flat core = the meaning
    l.setAttribute("x1", g.x1); l.setAttribute("y1", g.y1);
    l.setAttribute("x2", g.x2); l.setAttribute("y2", g.y2);
    l.setAttribute("class", "edge edge-core"); l.dataset.a = e.src; l.dataset.b = e.dst; l.dataset.type = e.type;
    l.setAttribute("stroke", st.color);
    l.setAttribute("stroke-width", w);
    l.setAttribute("stroke-linecap", "square");
    if (st.dash) l.setAttribute("stroke-dasharray", st.dash);
    if (st.marker) l.setAttribute("marker-end", st.marker);
    l.setAttribute("opacity", e.type === "financial" || e.type === "call" ? 0.9 : 0.8);
    const t = document.createElementNS(NS, "title");
    const arrow = e.type === "financial" ? " → " : " ↔ ";
    t.textContent = (byId[e.src] ? byId[e.src].label : e.src) + arrow + (byId[e.dst] ? byId[e.dst].label : e.dst) + " · " + st.label + " (" + st.desc + ") ×" + e.strength;
    l.appendChild(t);
    edgeEls.push(l);
    if (!edgeIdx.has(e.src)) edgeIdx.set(e.src, []);
    if (!edgeIdx.has(e.dst)) edgeIdx.set(e.dst, []);
    edgeIdx.get(e.src).push(l); edgeIdx.get(e.dst).push(l);
    fragE.appendChild(l);
  }
  // combo nodes for collapsed crews
  for (const c of collapsed) {
    const p = nodePos.get("combo:" + c);
    if (!p || (!showFull && egoCenter && !neighbors(egoCenter).has("combo:" + c))) {
      // combos only render when their crew intersects the visible set
      const ms = store.nodes.filter((n) => String(n.community) === String(c));
      const anyVis = !egoCenter || showFull || ms.some((m) => m.id === egoCenter || neighbors(egoCenter).has(m.id));
      if (!anyVis) continue;
    }
    const g = document.createElementNS(NS, "g");
    g.setAttribute("class", "node combo"); g.dataset.id = "combo:" + c;
    g.setAttribute("transform", "translate(" + p.x + "," + p.y + ")");
    g.setAttribute("tabindex", "0"); g.setAttribute("role", "button");
    g.setAttribute("aria-label", "Collapsed crew " + c + ", " + p.count + " members. Activate to expand.");
    const cir = document.createElementNS(NS, "rect");
    cir.setAttribute("x", -19); cir.setAttribute("y", -19);
    cir.setAttribute("width", 38); cir.setAttribute("height", 38);
    cir.setAttribute("rx", NODE_RX);
    cir.setAttribute("class", "combo-c node-core");
    const tx = document.createElementNS(NS, "text");
    tx.setAttribute("class", "combo-t"); tx.setAttribute("text-anchor", "middle"); tx.setAttribute("y", 5);
    tx.textContent = "×" + p.count;
    const lb = document.createElementNS(NS, "text");
    lb.setAttribute("class", "node-label"); lb.setAttribute("y", 34); lb.setAttribute("text-anchor", "middle");
    lb.textContent = "Crew " + c;
    g.append(cir, tx, lb);
    nodeEls.set("combo:" + c, {g, label: lb, sub: null, node: p});
    fragN.appendChild(g);
  }
  // entity nodes: flat squares — solid role fill, thin dark border, no gloss
  for (const n of store.nodes) {
    if (!ids.has(n.id)) continue;
    const p = nodePos.get(n.id);
    if (!p) continue;
    const h = halfOf(n.influence);
    const g = document.createElementNS(NS, "g");
    g.setAttribute("class", "node"); g.dataset.id = n.id;
    g.setAttribute("transform", "translate(" + p.x + "," + p.y + ")");
    g.setAttribute("tabindex", "0"); g.setAttribute("role", "button");
    g.setAttribute("aria-label", n.label + ", " + n.id + ", role " + n.role);
    const c = document.createElementNS(NS, "rect");
    c.setAttribute("class", "node-core");
    c.setAttribute("x", -h); c.setAttribute("y", -h);
    c.setAttribute("width", h * 2); c.setAttribute("height", h * 2);
    c.setAttribute("rx", NODE_RX);
    c.setAttribute("fill", roleFill(n.role));
    c.setAttribute("fill-opacity", n.role === "unknown" ? 1 : 0.94);
    c.setAttribute("stroke", selected === n.id ? "#fff" : roleStroke(n.role));
    c.setAttribute("stroke-width", selected === n.id ? 2.5 : 1.5);
    if (n.role === "leader") { // thin outer keyline instead of a star badge
      const key = document.createElementNS(NS, "rect");
      key.setAttribute("class", "node-key");
      key.setAttribute("x", -h - 3); key.setAttribute("y", -h - 3);
      key.setAttribute("width", h * 2 + 6); key.setAttribute("height", h * 2 + 6);
      key.setAttribute("rx", NODE_RX + 2); key.setAttribute("fill", "none");
      key.setAttribute("stroke", "var(--red)"); key.setAttribute("stroke-width", 1.2);
      key.setAttribute("opacity", selected === n.id ? 0.95 : 0.6);
      g.appendChild(key);
    }
    const ini = document.createElementNS(NS, "text");
    ini.setAttribute("class", "node-glyph"); ini.setAttribute("text-anchor", "middle"); ini.setAttribute("y", 4.5);
    ini.setAttribute("font-size", Math.max(9, h * 0.55)); ini.textContent = initials(n.label);
    const t1 = document.createElementNS(NS, "text");
    t1.setAttribute("class", "node-label"); t1.setAttribute("y", h + 14);
    t1.setAttribute("text-anchor", "middle"); t1.textContent = trunc(n.label, 20);
    const t2 = document.createElementNS(NS, "text");
    t2.setAttribute("class", "node-sub"); t2.setAttribute("y", h + 26);
    t2.setAttribute("text-anchor", "middle");
    t2.textContent = n.id + (n.influence != null ? " · " + Number(n.influence).toFixed(2) : "");
    g.append(c, ini, t1, t2);
    nodeEls.set(n.id, {g, label: t1, sub: t2, node: n});
    fragN.appendChild(g);
  }
  gHull.appendChild(fragH); gE.appendChild(fragE); gN.appendChild(fragN);
  applyView(); applyHighlight(); gateLabels(); paintEdgeBeads();
}
/* edge strength glyphs: ×N chip shown only when zoomed in (declutters) */
function paintEdgeBeads() {
  if (view.k < 1.5) { svg.querySelectorAll(".edge-lbl").forEach((e) => e.remove()); return; }
  svg.querySelectorAll(".edge-lbl").forEach((e) => e.remove());
  const f = document.createDocumentFragment();
  for (const e of store.edges) {
    if ((e.strength || 0) < 4) continue;
    const a = nodePos.get(e.src), b = nodePos.get(e.dst);
    if (!a || !b) continue;
    const st = EDGE[e.type] || EDGE.unknown;
    const G = edgeGeom(a, b, halfOf((byId[e.src] || {}).influence), halfOf((byId[e.dst] || {}).influence), e.type === "financial");
    const t = document.createElementNS(NS, "text");
    t.setAttribute("class", "edge-lbl"); t.setAttribute("text-anchor", "middle");
    t.setAttribute("x", (G.x1 + G.x2) / 2 + 8); t.setAttribute("y", (G.y1 + G.y2) / 2 - 6);
    t.setAttribute("fill", st.color); t.textContent = "×" + e.strength;
    f.appendChild(t);
  }
  gE.appendChild(f);
}

/* zoom-gated labels: leaders/selected/hovered always; rest past ~130% */
function gateLabels() {
  const zh = $("zoomHint");
  if (zh) zh.classList.toggle("show", view.k < 1.3 && nodeEls.size > 0);
  const show = view.k >= 1.3;
  nodeEls.forEach((rec, id) => {
    if (!rec.label) return;
    const keep = show || (byId[id] && byId[id].role === "leader") || id === selected || id === hovered;
    rec.label.style.display = keep ? "" : "none";
    if (rec.sub) rec.sub.style.display = keep ? "" : "none";
  });
  paintEdgeBeads();
}
/* re-trim each flat line touching the dragged node to the square edges */
function refreshIncident(id) {
  for (const el of (edgeIdx.get(id) || [])) {
    if (el.tagName !== "line") continue;
    const a = nodePos.get(el.dataset.a), b = nodePos.get(el.dataset.b);
    if (!a || !b) continue;
    const G = edgeGeom(a, b, halfOf((byId[el.dataset.a] || {}).influence), halfOf((byId[el.dataset.b] || {}).influence), el.dataset.type === "financial");
    el.setAttribute("x1", G.x1); el.setAttribute("y1", G.y1);
    el.setAttribute("x2", G.x2); el.setAttribute("y2", G.y2);
  }
}
function toggleCrew(k) {
  collapsed.has(k) ? collapsed.delete(k) : collapsed.add(k);
  computeLayout(); draw();
  toast(collapsed.has(k) ? "Crew " + k + " collapsed (click combo to expand)." : "Crew " + k + " expanded.");
}
/* delegated node events: one listener per group, not per node */
gN.addEventListener("pointerover", (e) => {
  const g = e.target.closest(".node"); if (g) setHover(g.dataset.id);
});
gN.addEventListener("pointerout", (e) => {
  const g = e.target.closest(".node");
  if (g && !g.contains(e.relatedTarget)) setHover(null);
});
gN.addEventListener("click", (e) => {
  if (suppressClick) { suppressClick = false; e.stopPropagation(); return; }
  const g = e.target.closest(".node"); if (!g) return;
  e.stopPropagation();
  const id = g.dataset.id;
  if (id.startsWith("combo:")) { toggleCrew(id.slice(6)); return; }
  focusNode(id, true);
});
gN.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const g = e.target.closest(".node"); if (!g) return;
  e.preventDefault();
  const id = g.dataset.id;
  if (id.startsWith("combo:")) toggleCrew(id.slice(6));
  else focusNode(id, true);
});
/* drag (delegated): only incident edges update */
let dragN = null;
let suppressClick = false;
/* client (viewport) px -> vp-local graph coords. Must use getScreenCTM:
   getCTM() maps to SVG user space and ignores the svg's page offset,
   which is exactly what pushed nodes down-right by (rect.left, rect.top)/k. */
function clientToWorld(e) {
  try {
    const ctm = vp.getScreenCTM();
    if (ctm) return new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
  } catch (_) { /* fall through to manual math */ }
  const r = svg.getBoundingClientRect();
  const tx = W / 2 - view.x * view.k, ty = H / 2 - view.y * view.k;
  return {x: (e.clientX - r.left - tx) / view.k, y: (e.clientY - r.top - ty) / view.k};
}
gN.addEventListener("pointerdown", (e) => {
  const g = e.target.closest(".node"); if (!g) return;
  const id = g.dataset.id;
  if (id.startsWith("combo:")) return;
  const n = nodePos.get(id); if (!n) return;
  const p0 = clientToWorld(e);
  // grab offset so the node doesn't snap its center to the cursor
  dragN = {id, n, g, dx: n.x - p0.x, dy: n.y - p0.y,
           sx: e.clientX, sy: e.clientY, moved: false};
  suppressClick = false;
  e.stopPropagation();
  e.preventDefault();
});
window.addEventListener("pointermove", (e) => {
  if (!dragN) return;
  if (Math.hypot(e.clientX - dragN.sx, e.clientY - dragN.sy) > 3) dragN.moved = true;
  if (!dragN.moved) return;
  const p = clientToWorld(e);
  const nx = p.x + dragN.dx, ny = p.y + dragN.dy;
  dragN.n.x = nx; dragN.n.y = ny;
  dragN.g.setAttribute("transform", "translate(" + nx + "," + ny + ")");
  refreshIncident(dragN.id);
});
window.addEventListener("pointerup", () => {
  if (dragN && dragN.moved) suppressClick = true; // swallow the click that follows a drag
  dragN = null;
});
/* pan + zoom (start from any background: svg, hull, or edge) */
let pan = null;
svg.addEventListener("pointerdown", (e) => {
  if (e.target === svg || e.target === vp || e.target.classList.contains("hull") || e.target.classList.contains("edge")) {
    pan = {x: e.clientX, y: e.clientY, vx: view.x, vy: view.y};
    svg.classList.add("panning");
  }
});
window.addEventListener("pointermove", (e) => {
  if (!pan) return;
  view.x = pan.vx - (e.clientX - pan.x) / view.k;
  view.y = pan.vy - (e.clientY - pan.y) / view.k;
  applyView();
});
window.addEventListener("pointerup", () => { pan = null; svg.classList.remove("panning"); });
svg.addEventListener("wheel", (e) => {
  e.preventDefault();
  view.k = Math.min(3, Math.max(0.5, view.k * (e.deltaY < 0 ? 1.12 : 0.89)));
  applyView(); gateLabels();
}, {passive: false});
svg.addEventListener("click", (e) => {
  if (e.target === svg || e.target === vp || e.target.parentElement === vp) {
    if (selected || isolated) { selected = null; isolated = null; markSelected(null); syncIsolateBtn(); closeDrawer(); }
  }
});
let view = {x: 400, y: 300, k: 1};
function applyView() {
  const tx = W / 2 - view.x * view.k, ty = H / 2 - view.y * view.k;
  $("statZoom").textContent = Math.round(view.k * 100) + "%";
  vp.setAttribute("transform", "translate(" + tx + "," + ty + ") scale(" + view.k + ")");
}
function animateCenter(x, y, k) {
  k = k || Math.max(view.k, 1.35);
  if (reduced) { view = {x, y, k}; applyView(); gateLabels(); return; }
  const from = {...view}, t0 = performance.now(), D = 500;
  (function step(t) {
    const p = Math.min(1, (t - t0) / D), e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    view = {x: from.x + (x - from.x) * e, y: from.y + (y - from.y) * e, k: from.k + (k - from.k) * e};
    applyView(); gateLabels();
    if (p < 1) requestAnimationFrame(step);
  })(t0);
}
function fitView() {
  const pts = [...nodePos.values()].filter((p) => !p.combo);
  if (!pts.length) return;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const bw = Math.max(200, Math.max(...xs) - Math.min(...xs) + 160);
  const bh = Math.max(200, Math.max(...ys) - Math.min(...ys) + 160);
  view = {
    x: (Math.max(...xs) + Math.min(...xs)) / 2,
    y: (Math.max(...ys) + Math.min(...ys)) / 2,
    k: Math.min(2, Math.max(0.5, Math.min(W / bw, H / bh))),
  };
  applyView(); gateLabels();
}
async function focusNode(id, open) {
  selected = id; syncIsolateBtn();
  const n = nodePos.get(id) || byId[id];
  if (!n) return;
  if (egoCenter !== id && !showFull && store.mode !== "mock") {
    // progressive disclosure: re-center ego neighbourhood on demand
    if (store.mode === "live") await expandLive(id, true);
    egoCenter = id; computeLayout(); draw();
  } else if (store.mode === "live" && !nodePos.get(id)) {
    await expandLive(id, true);
  }
  const full = byId[id];
  if (full) {
    $("statSel").textContent = "Selected: " + full.label + " (" + full.id + ") · " + full.role +
      (full.influence != null ? " · infl " + Number(full.influence).toFixed(2) : " · score unavailable");
  }
  const p = nodePos.get(id);
  if (p && !p.combo) animateCenter(p.x, p.y);
  markSelected(id);
  if (open !== false) openDrawer(id);
}
function markSelected(id) {
  nodeEls.forEach((rec, gid) => {
    const c = rec.g.querySelector(".node-core");
    if (c) {
      c.setAttribute("stroke", gid === id ? "#fff" : roleStroke((byId[gid] || {}).role));
      c.setAttribute("stroke-width", gid === id ? 2.5 : 1.5);
    }
  });
  rowEls.forEach((r, rid) => r.classList.toggle("focused", rid === id));
}
function setHover(id) {
  hovered = id; applyHighlight();
  rowEls.forEach((r, rid) => r.classList.toggle("focused", rid === (id || selected)));
  gateLabels();
}
function applyHighlight() {
  if (!hovered) {
    nodeEls.forEach((rec) => rec.g.classList.remove("dim"));
    for (const l of edgeEls) l.classList.remove("dim");
    return;
  }
  const keep = new Set([hovered]);
  for (const l of (edgeIdx.get(hovered) || [])) { keep.add(l.dataset.a); keep.add(l.dataset.b); }
  nodeEls.forEach((rec, gid) => rec.g.classList.toggle("dim", !keep.has(gid)));
  for (const l of edgeEls) l.classList.toggle("dim", !(l.dataset.a === hovered || l.dataset.b === hovered));
}
function sizeGraph() {
  const r = svg.parentElement.getBoundingClientRect();
  W = Math.max(320, r.width); H = Math.max(300, r.height);
  view.x = W / 2; view.y = H / 2;
}

/* ================= PANELS ================= */
function renderEntities() {
  const p = $("entityPanel"); p.innerHTML = ""; rowEls = new Map();
  const rank = [...store.nodes].filter((n) => !n.combo).sort((a, b) => (b.influence || 0) - (a.influence || 0));
  $("entCount").textContent = rank.length + " ranked";
  if (!rank.length) { p.innerHTML = '<div class="empty-note">No entities loaded.</div>'; return; }
  const frag = document.createDocumentFragment();
  rank.slice(0, 40).forEach((e) => {
    const d = document.createElement("div");
    d.className = "entity-row" + (selected === e.id ? " focused" : "");
    d.dataset.id = e.id; d.dataset.role = e.role;
    d.tabIndex = 0; d.setAttribute("role", "button"); d.setAttribute("aria-label", "Focus " + e.label);
    const bar = e.influence != null
      ? '<span class="bar"><i style="width:' + Math.round(Number(e.influence) * 100) + '%"></i></span>'
      : '<span class="unavailable">score unavailable</span>';
    d.innerHTML = '<span class="nm">' + esc(e.label) + '</span>' +
      '<span class="score">' + (e.influence != null ? Number(e.influence).toFixed(2) : "—") + '</span>' + bar +
      '<span><span class="tag ' + e.role + '">' + e.role.toUpperCase() + '</span> <span class="mono">' + esc(e.id) + '</span></span>';
    d.addEventListener("mouseenter", () => setHover(e.id));
    d.addEventListener("mouseleave", () => setHover(null));
    d.addEventListener("click", () => focusNode(e.id, true));
    d.addEventListener("keydown", (ev) => { if (ev.key === "Enter") focusNode(e.id, true); });
    rowEls.set(e.id, d);
    frag.appendChild(d);
  });
  if (rank.length > 40) {
    const more = document.createElement("div");
    more.className = "empty-note";
    more.textContent = "+" + (rank.length - 40) + " more — use search or the graph to reach them.";
    frag.appendChild(more);
  }
  p.appendChild(frag);
}
function alertHTML(a, fresh) {
  const d = document.createElement("div");
  d.className = "alert" + (fresh ? " fresh" : ""); d.dataset.id = a.id;
  d.innerHTML = '<span class="sev ' + a.sev + '"></span><div><p>' +
    (fresh ? '<span class="new-dot"></span>' : "") + esc(a.why) +
    (fresh ? '<span class="new-pill">NEW</span>' : "") + '</p>' +
    '<div class="ents">' + (a.ents || []).map((id) =>
      '<span class="ent-chip" data-id="' + esc(id) + '" title="Focus ' + esc((byId[id] || {}).label || id) + '">' + esc(id) + '</span>').join("") +
    '</div><div class="when">' + esc(a.id) + (a.when ? " · " + esc(a.when) : "") + ' · ' + a.sev.toUpperCase() +
    (a.pattern ? " · " + esc(a.pattern) : "") + '</div></div>';
  d.querySelectorAll(".ent-chip").forEach((c) => {
    c.onclick = (ev) => { ev.stopPropagation(); focusNode(c.dataset.id, true); };
  });
  d.onclick = () => { if (a.ents && a.ents[0]) focusNode(a.ents[0], true); };
  return d;
}
function renderAlerts(freshId) {
  const p = $("alertPanel"); p.innerHTML = "";
  $("alertCount").textContent = store.alerts.length + " open";
  if (!store.alerts.length) {
    p.innerHTML = '<div class="empty-note">No flagged patterns for this dataset.</div>';
  } else {
    const frag = document.createDocumentFragment();
    store.alerts.forEach((a) => frag.appendChild(alertHTML(a, a.id === freshId)));
    p.appendChild(frag);
  }
  renderBell();
}
let unread = 0;
function renderBell() {
  $("bellCount").textContent = unread;
  $("bellCount").style.display = unread ? "flex" : "none";
  const b = $("bellDrop");
  b.innerHTML = '<header><strong>Notifications</strong><button id="markRead">Mark all read</button></header>' +
    (store.alerts.slice(0, 5).map((a) =>
      '<div class="sr-item"><span style="width:9px;height:9px;border-radius:50%;background:' +
      (a.sev === "high" ? "var(--red)" : a.sev === "med" ? "var(--amber)" : "var(--slate)") +
      '"></span><span>' + esc(a.why.slice(0, 72)) + '…</span></div>').join("") ||
      '<div class="empty-note" style="margin:8px">No alerts.</div>');
  $("markRead").onclick = (e) => { e.stopPropagation(); unread = 0; renderBell(); toast("All notifications marked read."); };
}
/* search: local in mock/upload, API in live */
function searchLocal(q) {
  q = q.trim().toLowerCase(); if (!q) return [];
  const qd = q.replace(/\D/g, ""), out = [];
  for (let i = 0; i < store.nodes.length; i++) {
    if (!HAY[i].includes(q)) continue;
    const e = store.nodes[i];
    out.push({e, exact: e.label.toLowerCase() === q ||
      (qd.length >= 4 && (e.phones || []).some((p) => p.replace(/\D/g, "").includes(qd)))});
    if (out.length >= 8) break;
  }
  return out.sort((a, b) => (b.exact ? 1 : 0) - (a.exact ? 1 : 0));
}
async function doSearch(q) {
  q = (q || "").trim(); if (!q) return [];
  if (store.mode === "live") {
    try {
      const r = await Live.req("/search", {method: "POST", body: {query: q, limit: 8}});
      return (r.results || []).map((s) => ({live: s}));
    } catch (e) { toast(String(e.message || e)); return searchLocal(q); }
  }
  return searchLocal(q);
}
function paintSearchResults(items) {
  const sRes = $("searchResults");
  if (!items.length) {
    sRes.innerHTML = '<div class="empty-note" style="margin:8px">No matches. Try a surname, phone fragment, or plate.</div>';
    return;
  }
  sRes.innerHTML = items.map((it) => {
    if (it.live) {
      const s = it.live;
      return '<div class="sr-item" data-id="' + esc(s.id) + '" data-live="1" role="option"><strong>' + esc(s.name || s.id) +
        '</strong><span class="mono">' + esc(s.id) + '</span><span class="role-tag tag member">' + esc((s.match_type || "fuzzy").toUpperCase()) + '</span></div>';
    }
    const e = it.e;
    return '<div class="sr-item" data-id="' + esc(e.id) + '" role="option"><strong>' + esc(e.label) +
      '</strong><span class="mono">' + esc(e.id) + '</span><span class="role-tag tag ' + e.role + '">' + e.role.toUpperCase() + '</span></div>';
  }).join("");
  sRes.querySelectorAll(".sr-item").forEach((el) => {
    el.onclick = async () => {
      sRes.classList.remove("open"); $("globalSearch").value = "";
      if (el.dataset.live && store.mode === "live") await expandLive(el.dataset.id, true);
      focusNode(el.dataset.id, true);
    };
  });
}
/* watchlist */
let watch = ["P01", "P05", "P07"];
function renderWatch() {
  const w = $("watchList"); w.innerHTML = "";
  const frag = document.createDocumentFragment();
  if (!watch.length) {
    w.innerHTML = '<div class="empty-note">Watchlist is empty.<br>Open a dossier and “Watch” an entity to track it here.</div>';
    return;
  }
  watch.forEach((id) => {
    const e = byId[id]; if (!e) return;
    const d = document.createElement("div"); d.className = "watch-item";
    d.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:' +
      (e.role === "leader" ? "var(--red)" : e.role === "bridge" ? "var(--amber)" : "var(--slate)") +
      '"></span><span>' + esc(e.label) + ' <span class="mono">' + esc(id) + '</span></span>' +
      '<button class="rm" aria-label="Remove ' + esc(e.label) + '">×</button>';
    d.onclick = (ev) => {
      if (ev.target.classList.contains("rm")) { watch = watch.filter((x) => x !== id); renderWatch(); }
      else focusNode(id, true);
    };
    frag.appendChild(d);
  });
  w.appendChild(frag);
}
/* drawer + minimap */
function openDrawer(id) {
  const e = byId[id]; if (!e) return;
  drawerLoading(e);
  if (store.mode === "live") {
    Live.req("/entities/" + encodeURIComponent(id)).then(
      (d) => drawerLive(e, d),
      () => { drawerLocal(e); toast("Detail fetch failed — showing cached fields."); });
  } else drawerLocal(e);
}
function drawerShell(e) {
  $("dPhoto").textContent = initials(e.label);
  $("dName").textContent = e.label;
  $("dTags").innerHTML = '<span class="tag ' + e.role + '">' + e.role.toUpperCase() + '</span>' +
    '<span class="mono">' + esc(e.id) +
    (e.influence != null ? " · infl " + Number(e.influence).toFixed(2) : " · score unavailable") +
    (e.community != null ? " · crew " + esc(e.community) : "") + '</span>';
  $("drawer").classList.add("open"); $("backdrop").classList.add("show");
}
function drawerLoading(e) {
  drawerShell(e);
  $("drawerBody").innerHTML = '<div class="sk"><i class="w80"></i><i></i><i class="w60"></i></div>';
}
function kvRows(e) {
  return '<dl class="kv"><dt>Aliases</dt><dd>' + (e.aliases.length ? esc(e.aliases.join(", ")) : "— none recorded —") +
    '</dd><dt>Phones</dt><dd>' + (e.phones.length ? e.phones.map((p) => '<span class="mono">' + esc(p) + '</span>').join("<br>") : "—") +
    '</dd><dt>Vehicles</dt><dd>' + (e.vehicles.length ? e.vehicles.map((v) => '<span class="mono">' + esc(v) + '</span>').join("<br>") : "—") +
    '</dd><dt>Cases</dt><dd>' + (e.cases.length ? e.cases.map((c) => '<span class="mono">' + esc(c) + '</span>').join(", ") : "—") + '</dd></dl>';
}
function drawerLocal(e) {
  drawerShell(e);
  const tl = e.timeline.length
    ? '<ul class="tl">' + e.timeline.map(([d, t, hot]) =>
        '<li class="' + (hot ? "hot" : "") + '">' + esc(t) + '<span class="mono">' + esc(d) + '</span></li>').join("") + '</ul>'
    : '<div class="empty-note">No activity recorded for this entity.</div>';
  // upload-mode timelines synthesized from edge metadata happen at load; nothing invented here
  $("drawerBody").innerHTML = kvRows(e) +
    '<button id="watchBtn" class="' + (watch.includes(e.id) ? "" : "primary") + '">' +
    (watch.includes(e.id) ? "✓ On watchlist" : "+ Watch entity") + '</button>' +
    '<h4>Activity timeline</h4>' + tl +
    '<h4>Ego network — 1 hop</h4><svg id="minimap" role="img" aria-label="Ego network mini map"></svg>';
  $("watchBtn").onclick = () => {
    watch.includes(e.id) ? watch = watch.filter((x) => x !== e.id) : watch.push(e.id);
    renderWatch(); drawerLocal(e);
    toast(watch.includes(e.id) ? e.label + " added to watchlist." : e.label + " removed from watchlist.");
  };
  drawMinimap(e);
}
function drawerLive(e, d) {
  drawerShell(e);
  const props = d.properties || {};
  const extra = Object.keys(props).filter((k) => !/^(label|name|source|raw_id|id)$/i.test(k))
    .map((k) => '<dt>' + esc(k) + '</dt><dd><span class="mono">' + esc(String(props[k]).slice(0, 120)) + '</span></dd>').join("");
  const tl = (d.neighbours_sample || []).length
    ? '<ul class="tl">' + d.neighbours_sample.slice(0, 12).map((n) =>
        '<li><span class="mono">' + esc(n) + '</span> — linked entity (click to open)</li>').join("") + '</ul>'
    : '<div class="empty-note">No neighbour sample returned.</div>';
  $("drawerBody").innerHTML =
    '<dl class="kv"><dt>Degree</dt><dd><span class="mono">' + d.degree + ' (in ' + d.in_degree + ' / out ' + d.out_degree + ')</span></dd>' +
    '<dt>Source</dt><dd><span class="mono">' + esc(d.source || "—") + '</span></dd>' + extra + '</dl>' +
    '<button id="watchBtn" class="' + (watch.includes(e.id) ? "" : "primary") + '">' +
    (watch.includes(e.id) ? "✓ On watchlist" : "+ Watch entity") + '</button>' +
    '<h4>Linked entities</h4>' + tl +
    '<h4>Ego network — 1 hop</h4><svg id="minimap" role="img" aria-label="Ego network mini map"></svg>';
  $("watchBtn").onclick = () => {
    watch.includes(e.id) ? watch = watch.filter((x) => x !== e.id) : watch.push(e.id);
    renderWatch(); drawerLive(e, d);
  };
  $("drawerBody").querySelectorAll(".tl .mono").forEach((m) => {
    m.style.cursor = "pointer";
    m.onclick = () => focusNode(m.textContent, true);
  });
  drawMinimap(e);
}
function drawMinimap(e) {
  const mm = $("minimap"); if (!mm) return;
  const W2 = mm.clientWidth || 380, H2 = 170, cx = W2 / 2, cy = H2 / 2;
  mm.setAttribute("viewBox", "0 0 " + W2 + " " + H2);
  const nb = [...neighbors(e.id)].slice(0, 8);
  let s = "";
  nb.forEach((id, i) => {
    const a = (i / Math.max(1, nb.length)) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * 110, y = cy + Math.sin(a) * 52;
    const n = byId[id] || {role: "unknown"};
    s += '<line x1="' + cx + '" y1="' + cy + '" x2="' + x + '" y2="' + y + '" stroke="var(--line-strong)" stroke-width="1.5"/>' +
      '<rect x="' + (x - 11) + '" y="' + (y - 11) + '" width="22" height="22" fill="' + roleFill(n.role) + '" stroke="var(--line-strong)"/>' +
      '<text x="' + x + '" y="' + (y + 24) + '" text-anchor="middle" font-size="9" fill="var(--muted)">' + esc(id.slice(0, 10)) + '</text>';
  });
  s += '<rect x="' + (cx - 16) + '" y="' + (cy - 16) + '" width="32" height="32" fill="' + roleFill(e.role) + '"/>' +
    '<text x="' + cx + '" y="' + (cy + 4) + '" text-anchor="middle" font-size="10" fill="#fff" font-weight="bold">' + esc(initials(e.label)) + '</text>';
  mm.innerHTML = s || '<text x="10" y="20" fill="var(--muted)" font-size="12">No 1-hop links under current filters.</text>';
}
function closeDrawer() { $("drawer").classList.remove("open"); $("backdrop").classList.remove("show"); }
/* document viewer */
function renderDoc() {
  const sec = $("docSec"), body = $("docBody");
  if (!store.doc) {
    if (store.mode === "live") {
      sec.style.display = "";
      body.innerHTML = '<div class="empty-note">Source documents are not exposed by the live API.<br>Upload a .txt report in Upload mode to inspect one here.</div>';
      $("docLegend").innerHTML = "";
      $("docMeta").innerHTML = "";
    } else sec.style.display = "none";
    return;
  }
  sec.style.display = "";
  $("docMeta").innerHTML = '<span class="mono">' + esc(store.doc.title) + '</span><span>' + esc(store.doc.meta) + '</span>';
  body.innerHTML = "";
  const frag = document.createDocumentFragment();
  store.doc.segments.forEach((seg) => {
    if (!seg.e) { frag.appendChild(document.createTextNode(seg.t)); return; }
    const m = document.createElement("mark");
    m.className = seg.pid ? "t-PERSON" : (ENT_CLS[seg.e] || "t-LOC");
    m.textContent = seg.t;
    if (seg.pid && byId[seg.pid]) {
      m.title = byId[seg.pid].label + " (" + seg.pid + ") — click to focus";
      m.onclick = () => focusNode(seg.pid, true);
    }
    frag.appendChild(m);
  });
  body.appendChild(frag);
  $("docLegend").innerHTML =
    [["var(--red)", "Person"], ["var(--amber)", "Phone / money"], ["var(--sel)", "Vehicle"], ["var(--slate)", "Location / case"]]
    .map(([c, l]) => '<span><i style="background:' + c + '"></i>' + l + ' — click a name to focus graph</span>').join("");
}

/* ================= MODE SWITCHING ================= */
function setModeBadge() {
  $("modeBadge").textContent = store.badge + (store.note ? " · " + store.note : "");
  document.querySelectorAll("#modeSeg button").forEach((b) =>
    b.classList.toggle("on", b.dataset.mode === store.mode));
}
function resetViewState() {
  selected = null; hovered = null; isolated = null;
  collapsed.clear(); showFull = false; egoCenter = null;
  syncFullBtn(); syncIsolateBtn(); closeDrawer();
}
function afterLoad() {
  if (window._paintLinkCounts) window._paintLinkCounts();
  resetViewState();
  const top = [...store.nodes].sort((a, b) => (b.influence || 0) - (a.influence || 0))[0];
  egoCenter = top ? top.id : null;   // Cambridge: ego-focus default (progressive disclosure)
  computeLayout(); view = {x: W / 2, y: H / 2, k: 1};
  draw(); renderEntities(); renderAlerts(); renderDoc(); renderWatch();
  setModeBadge(); syncFullBtn(); syncIsolateBtn(); fitView();
  $("graphLoading").classList.remove("show"); hideGraphError();
}
function showGraphError(msg, retry) {
  const box = $("graphError");
  box.innerHTML = "<strong>Graph failed to load.</strong><br>" + esc(msg) +
    (retry ? '<br><br><button id="graphRetry">Retry</button>' : "");
  box.classList.add("show");
  if (retry) $("graphRetry").onclick = retry;
}
function hideGraphError() { $("graphError").classList.remove("show"); }
async function switchMode(mode) {
  if (mode === store.mode && store.nodes.length) return;
  $("graphLoading").classList.add("show"); hideGraphError();
  try {
    if (mode === "mock") { loadMock(); unread = store.alerts.length; afterLoad(); }
    else if (mode === "live") { openSettings(true); $("graphLoading").classList.remove("show"); return; }
    else if (mode === "upload") { openUpload(); $("graphLoading").classList.remove("show"); return; }
  } catch (e) { showGraphError(String(e.message || e), () => switchMode(mode)); }
  $("graphLoading").classList.remove("show");
}
async function connectLive() {
  $("graphLoading").classList.add("show"); hideGraphError();
  try {
    await loadLiveSeed();
    unread = store.alerts.length;
    afterLoad();
    toast("Live: " + store.stats.nodes + " nodes, " + store.stats.edges + " edges on server.");
  } catch (e) { showGraphError(String(e.message || e), connectLive); }
  $("graphLoading").classList.remove("show");
}
/* settings + upload dialogs */
function openSettings(first) {
  $("liveBase").value = Live.base; $("liveKey").value = Live.key;
  $("liveRemember").checked = Live.remember;
  $("liveStatus").textContent = first ? "" : $("liveStatus").textContent;
  $("settingsDlg").classList.add("show");
}
function closeSettings() { $("settingsDlg").classList.remove("show"); }
function openUpload() { $("uploadDlg").classList.add("show"); }
function closeUpload() { $("uploadDlg").classList.remove("show"); }
function readFile(input) {
  return new Promise((res) => {
    const f = input.files && input.files[0];
    if (!f) return res("");
    const r = new FileReader();
    r.onload = () => res(String(r.result || ""));
    r.onerror = () => res("");
    r.readAsText(f);
  });
}

/* ================= WIRING (runs on DOMContentLoaded) ================= */
function stage(name, fn) {
  try { fn(); }
  catch (e) { showGraphError(name + ": " + (e.message || e), null); throw e; }
}
document.addEventListener("DOMContentLoaded", () => {
  Live.load();
  // theme
  const setTheme = (t) => {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem("cnis-theme", t); } catch (e) {}
    $("themeBtn").textContent = t === "dark" ? "◐ Case file" : "◑ Command";
  };
  try { setTheme(localStorage.getItem("cnis-theme") || "dark"); } catch (e) { setTheme("dark"); }
  $("themeBtn").onclick = () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");

  sizeGraph();
  new ResizeObserver(() => {           // graph can never be stuck at 0×0
    const before = W + "x" + H;
    sizeGraph();
    if (before !== W + "x" + H && store.nodes.length) { computeLayout(); draw(); }
  }).observe(svg.parentElement);

  stage("mock data", () => { loadMock(); });
  stage("document", () => renderDoc());
  stage("watchlist", () => renderWatch());
  stage("alerts", () => { unread = store.alerts.length; renderAlerts(); });
  // panels paint first; graph on the next frame (no fake delay)
  requestAnimationFrame(() => {
    try {
      const top = [...store.nodes].sort((a, b) => (b.influence || 0) - (a.influence || 0))[0];
      egoCenter = top ? top.id : null;
      computeLayout(); view = {x: W / 2, y: H / 2, k: 1};
      draw(); renderEntities(); setModeBadge(); syncFullBtn(); syncIsolateBtn(); fitView();
      $("graphLoading").classList.remove("show");
    } catch (e) { showGraphError("initial render: " + (e.message || e), () => location.reload()); }
  });
  // demo "new alert" once (motion spec: single slide+fade, NEW pulses twice)
  setTimeout(() => {
    if (store.mode !== "mock") return;
    const fresh = {id: "A7", sev: "high", why: "Fresh FIR amendment names a second hawala courier tied to Qureshi — review before the morning briefing.", ents: ["P05", "P06"], when: "just now"};
    store.alerts.unshift(fresh); unread++; renderAlerts("A7");
    toast("New flagged pattern arrived — see Flagged patterns panel.");
  }, reduced ? 1200 : 9000);

  /* toolbar */
  const tf = $("typeFilters");
  const swCls = (k) => k === "colocated" ? "sw dash" : k === "kin" || k === "unknown" ? "sw dots" : "sw";
  const paintCounts = () => {
    const counts = {};
    for (const e of store.edges) counts[e.type] = (counts[e.type] || 0) + 1;
    tf.querySelectorAll("label").forEach((l) => {
      const c = l.querySelector(".cnt");
      if (c) c.textContent = counts[l.dataset.type] || 0;
    });
  };
  window._paintLinkCounts = paintCounts;
  TYPES.forEach(([k, label]) => {
    const st = EDGE[k];
    const l = document.createElement("label");
    l.className = "on"; l.dataset.type = k;
    l.title = st.label + " — " + st.desc + (k === "financial" ? " · arrow shows direction" : st.dash ? (k === "kin" || k === "unknown" ? " · dotted line" : " · dashed line") : " · solid line");
    l.innerHTML = '<input type="checkbox" checked aria-label="' + label + ' relationships"> ' +
      '<span class="sw' + (swCls(k) === "sw" ? "" : " " + swCls(k).slice(3)) + '" style="color:' + st.color + ';border-color:' + st.color + '"></span> ' +
      '<span>' + label + '</span> <span class="cnt">0</span>';
    l.querySelector("input").onchange = (ev) => {
      ev.target.checked ? activeTypes.add(k) : activeTypes.delete(k);
      l.classList.toggle("on", ev.target.checked);
      computeLayout(); draw();
      toast(ev.target.checked ? st.label + " links shown." : st.label + " links hidden.");
    };
    tf.appendChild(l);
  });
  paintCounts();
  /* filter chips carry their own color key so the chip = the line it toggles */
  tf.querySelectorAll("label").forEach((l) => {
    const key = TYPES.map((t) => t[1]).indexOf(l.textContent.trim()) >= 0
      ? TYPES.find((t) => l.textContent.trim() === t[1])[0] : null;
    const st = key && EDGE[key];
    if (st) {
      l.style.borderLeft = "3px solid " + st.color;
      l.title = st.label + " — " + st.desc + (st.flow ? " · arrow + travelling dots" : st.dash ? " · " + (key === "kin" ? "dotted" : "dashed") + " line" : " · solid line");
    }
  });
  $("layoutSel").onchange = (e) => { layoutName = e.target.value; computeLayout(); draw(); toast("Layout recalculated — manual node positions reset."); };
  $("fitBtn").onclick = fitView;
  $("zoomIn").onclick = () => zoomBy(1.2);
  $("zoomOut").onclick = () => zoomBy(1 / 1.2);
  window.addEventListener("keydown", (e) => {
    if (/INPUT|TEXTAREA/.test(document.activeElement && document.activeElement.tagName || "") || e.target === $("layoutSel")) return;
    if (e.key === "+") zoomBy(1.2);
    else if (e.key === "-") zoomBy(1 / 1.2);
    else if (e.key.toLowerCase() === "f") fitView();
  });
  $("fullNetBtn").onclick = () => { showFull = !showFull; syncFullBtn(); computeLayout(); draw(); };
  $("isolateBtn").onclick = () => {
    if (!selected) { toast("Select a node first, then isolate."); return; }
    isolated = isolated ? null : selected; syncIsolateBtn(); computeLayout(); draw();
  };
  $("resetView").onclick = () => {
    isolated = null; syncIsolateBtn(); selected = null; closeDrawer(); fitView(); markSelected(null);
    $("statSel").textContent = "Click a node for detail · drag node to move · drag background to pan · scroll or + / - to zoom";
  };
  $("reloadData").onclick = () => {
    if (store.mode === "live") connectLive();
    else { computeLayout(); view = {x: W / 2, y: H / 2, k: 1}; draw(); fitView(); }
  };
  $("emptyReset").onclick = () => {
    TYPES.forEach(([k]) => activeTypes.add(k));
    tf.querySelectorAll("label").forEach((l) => { l.classList.add("on"); l.querySelector("input").checked = true; });
    computeLayout(); draw();
  };
  /* modes */
  document.querySelectorAll("#modeSeg button").forEach((b) => { b.onclick = () => switchMode(b.dataset.mode); });
  $("liveBtn").onclick = () => openSettings(false);
  $("uploadBtn").onclick = () => openUpload();
  /* settings dialog */
  $("settingsClose").onclick = closeSettings;
  $("liveTest").onclick = async () => {
    Live.base = $("liveBase").value.trim() || Live.base;
    Live.key = $("liveKey").value;
    $("liveStatus").textContent = "Testing…";
    try {
      const h = await Live.req("/health"), s = await Live.req("/stats");
      $("liveStatus").textContent = "OK — " + (h.backend || "backend") + ", " + s.nodes + " nodes / " + s.edges + " edges.";
    } catch (e) { $("liveStatus").textContent = String(e.message || e); }
  };
  $("liveSave").onclick = async () => {
    Live.base = $("liveBase").value.trim() || Live.base;
    Live.key = $("liveKey").value;
    Live.remember = $("liveRemember").checked;
    Live.save(); closeSettings();
    await switchModeSilentLive();
  };
  /* upload dialog */
  $("uploadClose").onclick = closeUpload;
  $("tplCsv").onclick = () => download("nodes_template.csv",
    "person_id:ID,person_id,source\nP1,Asha Rao,demo\nP2,Vikram Rao,demo\n") ||
    download("edges_template.csv", ":START_ID,:END_ID,:TYPE,frequency\nP1,P2,CALLED,5\n");
  $("tplJson").onclick = () => download("graph_template.json",
    JSON.stringify({nodes: [{id: "P1", label: "Asha Rao"}, {id: "P2", label: "Vikram Rao"}], edges: [{src: "P1", dst: "P2", rel: "CALLED", frequency: 5}]}, null, 1));
  $("uploadValidate").onclick = async () => {
    const nt = await readFile($("upNodes")), et = await readFile($("upEdges")),
          jt = await readFile($("upJson")), dt = await readFile($("upDoc"));
    const rep = validateUpload(nt, et, jt);
    window._upReport = {rep, docText: dt, docName: ($("upDoc").files[0] || {}).name || "report.txt"};
    const box = $("uploadReport");
    box.innerHTML = "<strong>" + rep.nodes.length + " nodes · " + rep.edges.length + " edges parsed.</strong>" +
      (rep.errors.length ? "<ul>" + rep.errors.slice(0, 10).map((e) => "<li>" + esc(e) + "</li>").join("") + "</ul>" : "<p>No errors.</p>") +
      '<br><button id="uploadLoad" ' + (rep.ok ? "" : "disabled") + '>Load into graph</button>';
    box.classList.add("show");
    if (rep.ok) $("uploadLoad").onclick = loadUploadReport;
  };
  /* search */
  const sIn = $("globalSearch"), sRes = $("searchResults");
  let queued = false;
  sIn.addEventListener("input", () => {
    if (queued) return; queued = true;
    requestAnimationFrame(async () => {
      queued = false;
      const items = await doSearch(sIn.value);
      if (!sIn.value.trim()) { sRes.classList.remove("open"); sRes.innerHTML = ""; return; }
      sRes.classList.add("open");
      paintSearchResults(items);
    });
  });
  sIn.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    const items = await doSearch(sIn.value);
    if (items.length) {
      sRes.classList.remove("open"); sIn.value = "";
      const it = items[0];
      if (it.live && store.mode === "live") await expandLive(it.live.id, true);
      focusNode(it.live ? it.live.id : it.e.id, true);
    } else toast("No matches — try a surname, phone fragment, or plate.");
  });
  document.addEventListener("click", (e) => { if (!e.target.closest(".search-wrap")) sRes.classList.remove("open"); });
  document.querySelectorAll(".saved-item").forEach((s) => {
    s.onclick = async () => {
      const items = await doSearch(s.dataset.q);
      if (!items.length) { toast("Saved search returned 0 hits."); return; }
      const it = items[0];
      if (it.live && store.mode === "live") await expandLive(it.live.id, true);
      focusNode(it.live ? it.live.id : it.e.id, true);
    };
  });
  /* bell + drawer + cases */
  $("bellBtn").onclick = (e) => { e.stopPropagation(); $("bellDrop").classList.toggle("open"); };
  document.addEventListener("click", () => $("bellDrop").classList.remove("open"));
  $("drawerClose").onclick = closeDrawer;
  $("backdrop").onclick = closeDrawer;
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeDrawer(); $("bellDrop").classList.remove("open"); closeSettings(); closeUpload(); }
  });
  document.querySelectorAll(".case-item").forEach((c) => {
    c.onclick = () => {
      document.querySelectorAll(".case-item").forEach((x) => x.classList.remove("active"));
      c.classList.add("active");
      if (c.dataset.case !== "copper") toast("Demo scope: full graph only loaded for Copper Ledger.");
    };
  });
  window.addEventListener("resize", () => { sizeGraph(); });
});
function syncFullBtn() {
  $("fullNetBtn").textContent = showFull ? "Ego focus: on" : "Full network";
  $("fullNetBtn").classList.toggle("on", showFull);
  $("fullNetBtn").title = showFull ? "Showing the full network — click for 1-hop ego focus" : "Showing 1-hop ego focus — click for the full network";
  syncScopeBanner();
}
function syncIsolateBtn() {
  $("isolateBtn").classList.toggle("on", !!isolated);
  $("isolateBtn").disabled = !isolated && !selected;
  $("isolateBtn").title = isolated ? "Clear isolation" : selected ? "Show only the selected node and its neighbours" : "Select a node first, then isolate";
  syncScopeBanner();
}
function syncScopeBanner() {
  const b = $("scopeBanner"); if (!b) return;
  const parts = [];
  if (isolated && byId[isolated]) parts.push({t: "Isolated: " + byId[isolated].label + " (" + isolated + ")", fn: () => { isolated = null; syncIsolateBtn(); computeLayout(); draw(); }, btn: "Clear"});
  else if (!showFull && egoCenter && byId[egoCenter]) parts.push({t: "1-hop focus: " + byId[egoCenter].label + " · " + visibleSet().size + "/" + store.nodes.length + " nodes", fn: () => { showFull = true; syncFullBtn(); computeLayout(); draw(); }, btn: "Full network"});
  if (!parts.length) { b.classList.remove("show"); b.innerHTML = ""; return; }
  b.innerHTML = "";
  const s = document.createElement("span"); s.textContent = parts[0].t;
  const btn = document.createElement("button"); btn.textContent = parts[0].btn;
  btn.onclick = (ev) => { ev.stopPropagation(); parts[0].fn(); };
  b.append(s, btn); b.classList.add("show");
}
function zoomBy(f) {
  view.k = Math.min(3, Math.max(0.5, view.k * f));
  applyView(); gateLabels();
}
async function switchModeSilentLive() {
  store.mode = "live-pending";
  await connectLive();
}
function download(name, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], {type: "text/plain"}));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function loadUploadReport() {
  const {rep, docText, docName} = window._upReport;
  // synthesize timelines from nothing? No — honest empty, edges carry the story
  store.mode = "upload";
  store.badge = "UPLOAD — " + ((($("upJson").files[0] || {}).name) || "nodes+edges CSV");
  store.note = "parsed locally in your browser";
  store.nodes = rep.nodes.map((n) => ({...n, timeline: Array.isArray(n.timeline) ? n.timeline : []}));
  store.edges = rep.edges;
  store.alerts = [];
  if (docText && docText.trim()) {
    store.doc = {title: docName, meta: "uploaded report · client-side highlight", segments: highlightText(docText.slice(0, 20000))};
  } else store.doc = null;
  store.stats = {nodes: store.nodes.length, edges: store.edges.length};
  rebuildIndex(); closeUpload(); unread = 0;
  afterLoad();
  toast("Loaded " + store.nodes.length + " nodes / " + store.edges.length + " edges.");
}
