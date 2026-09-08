import { useEffect, useState } from "react";
import { BrowserRouter, Link, NavLink, Route, Routes } from "react-router-dom";
import Overview from "./pages/Overview";
import NetworkExplorer from "./pages/NetworkExplorer";
import Entities from "./pages/Entities";
import Alerts from "./pages/Alerts";
import Documents from "./pages/Documents";
import UploadSettings from "./pages/UploadSettings";

const NAV = [
  { to: "/", label: "Overview", end: true },
  { to: "/network", label: "Network Explorer", end: false },
  { to: "/entities", label: "Entities & Search", end: false },
  { to: "/alerts", label: "Alerts & Patterns", end: false },
  { to: "/documents", label: "Document Intel", end: false },
  { to: "/upload", label: "Upload & Settings", end: false },
];

export default function App() {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("shadowintel-theme") || "dark";
    } catch {
      return "dark";
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("shadowintel-theme", theme);
    } catch {
      /* storage unavailable */
    }
  }, [theme]);
  return (
    <BrowserRouter>
      <div className="shell">
        <aside className="sidebar" aria-label="Primary">
          <Link to="/" className="brand">
            <span className="brand-mark">S</span>
            <span className="brand-name">
              Shadow Intel<small>FROM EVIDENCE TO INTELLIGENCE</small>
            </span>
          </Link>
          <nav className="nav">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
        </aside>
        <div className="main">
          <header className="topbar">
            <span className="case-chip">
              <span className="dot" aria-hidden="true" />
              Operation Copper Ledger
            </span>
            <button
              className="btn"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label="Toggle color theme"
            >
              {theme === "dark" ? "Case file" : "Command"}
            </button>
          </header>
          <main className="page">
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/network" element={<NetworkExplorer />} />
              <Route path="/entities" element={<Entities />} />
              <Route path="/entities/:id" element={<Entities />} />
              <Route path="/alerts" element={<Alerts />} />
              <Route path="/documents" element={<Documents />} />
              <Route path="/upload" element={<UploadSettings />} />
              <Route path="*" element={<div className="empty">Page not found. <Link to="/">Back to Overview</Link>.</div>} />
            </Routes>
          </main>
        </div>
      </div>
    </BrowserRouter>
  );
}
