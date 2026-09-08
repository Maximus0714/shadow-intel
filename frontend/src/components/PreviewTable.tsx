import type { CleanedEdge, SkippedRow } from "../lib/upload";

interface Props {
  columns: string[];
  rows: CleanedEdge[];
  skipped: SkippedRow[];
}

export default function PreviewTable({ columns, rows, skipped }: Props) {
  return (
    <div>
      <p className="mono" style={{ marginBottom: 6 }}>
        {rows.length} cleaned edges · columns: {columns.join(", ") || "-"}
      </p>
      {rows.length > 0 ? (
        <table className="data">
          <thead>
            <tr>
              <th>Source</th>
              <th>Target</th>
              <th>Rel</th>
              <th>Freq</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 50).map((r, i) => (
              <tr key={i}>
                <td className="mono">{r.src}</td>
                <td className="mono">{r.dst}</td>
                <td className="mono">{r.rel}</td>
                <td className="mono">{r.frequency}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="empty">No usable rows found.</div>
      )}
      {skipped.length > 0 && (
        <details className="ev">
          <summary>Skipped rows ({skipped.length})</summary>
          <ul style={{ paddingLeft: 18 }}>
            {skipped.slice(0, 30).map((s, i) => (
              <li key={i} className="mono">
                row {s.row}: {s.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
