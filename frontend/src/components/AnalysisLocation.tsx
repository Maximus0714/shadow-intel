import { useWorkspace } from "../lib/state/workspace";

export default function AnalysisLocation({
  disabled = false,
}: {
  disabled?: boolean;
}) {
  const { engine, setEngine } = useWorkspace();
  return (
    <label className="field">
      <span>Analyze using</span>
      <select
        value={engine}
        disabled={disabled}
        onChange={(e) => setEngine(e.target.value as "backend" | "local")}
      >
        <option value="backend">Connected backend</option>
        <option value="local">On this device</option>
      </select>
      <small>
        {engine === "backend"
          ? "Sends submitted evidence to this website’s analysis server. Results are saved in this browser; the server does not retain the upload. No API key needed."
          : "Processes evidence in your browser without sending it to the server. Results are saved on this device."}
      </small>
    </label>
  );
}
