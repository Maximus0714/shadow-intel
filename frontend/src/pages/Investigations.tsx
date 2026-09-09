import { ClockCounterClockwise, ArrowUpRight } from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import { PageHeader, Empty } from "../components/UI";
import { useWorkspace } from "../lib/state/workspace";
export default function Investigations() {
  const { history, reopenInvestigation } = useWorkspace();
  return <><PageHeader title="Past investigations" description="Reopen analyses saved for your signed-in account." />{history.length === 0 ? <Empty title="No saved investigations yet" body="Upload evidence and run an analysis to see it here." action={<Link className="btn primary" to="/upload">Upload evidence <ArrowUpRight size={16} /></Link>} /> : <div className="investigation-list">{history.map((item) => <article className="panel investigation-card" key={item.id}><div className="investigation-icon"><ClockCounterClockwise size={22} /></div><div className="investigation-copy"><h2>{item.name}</h2><p>{new Date(item.created).toLocaleString()} · {item.engine} analysis · {item.nodes} entities · {item.edges} relationships</p></div><button className="btn" onClick={() => void reopenInvestigation(item)}>Reopen</button></article>)}</div>}</>;
}
