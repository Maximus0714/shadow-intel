import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Brand, Empty, Loading } from "../components/UI";
import { supabase } from "../lib/auth";
import type { LocalDataset } from "../lib/analysis/local";
export default function SharedInvestigation() {
  const { token } = useParams(); const [data, setData] = useState<LocalDataset | null>(null); const [loading, setLoading] = useState(true);
  useEffect(() => { if (!supabase || !token) { setLoading(false); return; } supabase.rpc("get_shared_investigation", { share_id: token }).then(({ data }) => { setData((data || null) as LocalDataset | null); setLoading(false); }); }, [token]);
  return <main className="shared-page"><Brand />{loading ? <Loading /> : data ? <><div className="overline">READ-ONLY SHARED INVESTIGATION</div><h1>{data.name}</h1><p className="muted">Generated {new Date(data.created).toLocaleString()} · Analysis {data.analysis_version}</p><div className="metric-grid"><div className="metric-card"><span>Entities</span><strong>{data.graph.total_nodes}</strong></div><div className="metric-card"><span>Relationships</span><strong>{data.graph.total_edges}</strong></div><div className="metric-card"><span>Signals</span><strong>{data.alerts.length}</strong></div><div className="metric-card"><span>Communities</span><strong>{data.communities.length}</strong></div></div><section className="panel"><h2>Review signals</h2>{data.alerts.slice(0, 20).map((alert, index) => <div className="shared-signal" key={index}><strong>{alert.pattern_type.replace(/_/g, " ")}</strong><p>{alert.plain_language_explanation}</p><small>{alert.entities_involved.join(" · ")}</small></div>)}</section></> : <Empty title="Share unavailable" body="This link is invalid, expired, revoked, or cloud sharing has not been configured." />}</main>;
}
