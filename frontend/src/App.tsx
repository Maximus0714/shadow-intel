import { lazy, Suspense, useEffect, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  Link,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  IconContext,
  House,
  Graph,
  UsersThree,
  ShieldWarning,
  FileText,
  UploadSimple,
  SquaresFour,
  BookmarkSimple,
  List,
  X,
  MagnifyingGlass,
  ArrowUpRight,
  CheckCircle,
  CaretRight,
  ClockCounterClockwise,
} from "@phosphor-icons/react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { WorkspaceProvider, useWorkspace } from "./lib/state/workspace";
import { AuthProvider, useAuth } from "./lib/auth";
import { Brand, ThemeButton, Loading } from "./components/UI";
import Landing from "./pages/Landing";
import SignIn from "./pages/SignIn";
const Overview = lazy(() => import("./pages/Overview"));
const NetworkExplorer = lazy(() => import("./pages/NetworkExplorer"));
const Entities = lazy(() => import("./pages/Entities"));
const Alerts = lazy(() => import("./pages/Alerts"));
const Documents = lazy(() => import("./pages/Documents"));
const UploadSettings = lazy(() => import("./pages/UploadSettings"));
const Communities = lazy(() => import("./pages/Communities"));
const Reports = lazy(() => import("./pages/Reports"));
const Investigations = lazy(() => import("./pages/Investigations"));
const nav = [
  { to: "/overview", label: "Overview", icon: House },
  { to: "/network", label: "Network Explorer", icon: Graph },
  { to: "/entities", label: "Entities & Search", icon: UsersThree },
  { to: "/communities", label: "Communities", icon: SquaresFour },
  { to: "/alerts", label: "Alerts & Patterns", icon: ShieldWarning },
  { to: "/documents", label: "Document Intel", icon: FileText },
  { to: "/reports", label: "Reports & Watchlist", icon: BookmarkSimple },
  { to: "/investigations", label: "Past Investigations", icon: ClockCounterClockwise },
];
function RouteReset() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    document.title = `${nav.find((n) => pathname.startsWith(n.to))?.label || "X-Tracer"} | Investigation workspace`;
  }, [pathname]);
  return null;
}
function WorkspaceLayout() {
  const { mode, setMode, notice, watched, dataset, ready } = useWorkspace();
  const { user, loading, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => setMenu(false), [location.pathname]);
  useEffect(() => {
    if (!menu) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(false);
    };
    document.addEventListener("keydown", close);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", close);
      document.body.style.overflow = previous;
    };
  }, [menu]);
  const current =
    nav.find((n) => location.pathname.startsWith(n.to))?.label ||
    (location.pathname === "/upload"
      ? "Upload your data"
      : "Workspace");
  if (loading) return <Loading label="Restoring your account" />;
  if (!user) return <Navigate to="/signin" state={{ from: location.pathname }} replace />;
  const displayName = user.user_metadata?.full_name || user.email?.split("@")[0] || "Investigator";
  const initials = displayName.split(/\s+/).map((part: string) => part[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {menu && (
        <button
          className="menu-scrim"
          aria-label="Close navigation"
          onClick={() => setMenu(false)}
        />
      )}
      <aside className={`app-sidebar ${menu ? "open" : ""}`}>
        <Brand />
        <div className="workspace-label">
          <span className="workspace-avatar">{initials}</span>
          <div>
            {displayName}
            <small>
              {mode === "demo"
                ? "Demonstration workspace"
                : dataset?.name || "Your investigation"}
            </small>
          </div>
        </div>
        <div className="nav-group-label">INVESTIGATE</div>
        <nav>
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `nav-link ${isActive ? "active" : ""}`
              }
            >
              <n.icon size={20} />
              <span>{n.label}</span>
              {n.to === "/reports" && watched.length > 0 && (
                <span className="nav-count">{watched.length}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <ButtonUpload />
          <Link className="nav-link" to="/upload">
            <House size={20} />
            Your data
          </Link>
          <Link className="back-home" to="/">
            About X-Tracer <ArrowUpRight size={15} />
          </Link>
          <div className="sidebar-foot">
            Evidence informs.
            <br />
            People decide.
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="app-topbar">
          <button
            className="icon-button mobile-menu"
            onClick={() => setMenu(!menu)}
            aria-label={menu ? "Close navigation" : "Open navigation"}
          >
            {menu ? <X /> : <List />}
          </button>
          <div className="breadcrumb">
            Workspace <CaretRight size={12} />
            <strong>{current}</strong>
          </div>
          <form
            className="global-search"
            onSubmit={(e) => {
              e.preventDefault();
              if (query.trim()) {
                navigate(`/entities?q=${encodeURIComponent(query.trim())}`);
                setQuery("");
              }
            }}
          >
            <MagnifyingGlass size={16} />
            <input
              aria-label="Search workspace"
              placeholder="Search entities…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <kbd>↵</kbd>
          </form>
          <ThemeButton />
          <div className="account-menu" title={displayName}>
            <span className="account-name">{displayName}</span>
            <button className="analyst-avatar account-avatar" aria-label={`Open ${displayName} account menu`} aria-expanded={accountOpen} onClick={() => setAccountOpen((open) => !open)}>{(user.user_metadata?.avatar_url || user.user_metadata?.picture) ? <img src={user.user_metadata.avatar_url || user.user_metadata.picture} alt={`${displayName} profile`} /> : initials}</button>
            {accountOpen && <div className="account-popover"><strong>{displayName}</strong><small>{user.email}</small><Link to="/investigations" onClick={() => setAccountOpen(false)}>Past investigations</Link><button onClick={() => { setAccountOpen(false); void signOut(); }}>Sign out</button></div>}
          </div>
        </header>
        <div className={`mode-strip ${mode}`}>
          <span>
            <span className="status-dot" />
            {mode === "demo" ? "Demo workspace" : dataset?.engine === "backend" ? "Backend analysis" : "Local workspace"}
            <span className="mode-detail">
              {mode === "demo"
                ? "Explore freely with fictional investigation data."
                : dataset?.engine === "backend" ? "Analyzed by the server. Results saved in this browser." : "Previously saved result. Reimport evidence to use backend analysis."}
            </span>
          </span>
          {mode === "demo" ? (
            <Link to="/upload">
              Use your own data <ArrowUpRight size={14} />
            </Link>
          ) : (
            <button onClick={() => setMode("demo")}>Explore demo</button>
          )}
        </div>
        <main
          className={`workspace-page ${location.pathname === "/network" ? "network-page" : ""}`}
          id="main-content"
          tabIndex={-1}
        >
          <Suspense fallback={<Loading />}>
            {!ready ? <Loading label="Restoring your local workspace" /> : mode === "local" && !dataset && !["/upload","/documents"].includes(location.pathname) ? <Navigate to="/upload" replace /> : <Outlet />}
          </Suspense>
        </main>
      </div>
      <AnimatePresence>
        {notice && (
          <motion.div
            className="toast"
            role="status"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
          >
            <CheckCircle size={20} />
            {notice}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
function ButtonUpload() {
  return (
    <Link to="/upload" className="btn primary sidebar-upload">
      <UploadSimple size={18} />
      Upload evidence
    </Link>
  );
}
export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <IconContext.Provider value={{ weight: "regular", size: 20 }}>
        <BrowserRouter>
          <AuthProvider>
          <WorkspaceProvider>
            <RouteReset />
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/signin" element={<SignIn />} />
              <Route element={<WorkspaceLayout />}>
                <Route path="/overview" element={<Overview />} />
                <Route path="/network" element={<NetworkExplorer />} />
                <Route path="/entities" element={<Entities />} />
                <Route path="/entities/:id" element={<Entities />} />
                <Route path="/communities" element={<Communities />} />
                <Route path="/alerts" element={<Alerts />} />
                <Route path="/documents" element={<Documents />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/investigations" element={<Investigations />} />
                <Route path="/upload" element={<UploadSettings />} />
                <Route path="/settings" element={<Navigate to="/upload" replace />} />
                <Route
                  path="*"
                  element={
                    <div className="empty-state">
                      <h1>Page not found</h1>
                      <Link className="btn" to="/overview">
                        Return to workspace
                      </Link>
                    </div>
                  }
                />
              </Route>
            </Routes>
          </WorkspaceProvider>
          </AuthProvider>
        </BrowserRouter>
      </IconContext.Provider>
    </MotionConfig>
  );
}
